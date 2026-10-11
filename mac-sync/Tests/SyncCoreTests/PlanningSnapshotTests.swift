import Foundation
import Testing
@testable import SyncCore

private func planningItem(_ id: String, kind: String = "todo", deleted: Int = 0, fields: JSON) -> JSON {
    ["id": id, "kind": kind, "deleted": deleted, "fields": fields]
}
private func planningValue(_ value: Any) -> JSON { ["state": "value", "value": value] }

@Test func planningKeepsUnknownFieldsUnknownAndResolvesRelationships() throws {
    let snapshot = try PlanningSnapshot.decode(items: [
        planningItem("project", kind: "project", fields: ["title": planningValue("Design")]),
        planningItem("task", fields: ["title": planningValue("Read source"), "status": ["state": "unknown"],
                                      "project_id": planningValue("project"), "deadline": ["state": "absent"]])
    ], revision: 17)
    let task = try #require(snapshot.tasks.first)
    #expect(task.project == "Design")
    #expect(task.status == nil && !task.isOpen && task.inToday == nil && task.deadline == nil)
    #expect(snapshot.revision == 17 && !snapshot.synthetic)
}

@Test func planningExcludesDeletedAndTrashedTasksAndUsesRecordedMembership() throws {
    let snapshot = try PlanningSnapshot.decode(items: [
        planningItem("today", fields: ["title": planningValue("Actual Today"), "status": planningValue("open"),
            "list_memberships": planningValue([["list_id": "TMTodayListSource", "index": 0]])]),
        planningItem("deleted", deleted: 1, fields: ["title": planningValue("Deleted")]),
        planningItem("trash", fields: ["in_trash_list": planningValue(true)]),
        planningItem("unknown", fields: ["title": ["state": "unknown"]])
    ], revision: 2)
    #expect(snapshot.tasks.count == 2)
    #expect(snapshot.tasks.first { $0.id == "today" }?.inToday == true)
    #expect(snapshot.tasks.first { $0.id == "unknown" }?.title == nil)
}

@Test @MainActor func planningReadDoesNotAdvanceCursorOrPublishPartialBootstrap() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let replica = try LocalReplica(url: folder.appendingPathComponent("replica.sqlite"))
    let page: JSON = ["version": 3, "cursor": 11, "sequence": 1, "operation_revision": 0,
                      "has_more": true, "items": [planningItem("one", fields: ["title": planningValue("One")])]]
    try replica.bootstrap(page, first: true)
    #expect(try replica.planningSnapshot() == nil)
    var final = page; final["has_more"] = false; final["items"] = [] as [JSON]
    try replica.bootstrap(final, first: false)
    try replica.clearCommands()
    #expect(try replica.planningSnapshot()?.tasks.count == 1)
    #expect(try replica.planningSnapshot()?.revision == 11)
    #expect(try replica.cursor == 11 && !replica.commandsPending)
}

@Test func planningPreviewIsExplicitlySynthetic() {
    #expect(PlanningSnapshot.preview.synthetic)
    #expect(PlanningSnapshot.preview.tasks.count == 2)
    #expect(PlanningSnapshot.preview.tasks.filter { $0.inToday == true }.count == 1)
}

@Test @MainActor func planningReadFollowsOnlyCommittedChanges() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let replica = try LocalReplica(url: folder.appendingPathComponent("replica.sqlite"))
    let original = planningItem("one", fields: ["title": planningValue("Original"), "status": planningValue("open")])
    try replica.bootstrap(["version": 3, "cursor": 1, "sequence": 1, "operation_revision": 0,
                           "has_more": false, "items": [original]], first: true)
    let frozen = try #require(try replica.planningSnapshot())
    let changed = planningItem("one", fields: ["title": planningValue("Changed"), "status": planningValue("completed")])
    try replica.apply(["version": 3, "reset": false, "cursor": 2,
                       "changes": [["revision": 2, "kind": "item", "id": "one", "payload": ["item": changed]]]])
    let updated = try #require(try replica.planningSnapshot())
    #expect(updated.tasks.first?.title == "Changed" && updated.tasks.first?.status == "completed")
    #expect(updated.revision == 2)
    #expect(frozen.tasks.first?.title == "Original" && frozen.revision == 1)
    let deleted = planningItem("one", deleted: 1, fields: [:])
    try replica.apply(["version": 3, "reset": false, "cursor": 3,
                       "changes": [["revision": 3, "kind": "item", "id": "one", "payload": ["item": deleted]]]])
    #expect(try replica.planningSnapshot()?.tasks.isEmpty == true)
}
