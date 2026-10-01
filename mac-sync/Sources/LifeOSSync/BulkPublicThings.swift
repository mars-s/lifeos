import Foundation
import AppKit
import SyncCore

// NSAppleScript is used on the main actor as required by its API. Only the
// fixed bundled script is executed, with the configured application path.
final class BulkPublicThings: ThingsAutomation {
    let appPath: String
    init(appPath: String) { self.appPath = appPath }

    func inventory() async throws -> JSON {
        if !NSWorkspace.shared.runningApplications.contains(where: { $0.bundleURL?.path == appPath }) {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = false
            configuration.hides = true
            _ = try await NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: appPath), configuration: configuration)
        }
        guard let executable = Bundle.main.executableURL,
              Bundle.main.url(forResource: "things_bulk", withExtension: "scpt") != nil else {
            throw SyncError.configuration
        }
        return try decoded(await BulkThingsProcess.run(executable: executable, appPath: appPath))
    }

    func apply(_ payload: JSON) async throws -> JSON {
        try await PublicThings(appPath: appPath).apply(payload)
    }
}

nonisolated enum BulkThingsProcess {
    @concurrent static func run(executable: URL, appPath: String) async throws -> Data {
        let process = Process(), output = Pipe()
        process.executableURL = executable
        process.arguments = ["--bulk-inventory", appPath]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        try process.run()
        let timeout = Task {
            try await Task.sleep(for: .seconds(45))
            if process.isRunning { process.terminate() }
        }
        defer { timeout.cancel() }
        var data = Data()
        while let chunk = try output.fileHandleForReading.read(upToCount: 65536), !chunk.isEmpty {
            guard data.count + chunk.count <= 8 * 1024 * 1024 else { process.terminate(); throw SyncError.automation }
            data.append(chunk)
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw SyncError.automation }
        return data
    }
}

enum BulkThingsInventory {
    static let coverage = "public-top-level-and-all-lists-v2"
    static let builtins = ["TMInboxListSource", "TMTodayListSource", "TMCalendarListSource", "TMNextListSource", "TMSomedayListSource", "TMLogbookListSource", "TMTrashListSource"]
    private static func code(_ value: String) -> UInt32 {
        value.utf8.reduce(0) { ($0 << 8) | UInt32($1) }
    }
    private static func list(_ descriptor: NSAppleEventDescriptor) throws -> [NSAppleEventDescriptor] {
        guard descriptor.descriptorType == code("list") else { throw SyncError.automation }
        guard descriptor.numberOfItems <= 50000 else { throw SyncError.automation }
        return try (0..<descriptor.numberOfItems).map { offset in
            guard let value = descriptor.atIndex(offset + 1) else { throw SyncError.automation }
            return value
        }
    }
    private static func text(_ descriptor: NSAppleEventDescriptor?) throws -> String {
        guard let descriptor, let value = descriptor.stringValue, !value.isEmpty else { throw SyncError.automation }
        return value
    }
    private static func value(_ value: Any) -> JSON { ["state": "value", "value": value] }
    private static func state(_ state: String) -> JSON { ["state": state] }
    private static func missing(_ descriptor: NSAppleEventDescriptor) -> Bool {
        descriptor.descriptorType == code("null") || descriptor.descriptorType == code("msng") ||
        (descriptor.descriptorType == code("type") && descriptor.typeCodeValue == code("msng"))
    }
    private static func cell(_ descriptor: NSAppleEventDescriptor?, transform: (NSAppleEventDescriptor) throws -> Any) -> JSON {
        guard let descriptor else { return state("unknown") }
        if missing(descriptor) { return state("absent") }
        do { return value(try transform(descriptor)) } catch { return state("unknown") }
    }
    private static func reference(_ descriptor: NSAppleEventDescriptor) throws -> String {
        guard descriptor.descriptorType == code("obj "),
              descriptor.forKeyword(code("form"))?.enumCodeValue == code("ID  ") else { throw SyncError.automation }
        return try text(descriptor.forKeyword(code("seld")))
    }

    static func read(scriptURL: URL, appPath: String) throws -> JSON {
        var error: NSDictionary?
        guard let script = NSAppleScript(contentsOf: scriptURL, error: &error), error == nil else { throw SyncError.automation }
        func pass() throws -> JSON {
            // Run handlers use the standard open-application event, whose
            // direct parameter is argv. This does not launch the target app.
            let event = NSAppleEventDescriptor(eventClass: code("aevt"), eventID: code("oapp"), targetDescriptor: nil, returnID: -1, transactionID: 0)
            let argv = NSAppleEventDescriptor.list()
            argv.insert(NSAppleEventDescriptor(string: appPath), at: 1)
            event.setParam(argv, forKeyword: code("----"))
            var error: NSDictionary?
            let result = script.executeAppleEvent(event, error: &error)
            guard error == nil else { throw SyncError.automation }
            return try canonical(result)
        }
        let first = try pass(), second = try pass()
        guard try encoded(first) == encoded(second) else { throw SyncError.automation }
        return first
    }

    static func canonical(_ descriptor: NSAppleEventDescriptor) throws -> JSON {
        let root = try list(descriptor)
        guard root.count == 3 else { throw SyncError.automation }
        let groups = try list(root[0]), lists = try list(root[1]), children = try list(root[2])
        guard groups.count == 4 else { throw SyncError.automation }
        var rows: [String: JSON] = [:], kinds: [String: String] = [:], taskIDs = Set<String>(), listIDs = Set<String>()
        var edgeCount = 0, encountered = 0
        let instant = ISO8601DateFormatter()
        instant.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let civil = DateFormatter()
        civil.calendar = Calendar(identifier: .gregorian)
        civil.locale = Locale(identifier: "en_US_POSIX")
        civil.timeZone = .current
        civil.dateFormat = "yyyy-MM-dd"
        func fields(_ record: NSAppleEventDescriptor, kind: String, index: Int, tags: NSAppleEventDescriptor?) throws -> JSON {
            // Read only whitelisted public keys. In particular, the hidden
            // experimental JSON property in a returned record is never read.
            func field(_ key: String, transform: ((NSAppleEventDescriptor) throws -> Any)? = nil) -> JSON {
                cell(record.forKeyword(code(key))) { d in
                    if let transform { return try transform(d) }
                    guard let string = d.stringValue else { throw SyncError.automation }
                    return string
                }
            }
            func date(_ key: String, civilDate: Bool) -> JSON {
                field(key) { d in
                    guard let date = d.dateValue else { throw SyncError.automation }
                    return civilDate ? civil.string(from: date) : instant.string(from: date)
                }
            }
            func tagCell() -> JSON {
                cell(tags) { d in try list(d).map { try text($0) } }
            }
            var result: JSON = ["title": field("pnam"), "collection_index": value(index)]
            if kind == "todo" || kind == "project" {
                result["notes"] = field("note")
                result["deadline"] = date("dued", civilDate: true)
                result["activation_date"] = date("actd", civilDate: true)
                result["status"] = field("tdst") { d in
                    guard let status = [code("tdio"): "open", code("tdcm"): "completed", code("tdcl"): "canceled"][d.enumCodeValue] else { throw SyncError.automation }
                    return status
                }
                for (name, key) in [("creation_date", "cred"), ("modification_date", "modd"), ("completion_date", "cmpd"), ("cancellation_date", "cncd")] {
                    result[name] = date(key, civilDate: false)
                }
                result["area_id"] = field("tsaa", transform: reference)
                result["tags"] = tagCell()
                for name in ["checklist", "reminder", "recurrence", "heading_id", "evening"] { result[name] = state("unsupported") }
                if kind == "todo" { result["project_id"] = field("tspt", transform: reference) }
                result["list_memberships"] = value([JSON]())
            }
            if kind == "area" { result["tags"] = tagCell() }
            if kind == "tag" { result["parent_tag_id"] = field("ptag", transform: reference) }
            return result
        }
        func add(_ records: NSAppleEventDescriptor, tags: NSAppleEventDescriptor, expected: String?, listID: String?, fallback: Bool = false) throws {
            let objects = try list(records), tagLists = try list(tags)
            guard expected == "tag" || objects.count == tagLists.count else { throw SyncError.automation }
            var within = Set<String>()
            for (index, object) in objects.enumerated() {
                encountered += 1
                guard encountered <= 50000 else { throw SyncError.automation }
                let type = object.descriptorType
                let kind: String
                switch type {
                case code("tstk"), code("tslt"): kind = "todo"
                case code("tspt"): kind = "project"
                case code("tsaa"): kind = "area"
                case code("tstg"): kind = "tag"
                default: throw SyncError.automation
                }
                guard expected == nil || expected == kind || (expected == "todo" && kind == "project"),
                      let record = object.coerce(toDescriptorType: code("reco")) else { throw SyncError.automation }
                let id = try text(record.forKeyword(code("ID  ")))
                guard within.insert(id).inserted, kinds[id] == nil || kinds[id] == kind else { throw SyncError.automation }
                kinds[id] = kind
                if kind == "todo" || kind == "project" { taskIDs.insert(id) }
                if rows[id] == nil {
                    guard rows.count < 10000 else { throw SyncError.automation }
                    let tag = index < tagLists.count ? tagLists[index] : nil
                    rows[id] = ["id": id, "kind": kind, "fields": try fields(record, kind: kind, index: fallback ? 0 : index, tags: tag)]
                }
                if let listID {
                    edgeCount += 1
                    guard edgeCount <= 50000, var row = rows[id], var fields = row["fields"] as? JSON,
                          var membership = fields["list_memberships"] as? JSON, var entries = membership["value"] as? [JSON] else { throw SyncError.automation }
                    entries.append(["list_id": listID, "index": index])
                    membership["value"] = entries; fields["list_memberships"] = membership; row["fields"] = fields; rows[id] = row
                }
            }
        }
        for (index, group) in groups.enumerated() {
            let parts = try list(group)
            guard parts.count == 3, try text(parts[0]) == ["todo", "project", "area", "tag"][index] else { throw SyncError.automation }
            try add(parts[1], tags: parts[2], expected: try text(parts[0]), listID: nil)
        }
        for group in lists {
            let parts = try list(group)
            guard parts.count == 3 else { throw SyncError.automation }
            let id = try text(parts[0])
            guard listIDs.insert(id).inserted else { throw SyncError.automation }
            try add(parts[1], tags: parts[2], expected: "todo", listID: id)
        }
        // Existing canonical semantics give children absent from all top-level
        // and list collections index zero. Their membership still comes only
        // from public list collections.
        for group in children {
            let parts = try list(group)
            guard parts.count == 4, ["project", "area"].contains(try text(parts[0])), rows[try text(parts[1])] != nil else { throw SyncError.automation }
            try add(parts[2], tags: parts[3], expected: "todo", listID: nil, fallback: true)
        }
        guard builtins.allSatisfy(listIDs.contains) else { throw SyncError.automation }
        var items: [JSON] = [], estimatedBytes = 0
        // Match the original JavaScript localeCompare ordering, including
        // mixed-case stable IDs, rather than Swift's scalar ordering.
        for id in rows.keys.sorted(by: { $0.compare($1, locale: .current) == .orderedAscending }) {
            guard var row = rows[id], var fields = row["fields"] as? JSON else { throw SyncError.automation }
            if var membership = fields["list_memberships"] as? JSON, let entries = membership["value"] as? [JSON] {
                membership["value"] = entries.sorted { ($0["list_id"] as? String ?? "").compare($1["list_id"] as? String ?? "", locale: .current) == .orderedAscending }
                fields["list_memberships"] = membership
                fields["in_logbook_list"] = value(entries.contains { $0["list_id"] as? String == "TMLogbookListSource" })
                fields["in_trash_list"] = value(entries.contains { $0["list_id"] as? String == "TMTrashListSource" })
            }
            row["fields"] = fields
            // Retain the old UTF-16 length times three estimate as well as
            // the actual output cap. An oversized snapshot is never truncated.
            guard let serialized = String(data: try encoded(row), encoding: .utf8) else { throw SyncError.automation }
            estimatedBytes += serialized.utf16.count * 3
            guard estimatedBytes <= 8 * 1024 * 1024 else { throw SyncError.automation }
            items.append(row)
        }
        let result: JSON = ["items": items, "scopes": ["todo", "project", "area", "tag"], "zone": TimeZone.current.identifier,
                            "coverage": coverage, "coverage_evidence": ["list_ids": listIDs.sorted(), "classified_records": taskIDs.count, "consistent_passes": 2]]
        guard try encoded(result).count <= 8 * 1024 * 1024 else { throw SyncError.automation }
        return result
    }
}
