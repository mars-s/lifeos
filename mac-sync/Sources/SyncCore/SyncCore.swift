import Foundation
import CSQLite
import Darwin

public typealias JSON = [String: Any]

public enum SyncError: Error, LocalizedError {
    case invalid, storage, configuration, migration, interrupted, http(Int), automation
    public var errorDescription: String? {
        switch self {
        case .http(401): "Cloud credential needs secure setup."
        case .http(503): "Cloud write activation is pending."
        case .http: "Cloud request failed; the durable journal is retained."
        case .storage: "Local journal could not be saved. Sync is stopped."
        case .migration: "Import the existing mirror journal before starting."
        case .configuration: "Finish secure connection setup to start syncing."
        case .automation: "Things automation is unavailable. Check its permission or open Things."
        case .interrupted: "An interrupted operation was recorded without repeating it."
        case .invalid: "Unsupported or invalid sync data."
        }
    }
}

public func encoded(_ value: JSON) throws -> Data {
    guard JSONSerialization.isValidJSONObject(value) else { throw SyncError.invalid }
    return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
}
public func decoded(_ data: Data) throws -> JSON {
    guard let value = try JSONSerialization.jsonObject(with: data) as? JSON else { throw SyncError.invalid }
    return value
}

public struct Intent: Codable, Equatable, Sendable {
    public let id: String
    public let claim: String
    public let payload: Data
    public var phase: String
    public var result: Data?
}
public struct JournalState: Codable, Sendable {
    public var sequence: Int = 0
    public var pendingUpload: Data?
    public var intents: [String: Intent] = [:]
    public var paused = true
    public var lastSync: Date?
    public var failures = 0
    public var retryAfter: Date?
    public init() {}
}

@MainActor public final class Journal {
    public let url: URL
    public private(set) var state: JournalState
    private var lock: Int32 = -1
    public init(url: URL) throws {
        self.url = url
        let folder = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        if FileManager.default.fileExists(atPath: url.path) {
            guard (try url.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true else { throw SyncError.storage }
            state = try JSONDecoder().decode(JournalState.self, from: Data(contentsOf: url))
        } else { state = JournalState() }
        lock = open(folder.appendingPathComponent("agent.lock").path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else { if lock >= 0 { close(lock) }; throw SyncError.storage }
    }
    deinit { if lock >= 0 { close(lock) } }
    public func update(_ transform: (inout JournalState) throws -> Void) throws {
        var next = state
        try transform(&next)
        try JSONEncoder().encode(next).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        let handle = try FileHandle(forWritingTo: url)
        try handle.synchronize(); try handle.close()
        let directory = open(url.deletingLastPathComponent().path, O_RDONLY)
        guard directory >= 0 else { throw SyncError.storage }
        defer { close(directory) }
        guard fsync(directory) == 0 else { throw SyncError.storage }
        state = next
    }
    public func importLegacy(from url: URL, backup: URL) throws {
        guard state.sequence == 0, state.pendingUpload == nil, state.intents.isEmpty else { throw SyncError.migration }
        var source: OpaquePointer?, target: OpaquePointer?
        guard sqlite3_open_v2(url.path, &source, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { throw SyncError.migration }
        defer { sqlite3_close(source); sqlite3_close(target) }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(source, "SELECT COALESCE(MAX(seq),0),SUM(CASE WHEN delivered=0 THEN 1 ELSE 0 END) FROM uploads", -1, &stmt, nil) == SQLITE_OK else { throw SyncError.migration }
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_step(stmt) == SQLITE_ROW, sqlite3_column_int64(stmt, 1) == 0 else { throw SyncError.migration }
        let sequence = Int(sqlite3_column_int64(stmt, 0))
        guard !FileManager.default.fileExists(atPath: backup.path), sqlite3_open(backup.path, &target) == SQLITE_OK,
              let copy = sqlite3_backup_init(target, "main", source, "main") else { throw SyncError.migration }
        let step = sqlite3_backup_step(copy, -1), finish = sqlite3_backup_finish(copy)
        guard step == SQLITE_DONE, finish == SQLITE_OK else { throw SyncError.storage }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: backup.path)
        try update { $0.sequence = sequence; $0.paused = true }
    }
}

@MainActor public protocol CloudTransport {
    func request(_ path: String, body: JSON?) async throws -> JSON
}
@MainActor public protocol ThingsAutomation {
    func inventory() async throws -> JSON
    func apply(_ payload: JSON) async throws -> JSON
}

@MainActor public final class SyncEngine {
    public let journal: Journal
    private let cloud: any CloudTransport
    private let things: any ThingsAutomation
    public private(set) var busy = false
    public private(set) var message = "Paused"
    public private(set) var pendingCount = 0
    public init(journal: Journal, cloud: any CloudTransport, things: any ThingsAutomation) {
        self.journal = journal; self.cloud = cloud; self.things = things
    }
    public func pause(_ value: Bool) throws { try journal.update { $0.paused = value }; message = value ? "Paused" : "Ready" }
    private func acknowledge(_ intent: Intent) async throws {
        guard let data = intent.result else { throw SyncError.invalid }
        _ = try await cloud.request("ack", body: ["id": intent.id, "claim": intent.claim, "result": decoded(data)])
        try journal.update { $0.intents.removeValue(forKey: intent.id) }
    }
    private func execute(_ saved: Intent) async throws {
        var intent = saved
        if intent.result != nil { try await acknowledge(intent); return }
        if intent.phase == "writing" {
            intent.result = try encoded(["state": "uncertain", "reason": "interrupted_write"])
            intent.phase = "receipt"
            try journal.update { $0.intents[intent.id] = intent }
            try await acknowledge(intent); return
        }
        if intent.phase == "prepared" {
            let claimed: JSON
            do { claimed = try await cloud.request("claim", body: ["id": intent.id, "claim": intent.claim]) }
            catch SyncError.http(409) {
                let remote = try await cloud.request("operation", body: ["id": intent.id])
                if let state = remote["state"] as? String, ["superseded", "skipped", "failed"].contains(state) {
                    // A prepared intent has never called Things. Its cloud final state wins.
                    try journal.update { $0.intents.removeValue(forKey: intent.id) }
                    return
                }
                throw SyncError.http(409)
            }
            guard claimed["claim"] as? String == intent.claim, claimed["state"] as? String == "executing",
                  let payload = claimed["payload"] as? JSON, try encoded(payload) == intent.payload else { throw SyncError.invalid }
            intent.phase = "claimed"
            try journal.update { $0.intents[intent.id] = intent }
        }
        guard intent.phase == "claimed" else { throw SyncError.invalid }
        guard !journal.state.paused else { return }
        intent.phase = "writing"
        try journal.update { $0.intents[intent.id] = intent }
        let result: JSON
        do { result = try await things.apply(decoded(intent.payload)) }
        catch { result = ["state": "uncertain", "reason": "verification_failed"] }
        guard let status = result["state"] as? String, ["applied", "satisfied", "skipped", "failed", "uncertain"].contains(status) else { throw SyncError.invalid }
        intent.result = try encoded(result); intent.phase = "receipt"
        try journal.update { $0.intents[intent.id] = intent }
        try await acknowledge(intent)
    }
    private func upload() async throws {
        if journal.state.pendingUpload == nil {
            let inventory = try await things.inventory()
            guard let items = inventory["items"] as? [JSON], items.count <= 10000 else { throw SyncError.invalid }
            var manifest = inventory; manifest.removeValue(forKey: "items")
            manifest["observed_at"] = ISO8601DateFormatter().string(from: Date())
            let data = try encoded(["sequence": journal.state.sequence + 1, "items": items, "manifest": manifest])
            guard data.count <= 1024 * 1024 else { throw SyncError.invalid }
            try journal.update { $0.sequence += 1; $0.pendingUpload = data }
        }
        guard let data = journal.state.pendingUpload else { throw SyncError.invalid }
        _ = try await cloud.request("snapshot", body: decoded(data))
        try journal.update { $0.pendingUpload = nil; $0.lastSync = Date() }
    }
    public func cycle(force: Bool = false) async {
        guard !busy, !journal.state.paused else { return }
        guard force || journal.state.retryAfter.map({ $0 <= Date() }) ?? true else { return }
        busy = true; defer { busy = false }
        do {
            for saved in journal.state.intents.values.sorted(by: { $0.id < $1.id }) { try await execute(saved) }
            let remote = try await cloud.request("pending", body: nil)
            guard let remoteSequence = remote["sequence"] as? Int,
                  remoteSequence <= journal.state.sequence,
                  journal.state.sequence - remoteSequence <= (journal.state.pendingUpload == nil ? 0 : 1) else { throw SyncError.migration }
            guard !journal.state.paused else { message = "Paused"; return }
            try await upload()
            let pending = try await cloud.request("pending", body: nil)
            guard let operations = pending["operations"] as? [JSON] else { throw SyncError.invalid }
            pendingCount = operations.count
            for op in operations {
                if journal.state.paused { break }
                guard let id = op["id"] as? String, let payload = op["payload"] as? JSON else { throw SyncError.invalid }
                if op["state"] as? String == "executing" { message = "An operation is owned by another journal"; continue }
                let intent = Intent(id: id, claim: UUID().uuidString, payload: try encoded(payload), phase: "prepared", result: nil)
                try journal.update { $0.intents[id] = intent }
                try await execute(intent)
            }
            if !operations.isEmpty { try await upload() }
            let remaining = try await cloud.request("pending", body: nil)
            guard let waiting = remaining["operations"] as? [JSON] else { throw SyncError.invalid }
            pendingCount = waiting.count
            try journal.update { $0.failures = 0; $0.retryAfter = nil }
            message = journal.state.paused ? "Paused" : waiting.contains(where: { $0["state"] as? String == "executing" }) ? "An operation needs journal recovery" : "Synced"
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "Sync paused for retry; journal retained"
            do { try journal.update { $0.failures = min($0.failures + 1, 8); $0.retryAfter = Date().addingTimeInterval(min(3600, pow(2, Double($0.failures)) * 15) + Double.random(in: 0...10)) } }
            catch { message = SyncError.storage.errorDescription! }
        }
    }
}
