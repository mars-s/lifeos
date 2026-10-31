import Foundation

// Immutable cloud payload plus locally resolved references. Automation receives only
// this typed data; it never receives executable source from the cloud.
public struct ThingsOperation {
    public let payload: JSON
    public let op: String
    public let verify: [String]
    public init(_ payload: JSON) throws {
        guard payload["version"] as? Int == 4, payload["protocol"] as? String == "things_ops_v1",
              let op = payload["op"] as? String, ["create", "update", "move", "set_status", "trash", "restore"].contains(op),
              let kind = payload["kind"] as? String, ["todo", "project"].contains(kind),
              payload["target"] is String, payload["base"] is JSON,
              let policy = payload["conflict_policy"] as? String, ["things_wins", "cloud_wins", "smart_merge_v1"].contains(policy),
              let verify = payload["verify"] as? [String], !verify.isEmpty, Set(verify).count == verify.count else { throw SyncError.invalid }
        let fields = payload["fields"] as? JSON ?? [:]
        let expected: [String]
        switch op {
        case "create", "update":
            guard !fields.isEmpty, fields.keys.allSatisfy({ ["title", "notes", "when", "deadline", "tags", "checklist"].contains($0) }),
                  op != "create" || fields["title"] is String else { throw SyncError.invalid }
            expected = Array(fields.keys) + (op == "create" && payload["container"] != nil ? ["container"] : [])
        case "move": guard payload["container"] is JSON else { throw SyncError.invalid }; expected = ["container"]
        case "set_status": guard let status = payload["status"] as? String, ["open", "completed", "canceled"].contains(status) else { throw SyncError.invalid }; expected = ["status"]
        default: guard kind == "todo" else { throw SyncError.invalid }; expected = ["in_trash_list"]
        }
        guard verify.sorted() == expected.sorted() else { throw SyncError.invalid }
        self.payload = payload; self.op = op; self.verify = verify
    }
    public func resolving(_ refs: JSON) throws -> ThingsOperation? {
        if refs.values.contains(where: { $0 is NSNull }) { return nil }
        var p = payload
        func resolve(_ id: String) throws -> String? {
            guard id.hasPrefix("tmp-") else { return id }
            guard let real = refs[id] as? String, !real.hasPrefix("tmp-"), Self.realID(real) else { return nil }
            return real
        }
        if op != "create", let target = p["target"] as? String {
            guard let real = try resolve(target) else { return nil }; p["target"] = real
        }
        if var container = p["container"] as? JSON {
            for key in ["id", "project"] {
                if let id = container[key] as? String { guard let real = try resolve(id) else { return nil }; container[key] = real }
            }
            p["container"] = container
        }
        return try ThingsOperation(p)
    }
    public static func realID(_ id: String) -> Bool {
        !id.hasPrefix("tmp-") && id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil
    }
    public func desired(_ key: String) -> JSON {
        let value: Any
        switch key {
        case "container": value = payload[key] ?? NSNull()
        case "status": value = payload[key] ?? NSNull()
        case "in_trash_list": value = op == "trash"
        default: value = (payload["fields"] as? JSON)?[key] ?? NSNull()
        }
        return value is NSNull ? ["state": "absent"] : ["state": "value", "value": value]
    }
    public static func equal(_ key: String, _ lhs: JSON, _ rhs: JSON) -> Bool {
        func normal(_ cell: JSON) -> JSON {
            if key == "tags", cell["state"] as? String == "value", let tags = cell["value"] as? [String] {
                return ["state": "value", "value": tags.map { $0.lowercased() }.sorted()]
            }
            return cell
        }
        guard let left = try? encoded(normal(lhs)), let right = try? encoded(normal(rhs)) else { return false }
        return left == right
    }
    public func verified(_ fields: JSON, today: String? = nil) -> JSON {
        Dictionary(uniqueKeysWithValues: verify.map { key in
            var cell = fields[key] as? JSON ?? ["state": "unknown"]
            // All public readers call today's activation date "today". Preserve
            // the requested civil date in the receipt, so the Worker need not
            // guess the Mac's timezone (or the date when a receipt is retried).
            if key == "when", cell["state"] as? String == "value", cell["value"] as? String == "today",
               let requested = (payload["fields"] as? JSON)?["when"] as? String,
               requested.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil {
                let civil = DateFormatter(); civil.calendar = Calendar(identifier: .gregorian)
                civil.locale = Locale(identifier: "en_US_POSIX"); civil.timeZone = .current; civil.dateFormat = "yyyy-MM-dd"
                if requested == (today ?? civil.string(from: Date())) { cell = ["state": "value", "value": requested] }
            }
            return (key, cell)
        })
    }
    public func matches(_ fields: JSON, today: String? = nil) -> Bool {
        let readback = verified(fields, today: today)
        return verify.allSatisfy { key in
            let cell = readback[key] as? JSON ?? [:]
            let unsupportedAllowed = key == "checklist" || key == "when" && (payload["fields"] as? JSON)?["when"] as? String == "evening" || key == "container" && (payload["container"] as? JSON)?["type"] as? String == "heading"
            return cell["state"] as? String == "unsupported" && unsupportedAllowed || Self.equal(key, cell, desired(key))
        }
    }
    public func conflicts(_ before: JSON) -> Bool {
        (payload["base"] as? JSON ?? [:]).contains { key, value in
            guard let base = value as? JSON, let local = before[key] as? JSON else { return true }
            return !Self.equal(key, base, local)
        }
    }
    public func decision(_ before: JSON, interrupted: Bool = false) -> JSON {
        let base = payload["base"] as? JSON ?? [:]
        var fields: [String: String] = [:]
        for key in verify {
            let local = verified(before)[key] as? JSON ?? ["state": "unknown"]
            let baseKey = key == "when" ? "activation_date" : key
            let baseKeys = key == "container" ? (payload["kind"] as? String == "project" ? ["area_id"] : ["area_id", "project_id", "heading_id"]) : [baseKey]
            let unchanged = baseKeys.filter { base[$0] != nil }.allSatisfy { name in
                Self.equal(name, before[name] as? JSON ?? [:], base[name] as? JSON ?? [:])
            }
            fields[key] = interrupted ? "interrupted" : op == "create" ? "created" : Self.equal(key, local, desired(key)) ? "same_value" :
                (local["state"] as? String == "unknown" ? "unavailable" : unchanged ? "cloud_only" : "cloud_fallback")
        }
        return ["algorithm": "things_fields_v1", "fields": fields]
    }
}
