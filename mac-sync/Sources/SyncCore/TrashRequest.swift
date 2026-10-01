import Foundation

public struct TrashRequest {
    public let arguments: [String]
    public init(payload: JSON, appPath: String) throws {
        guard payload["field"] as? String == "in_trash_list", payload["kind"] as? String == "todo", payload["value"] as? Bool == true,
              let target = payload["target"] as? String, target.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
              let base = payload["base"] as? JSON, base["state"] as? String == "value", let baseValue = base["value"] as? Bool,
              let policy = payload["conflict_policy"] as? String,
              policy == "things_wins" || (policy == "cloud_wins" && payload["version"] as? Int == 2) else { throw SyncError.invalid }
        arguments = [appPath, target, policy, baseValue ? "true" : "false", payload["recovering"] as? Bool == true ? "true" : "false"]
    }
}
