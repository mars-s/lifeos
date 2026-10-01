import Foundation
import CSQLite

@MainActor public final class LocalReplica {
    private var database: OpaquePointer?
    public init(url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path), try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true { throw SyncError.storage }
        guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK else { throw SyncError.storage }
        try sql("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT OR IGNORE INTO meta VALUES('cursor',0),('ready',0),('commands',1); CREATE TABLE IF NOT EXISTS events(revision INTEGER PRIMARY KEY,payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS projections(id TEXT PRIMARY KEY,payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS bootstrap_items(id TEXT PRIMARY KEY,payload BLOB NOT NULL);")
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    isolated deinit { sqlite3_close(database) }
    private func sql(_ statement: String) throws {
        guard sqlite3_exec(database, statement, nil, nil, nil) == SQLITE_OK else { throw SyncError.storage }
    }
    private func integer(_ key: String) throws -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT value FROM meta WHERE key=?", -1, &statement, nil) == SQLITE_OK else { throw SyncError.storage }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, key, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        guard sqlite3_step(statement) == SQLITE_ROW else { throw SyncError.storage }
        return Int(sqlite3_column_int64(statement, 0))
    }
    public var cursor: Int { get throws { try integer("cursor") } }
    public var ready: Bool { get throws { try integer("ready") == 1 } }
    public var commandsPending: Bool { get throws { try integer("commands") == 1 } }
    private func store(_ value: JSON, table: String, key: String) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "INSERT OR REPLACE INTO \(table) VALUES(?,?)", -1, &statement, nil) == SQLITE_OK else { throw SyncError.storage }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(statement, 1, key, -1, transient)
        let bytes = try encoded(value)
        _ = bytes.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32(bytes.count), transient) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw SyncError.storage }
    }
    private func transaction(_ action: () throws -> Void) throws {
        try sql("BEGIN IMMEDIATE")
        do { try action(); try sql("COMMIT") } catch { try? sql("ROLLBACK"); throw error }
    }
    public func clearCommands() throws { try sql("UPDATE meta SET value=0 WHERE key='commands'") }
    public func resetBootstrap() throws { try sql("DELETE FROM bootstrap_items") }
    private func itemID(_ item: JSON) throws -> String {
        guard let id = item["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
              let kind = item["kind"] as? String, ["todo", "project", "area", "tag"].contains(kind),
              let deleted = item["deleted"] as? Int, [0, 1].contains(deleted), let fields = item["fields"] as? JSON else { throw SyncError.invalid }
        for value in fields.values {
            guard let cell = value as? JSON, let state = cell["state"] as? String,
                  ["value", "absent", "unknown", "unsupported"].contains(state),
                  state == "value" ? cell["value"] != nil : cell["value"] == nil else { throw SyncError.invalid }
        }
        return id
    }
    public func bootstrap(_ page: JSON, first: Bool) throws {
        guard page["version"] as? Int == 3, let cursor = page["cursor"] as? Int, cursor >= 0,
              let sequence = page["sequence"] as? Int, sequence >= 0,
              let operation = page["operation_revision"] as? Int, operation >= 0,
              let more = page["has_more"] as? Bool, let items = page["items"] as? [JSON], items.count <= 10000 else { throw SyncError.invalid }
        try transaction {
            if first { try sql("DELETE FROM bootstrap_items; INSERT OR REPLACE INTO meta VALUES('bootstrap_cursor',\(cursor)),('bootstrap_sequence',\(sequence)),('bootstrap_operation',\(operation)),('bootstrap_count',0)") }
            guard try integer("bootstrap_cursor") == cursor, try integer("bootstrap_sequence") == sequence, try integer("bootstrap_operation") == operation,
                  try integer("bootstrap_count") + items.count <= 10000 else { throw SyncError.invalid }
            for item in items { try store(item, table: "bootstrap_items", key: itemID(item)) }
            try sql("UPDATE meta SET value=value+\(items.count) WHERE key='bootstrap_count'")
            if !more {
                try sql("DELETE FROM items; INSERT INTO items SELECT * FROM bootstrap_items; DELETE FROM bootstrap_items; DELETE FROM events; DELETE FROM projections; UPDATE meta SET value=\(cursor) WHERE key='cursor'; UPDATE meta SET value=1 WHERE key IN ('ready','commands')")
            }
        }
    }
    public func apply(_ page: JSON) throws {
        guard page["version"] as? Int == 3, page["reset"] as? Bool == false,
              let end = page["cursor"] as? Int, let changes = page["changes"] as? [JSON] else { throw SyncError.invalid }
        try transaction {
            var current = try cursor
            let initial = current
            guard end >= current else { throw SyncError.invalid }
            for change in changes {
                guard let revision = change["revision"] as? Int, let payload = change["payload"] as? JSON else { throw SyncError.invalid }
                if revision <= initial { continue }
                guard revision > current else { throw SyncError.invalid }
                guard revision <= end else { throw SyncError.invalid }
                try store(change, table: "events", key: String(revision))
                guard let kind = change["kind"] as? String, let id = change["id"] as? String else { throw SyncError.invalid }
                try store(payload, table: "projections", key: kind + ":" + id)
                if change["kind"] as? String == "item" {
                    guard let item = payload["item"] as? JSON else { throw SyncError.invalid }
                    try store(item, table: "items", key: itemID(item))
                }
                if payload["command_changed"] as? Bool == true { try sql("UPDATE meta SET value=1 WHERE key='commands'") }
                current = revision
            }
            guard current == end else { throw SyncError.invalid }
            try sql("UPDATE meta SET value=\(end) WHERE key='cursor'")
            try sql("DELETE FROM events WHERE revision<\(max(0, end - 1000))")
        }
    }
}
