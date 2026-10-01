import Foundation
import Testing
import CSQLite
@testable import SyncCore

@MainActor private func replicaFixture() throws -> (URL, URL, LocalReplica) {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent("replica.sqlite")
    return (folder, url, try LocalReplica(url: url))
}

private func projectedItem(_ id: String = "synthetic", title: String = "Original", deleted: Int = 0) -> JSON {
    ["id": id, "kind": "todo", "deleted": deleted, "fields": ["title": ["state": "value", "value": title]]]
}

private func bootstrapPage(cursor: Int, items: [JSON], more: Bool = false, sequence: Int = 1) -> JSON {
    ["version": 3, "cursor": cursor, "sequence": sequence, "operation_revision": 0, "has_more": more, "items": items]
}

private func change(_ revision: Int, kind: String = "item", id: String = "synthetic", payload: JSON) -> JSON {
    ["revision": revision, "kind": kind, "id": id, "payload": payload]
}

private func feedPage(_ cursor: Int, _ changes: [JSON]) -> JSON {
    ["version": 3, "cursor": cursor, "has_more": false, "reset": false, "sequence": 1, "operation_revision": 0, "changes": changes]
}

private func persistedJSON(_ url: URL, table: String, id: String) throws -> JSON? {
    var database: OpaquePointer?, statement: OpaquePointer?
    guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { throw SyncError.storage }
    defer { sqlite3_finalize(statement); sqlite3_close(database) }
    guard sqlite3_prepare_v2(database, "SELECT payload FROM \(table) WHERE id=?", -1, &statement, nil) == SQLITE_OK else { throw SyncError.storage }
    sqlite3_bind_text(statement, 1, id, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    let result = sqlite3_step(statement)
    if result == SQLITE_DONE { return nil }
    guard result == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw SyncError.storage }
    return try decoded(Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
}

@Test @MainActor func replicaCommitsProjectionCursorAndCommandInvalidationTogether() throws {
    let (folder, url, replica) = try replicaFixture()
    defer { try? FileManager.default.removeItem(at: folder) }
    try replica.bootstrap(bootstrapPage(cursor: 1, items: [projectedItem()]), first: true)
    try replica.clearCommands()
    let updated = projectedItem(title: "Changed")
    try replica.apply(feedPage(3, [change(2, payload: ["item": updated]), change(3, kind: "operation", id: "command", payload: ["operation": ["id": "command", "state": "queued"], "command_changed": true])]))
    #expect(try replica.cursor == 3)
    #expect(try replica.commandsPending)
    #expect(try (persistedJSON(url, table: "items", id: "synthetic")?["fields"] as? JSON)?["title"] as? JSON != nil)
    #expect(try encoded(persistedJSON(url, table: "items", id: "synthetic")!) == encoded(updated))
    #expect(try persistedJSON(url, table: "projections", id: "operation:command")?["command_changed"] as? Bool == true)
}

@Test @MainActor func malformedLaterEventRollsBackEarlierProjectionCursorAndWorkFlag() throws {
    let (folder, url, replica) = try replicaFixture()
    defer { try? FileManager.default.removeItem(at: folder) }
    let original = projectedItem()
    try replica.bootstrap(bootstrapPage(cursor: 1, items: [original]), first: true)
    try replica.clearCommands()
    let page = feedPage(3, [change(2, kind: "operation", id: "command", payload: ["operation": ["id": "command"], "command_changed": true]), change(3, payload: ["item": projectedItem(title: "Invalid", deleted: 2)])])
    #expect(throws: SyncError.self) { try replica.apply(page) }
    #expect(try replica.cursor == 1)
    #expect(try !replica.commandsPending)
    #expect(try persistedJSON(url, table: "projections", id: "operation:command") == nil)
    #expect(try encoded(persistedJSON(url, table: "items", id: "synthetic")!) == encoded(original))
}

@Test @MainActor func ownReceiptSnapshotAndDuplicateEventsDoNotWakeCommandExecution() throws {
    let (folder, url, replica) = try replicaFixture()
    defer { try? FileManager.default.removeItem(at: folder) }
    try replica.bootstrap(bootstrapPage(cursor: 10, items: [projectedItem()]), first: true)
    try replica.clearCommands()
    let page = feedPage(13, [change(11, kind: "operation", id: "applied", payload: ["operation": ["id": "applied", "state": "applied"], "command_changed": false]), change(12, payload: ["item": projectedItem(title: "Confirmed")]), change(13, kind: "meta", id: "owner", payload: ["sequence": 2])])
    try replica.apply(page)
    #expect(try replica.cursor == 13)
    #expect(try !replica.commandsPending)
    let saved = try persistedJSON(url, table: "items", id: "synthetic")!
    try replica.apply(page)
    #expect(try replica.cursor == 13)
    #expect(try !replica.commandsPending)
    #expect(try encoded(saved) == encoded(persistedJSON(url, table: "items", id: "synthetic")!))
}

@Test @MainActor func cursorCannotJumpPastAnUnreturnedEventOrAcceptReorderedNewEvents() throws {
    let (folder, _, replica) = try replicaFixture()
    defer { try? FileManager.default.removeItem(at: folder) }
    try replica.bootstrap(bootstrapPage(cursor: 1, items: [projectedItem()]), first: true)
    #expect(throws: SyncError.self) { try replica.apply(feedPage(4, [change(2, payload: ["item": projectedItem(title: "Changed")])])) }
    #expect(try replica.cursor == 1)
    #expect(throws: SyncError.self) { try replica.apply(feedPage(3, [change(3, payload: ["item": projectedItem()]), change(2, payload: ["item": projectedItem()])])) }
    #expect(try replica.cursor == 1)
    #expect(throws: SyncError.self) { try replica.apply(feedPage(0, [])) }
    var reset = feedPage(1, []); reset["reset"] = true
    #expect(throws: SyncError.self) { try replica.apply(reset) }
    #expect(try replica.cursor == 1)
}

@Test @MainActor func interruptedBootstrapKeepsOldCommittedStateAndFrozenBoundary() throws {
    let (folder, url, replica) = try replicaFixture()
    defer { try? FileManager.default.removeItem(at: folder) }
    let original = projectedItem()
    try replica.bootstrap(bootstrapPage(cursor: 1, items: [original]), first: true)
    try replica.clearCommands()
    try replica.bootstrap(bootstrapPage(cursor: 20, items: [projectedItem("replacement-a")], more: true, sequence: 5), first: true)
    #expect(try replica.cursor == 1)
    #expect(try replica.ready)
    #expect(try encoded(persistedJSON(url, table: "items", id: "synthetic")!) == encoded(original))
    #expect(try persistedJSON(url, table: "items", id: "replacement-a") == nil)
    #expect(throws: SyncError.self) { try replica.bootstrap(bootstrapPage(cursor: 21, items: [projectedItem("replacement-b")], sequence: 5), first: false) }
    #expect(try replica.cursor == 1)
    try replica.bootstrap(bootstrapPage(cursor: 20, items: [projectedItem("replacement-b")], sequence: 5), first: false)
    #expect(try replica.cursor == 20)
    #expect(try replica.commandsPending)
    #expect(try persistedJSON(url, table: "items", id: "synthetic") == nil)
    #expect(try persistedJSON(url, table: "items", id: "replacement-a") != nil)
    #expect(try persistedJSON(url, table: "items", id: "replacement-b") != nil)
}

@Test @MainActor func freshIncompleteBootstrapPersistsWithoutPublishingPartialItemsOrCursor() throws {
    let (folder, url, replica) = try replicaFixture()
    defer { try? FileManager.default.removeItem(at: folder) }
    try replica.bootstrap(bootstrapPage(cursor: 7, items: [projectedItem()], more: true), first: true)
    #expect(try !replica.ready)
    #expect(try replica.cursor == 0)
    #expect(try persistedJSON(url, table: "items", id: "synthetic") == nil)
    let reopened = try LocalReplica(url: url)
    #expect(try !reopened.ready)
    #expect(try reopened.cursor == 0)
    try reopened.bootstrap(bootstrapPage(cursor: 8, items: [projectedItem("new-root")]), first: true)
    #expect(try reopened.ready)
    #expect(try reopened.cursor == 8)
    #expect(try persistedJSON(url, table: "items", id: "synthetic") == nil)
}

@Test @MainActor func malformedBootstrapDoesNotPublishAnInvalidCanonicalItem() throws {
    let (folder, url, replica) = try replicaFixture()
    defer { try? FileManager.default.removeItem(at: folder) }
    try replica.bootstrap(bootstrapPage(cursor: 1, items: [projectedItem()]), first: true)
    #expect(throws: SyncError.self) { try replica.bootstrap(bootstrapPage(cursor: 9, items: [projectedItem("malformed", deleted: 2)]), first: true) }
    #expect(try replica.cursor == 1)
    #expect(try persistedJSON(url, table: "items", id: "synthetic") != nil)
    #expect(try persistedJSON(url, table: "items", id: "malformed") == nil)
}

@Test @MainActor func completedBootstrapRemovesProjectionsOutsideItsFrozenState() throws {
    let (folder, url, replica) = try replicaFixture()
    defer { try? FileManager.default.removeItem(at: folder) }
    try replica.bootstrap(bootstrapPage(cursor: 1, items: [projectedItem()]), first: true)
    try replica.apply(feedPage(2, [change(2, kind: "operation", id: "old", payload: ["operation": ["id": "old", "state": "queued"], "command_changed": true])]))
    #expect(try persistedJSON(url, table: "projections", id: "operation:old") != nil)
    try replica.bootstrap(bootstrapPage(cursor: 10, items: [projectedItem("new-root")]), first: true)
    #expect(try replica.cursor == 10)
    #expect(try persistedJSON(url, table: "projections", id: "operation:old") == nil)
}
