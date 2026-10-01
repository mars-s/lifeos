import Foundation
import Testing
@testable import SyncCore

private func trashPayload() -> JSON {
    ["version": 2, "kind": "todo", "target": "synthetic_ID-1", "field": "in_trash_list", "value": true,
     "base": ["state": "value", "value": false], "conflict_policy": "cloud_wins"]
}

@Test func trashDispatchKeepsRecoveryAndConflictPolicyAsFixedArguments() throws {
    var payload = trashPayload()
    payload["recovering"] = true
    #expect(try TrashRequest(payload: payload, appPath: "Synthetic.app").arguments == ["Synthetic.app", "synthetic_ID-1", "cloud_wins", "false", "true"])
    payload["conflict_policy"] = "things_wins"; payload.removeValue(forKey: "version")
    #expect(try TrashRequest(payload: payload, appPath: "Synthetic.app").arguments[2] == "things_wins")
}

@Test func trashDispatchRejectsResurrectionMalformedTargetsAndUnversionedCloudPolicy() {
    for (field, value) in [("value", false as Any), ("kind", "project" as Any), ("target", "unsafe;command" as Any), ("version", 1 as Any)] {
        var payload = trashPayload(); payload[field] = value
        #expect(throws: SyncError.self) { try TrashRequest(payload: payload, appPath: "Synthetic.app") }
    }
    var payload = trashPayload(); payload["base"] = ["state": "unknown", "reason": "unavailable"]
    #expect(throws: SyncError.self) { try TrashRequest(payload: payload, appPath: "Synthetic.app") }
}
