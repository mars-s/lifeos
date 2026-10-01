import Foundation
import Testing
import CSQLite
@testable import SyncCore

@MainActor final class FixtureThings: ThingsAutomation {
    var title = "Fixture"
    var writes = 0
    var failInventory = false
    var reads = 0
    var duringRead: (() throws -> Void)?
    var afterWrite: (() throws -> Void)?
    func inventory() async throws -> JSON {
        reads += 1
        try duringRead?()
        if failInventory { throw SyncError.automation }
        return ["items": [["id": "task", "kind": "todo", "fields": ["title": ["state": "value", "value": title]]]],
                "zone": "Australia/Melbourne", "scopes": ["todo", "project", "area", "tag"],
                "coverage": "public-top-level-and-all-lists-v2",
                "coverage_evidence": ["consistent_passes": 2, "classified_records": 1, "list_ids": []]]
    }
    func apply(_ payload: JSON) async throws -> JSON {
        if title == payload["value"] as? String { return ["state": "satisfied"] }
        guard let base = payload["base"] as? JSON, payload["conflict_policy"] as? String == "cloud_wins" || title == base["value"] as? String else { return ["state": "skipped", "reason": "things_changed"] }
        writes += 1; title = payload["value"] as! String
        try afterWrite?()
        return ["state": "applied"]
    }
}
@Test @MainActor func pauseStopsSubsequentWritesButKeepsCurrentReceipt() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.queue("first"); cloud.queue("second", base: "Cloud", desired: "Later")
    things.afterWrite = { try engine.pause(true) }
    await engine.cycle(force: true)
    #expect(things.writes == 1)
    #expect(cloud.operations[0]["state"] as? String == "applied")
    #expect(cloud.operations[1]["state"] as? String == "queued")
    #expect(journal.state.intents.isEmpty)
    #expect(engine.message == "Paused")
}
@MainActor final class FixtureCloud: CloudTransport {
    var sequence = 0
    var operations: [JSON] = []
    var loseAck = false
    var loseUpload = false
    var acknowledgements = 0
    var ackBodies: [Data] = []
    var uploads: [Data] = []
    var supersedeBeforeClaim = false
    var events: [String] = []
    var confirmationNeeded = false
    var failPending = false
    func request(_ path: String, body: JSON?) async throws -> JSON {
        events.append(path)
        switch path {
        case "pending":
            if failPending { throw SyncError.http(500) }
            return ["sequence": sequence, "revision": operations.count, "overlaysNeedConfirmation": confirmationNeeded, "operations": Array(operations.filter { ["queued", "executing"].contains($0["state"] as? String ?? "") }.sorted { ($0["state"] as? String == "queued" ? 0 : 1) < ($1["state"] as? String == "queued" ? 0 : 1) }.prefix(20))]
        case "snapshot":
            let bytes = try encoded(body!); uploads.append(bytes)
            sequence = body!["sequence"] as! Int
            if loseUpload { loseUpload = false; throw SyncError.http(500) }
            return ["duplicate": false]
        case "claim":
            guard let index = operations.firstIndex(where: { $0["id"] as? String == body!["id"] as? String }) else { throw SyncError.invalid }
            if supersedeBeforeClaim { operations[index]["state"] = "superseded"; throw SyncError.http(409) }
            operations[index]["claim"] = body!["claim"]; operations[index]["state"] = "executing"
            return operations[index]
        case "operation":
            var operation = operations.first { $0["id"] as? String == body!["id"] as? String }!
            let target = (operation["payload"] as? JSON)?["target"] as? String
            let field = (operation["payload"] as? JSON)?["field"] as? String
            operation["current_desired_revision"] = operations.filter { ($0["payload"] as? JSON)?["target"] as? String == target && ($0["payload"] as? JSON)?["field"] as? String == field }.compactMap { $0["ordinal"] as? Int }.max() ?? 0
            return operation
        case "ack":
            ackBodies.append(try encoded(body!))
            acknowledgements += 1
            let index = operations.firstIndex { $0["id"] as? String == body!["id"] as? String }!
            operations[index]["result"] = body!["result"]
            operations[index]["state"] = (body!["result"] as! JSON)["state"]
            if loseAck { loseAck = false; throw SyncError.http(500) }
            return operations[index]
        default: throw SyncError.invalid
        }
    }
    func queue(_ id: String = "op", base: String = "Fixture", desired: String = "Cloud") {
        operations.append(["id": id, "ordinal": operations.count + 1, "state": "queued", "payload": ["target": "task", "kind": "todo", "field": "title", "value": desired,
                            "base": ["state": "value", "value": base], "conflict_policy": "things_wins"]])
    }
}
@Test @MainActor func supersededPreparedEditCannotBlockSync() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.queue(); cloud.supersedeBeforeClaim = true
    await engine.cycle(force: true)
    #expect(things.writes == 0)
    #expect(journal.state.intents.isEmpty)
    #expect(engine.message == "Synced")
}
@MainActor func fixture() throws -> (URL, Journal, FixtureThings, FixtureCloud, SyncEngine) {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let journal = try Journal(url: root.appendingPathComponent("journal.json"))
    let things = FixtureThings(), cloud = FixtureCloud()
    let engine = SyncEngine(journal: journal, cloud: cloud, things: things)
    try engine.pause(false)
    return (root, journal, things, cloud, engine)
}

@Test @MainActor func completionReceiptLostDoesNotRepeatWrite() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.queue(); cloud.loseAck = true
    await engine.cycle(force: true)
    #expect(things.writes == 1)
    #expect(journal.state.intents["op"]?.result != nil)
    await engine.cycle(force: true)
    #expect(things.writes == 1)
    #expect(cloud.acknowledgements == 2)
    #expect(journal.state.intents.isEmpty)
}
@Test @MainActor func localEditWinsAutomatically() async throws {
    let (root, _, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.queue(); things.title = "Local edit"
    await engine.cycle(force: true)
    #expect(things.writes == 0)
    #expect(things.title == "Local edit")
    #expect(cloud.operations[0]["state"] as? String == "skipped")
}
@Test @MainActor func interruptedWriteIsNeverRepeated() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.queue()
    let payload = cloud.operations[0]["payload"] as! JSON
    let intent = Intent(id: "op", claim: "claim", payload: try encoded(payload), phase: "writing", result: nil)
    cloud.operations[0]["claim"] = "claim"; cloud.operations[0]["state"] = "executing"
    try journal.update { $0.intents["op"] = intent }
    await engine.cycle(force: true)
    #expect(things.writes == 0)
    #expect(cloud.operations[0]["state"] as? String == "uncertain")
    #expect(journal.state.intents.isEmpty)
    #expect(journal.state.uncertainOperationIDs == ["op"])
    #expect(engine.message.contains("uncertain"))
    await engine.cycle(force: true)
    #expect(engine.message.contains("uncertain"))
    #expect(cloud.acknowledgements == 1)
    #expect(things.writes == 0)
}
@Test @MainActor func snapshotRetryUsesIdenticalDurablePayload() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.loseUpload = true
    await engine.cycle(force: true)
    #expect(journal.state.pendingUpload != nil)
    things.title = "Changed after attempt"
    await engine.cycle(force: true)
    #expect(cloud.uploads.count == 2)
    #expect(cloud.uploads[0] == cloud.uploads[1])
    #expect(journal.state.pendingUpload == nil)
}
@Test @MainActor func missingJournalCannotResetCloudSequence() async throws {
    let (root, journal, _, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.sequence = 29
    await engine.cycle(force: true)
    #expect(journal.state.sequence == 0)
    #expect(cloud.uploads.isEmpty)
    #expect(engine.message.contains("Import"))
}
@Test @MainActor func singletonAndJournalPersist() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    var journal: Journal? = try Journal(url: root.appendingPathComponent("journal.json"))
    try journal!.update { $0.sequence = 29; $0.paused = false }
    #expect(throws: (any Error).self) { try Journal(url: root.appendingPathComponent("journal.json")) }
    journal = nil
    let reloaded = try Journal(url: root.appendingPathComponent("journal.json"))
    #expect(reloaded.state.sequence == 29)
    #expect(reloaded.state.paused == false)
}
@Test @MainActor func legacyImportKeepsSequenceAndOnlineBackup() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let old = root.appendingPathComponent("old.sqlite3")
    var db: OpaquePointer?
    #expect(sqlite3_open(old.path, &db) == SQLITE_OK)
    #expect(sqlite3_exec(db, "CREATE TABLE uploads(seq INTEGER,delivered INTEGER);INSERT INTO uploads VALUES(29,1);", nil, nil, nil) == SQLITE_OK)
    sqlite3_close(db)
    let journal = try Journal(url: root.appendingPathComponent("journal.json")), backup = root.appendingPathComponent("backup.sqlite3")
    try journal.importLegacy(from: old, backup: backup)
    #expect(journal.state.sequence == 29)
    #expect(journal.state.paused == true)
    #expect(FileManager.default.fileExists(atPath: backup.path))
    #expect(throws: (any Error).self) { try journal.importLegacy(from: old, backup: backup) }
}

@Test @MainActor func queueDrainsMultiplePagesBeforeInventoryAndEscapesForeignClaim() async throws {
    let (root, _, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.queue("foreign"); cloud.operations[0]["state"] = "executing"
    for index in 0..<45 { cloud.queue("op\(index)", base: index == 0 ? "Fixture" : "Cloud", desired: "Cloud") }
    await engine.cycle(force: true)
    #expect(cloud.operations.filter { $0["state"] as? String == "queued" }.isEmpty)
    #expect(things.reads == 1)
    #expect(cloud.events.lastIndex(of: "ack")! < cloud.events.firstIndex(of: "snapshot")!)
    #expect(engine.message.contains("recovery"))
}

@Test @MainActor func pausedAndBusyEventsRemainDurableAndUnchangedInventoryDeduplicates() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    try engine.pause(true)
    try engine.invalidate(local: true, revision: 12)
    await engine.cycle(force: true)
    #expect(journal.state.localGeneration == 2)
    #expect(journal.state.cloudRevision == 12)
    #expect(things.reads == 0)
    try engine.pause(false)
    things.duringRead = { try engine.invalidate(local: true, revision: 13) }
    await engine.cycle(force: true)
    #expect(journal.state.localGeneration > journal.state.uploadedLocalGeneration)
    #expect(journal.state.cloudGeneration > journal.state.drainedCloudGeneration)
    things.duringRead = nil
    await engine.cycle(force: true)
    #expect(cloud.uploads.count == 1)
    #expect(journal.state.localGeneration == journal.state.uploadedLocalGeneration)
    cloud.confirmationNeeded = true
    await engine.cycle(force: true)
    #expect(cloud.uploads.count == 2)
    #expect((try decoded(cloud.uploads[1])["manifest"] as? JSON)?["seen_cloud_revision"] as? Int == 13)
}

@Test func oldJournalFieldsDecodeWithSafeDefaults() throws {
    let state = try JSONDecoder().decode(JournalState.self, from: Data("{\"sequence\":29,\"paused\":false,\"intents\":{},\"failures\":0}".utf8))
    #expect(state.sequence == 29)
    #expect(state.localGeneration == 1)
    #expect(state.cloudRevision == 0)
    #expect(!state.confirmationNeeded)
    #expect(state.uncertainOperationIDs.isEmpty)
}

@Test @MainActor func interruptedVersionedSetterPreservesOriginalFenceAndReceiptRetry() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.queue()
    var payload = cloud.operations[0]["payload"] as! JSON
    payload["version"] = 2; payload["conflict_policy"] = "cloud_wins"
    cloud.operations[0]["payload"] = payload
    cloud.operations[0]["claim"] = "original"; cloud.operations[0]["state"] = "executing"
    var intent = Intent(id: "op", claim: "original", payload: try encoded(payload), phase: "writing", result: nil)
    intent.appliedAfterSequence = 5
    try journal.update { $0.sequence = 8; $0.intents["op"] = intent }
    cloud.sequence = 8; cloud.loseAck = true; things.title = "Local"
    await engine.cycle(force: true)
    #expect(things.writes == 1)
    #expect(journal.state.intents["op"]?.appliedAfterSequence == 5)
    await engine.cycle(force: true)
    #expect(things.writes == 1)
    #expect(cloud.ackBodies.count == 2)
    #expect(cloud.ackBodies[0] == cloud.ackBodies[1])
    #expect(try decoded(cloud.ackBodies[1])["applied_after_sequence"] as? Int == 5)
}

@Test @MainActor func queuedWorkPrecedesOldUploadRetryAndCursorWaitsForAcceptance() async throws {
    let (root, journal, _, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    try engine.invalidate(local: true, eventID: 42)
    cloud.loseUpload = true
    await engine.cycle(force: true)
    #expect(journal.state.confirmedEventID == 0)
    #expect(journal.state.pendingEventID == 42)
    let exact = journal.state.pendingUpload
    cloud.queue(); cloud.events = []
    await engine.cycle(force: true)
    #expect(cloud.events.firstIndex(of: "ack")! < cloud.events.firstIndex(of: "snapshot")!)
    #expect(cloud.uploads[1] == exact)
    #expect(journal.state.confirmedEventID == 42)
}

@Test @MainActor func automaticInvalidationsRespectFailureBackoffAndRetainWork() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.failPending = true
    try engine.invalidate(revision: 7)
    await engine.cycle()
    let deadline = journal.state.retryAfter
    #expect(deadline != nil)
    for event in 1...20 {
        try engine.invalidate(local: true, revision: 7, eventID: UInt64(event))
        await engine.cycle()
    }
    #expect(engine.pendingRequests == 1)
    #expect(things.reads == 0)
    #expect(journal.state.failures == 1)
    #expect(journal.state.retryAfter == deadline)
    #expect(journal.state.cloudGeneration == 1)
    #expect(journal.state.localGeneration > journal.state.uploadedLocalGeneration)
    #expect(journal.state.confirmedEventID == 0)
    cloud.failPending = false
    try journal.update { $0.retryAfter = Date().addingTimeInterval(-1) }
    await engine.cycle()
    #expect(engine.pendingRequests == 2)
    #expect(things.reads == 1)
    #expect(journal.state.retryAfter == nil)
    #expect(journal.state.localGeneration == journal.state.uploadedLocalGeneration)
    #expect(journal.state.confirmedEventID == 20)
}

@Test @MainActor func duplicateCloudHintsDoNotAddWorkButNewConnectionRetainsCatchup() throws {
    let (root, journal, _, _, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    #expect(try engine.invalidate(revision: 9))
    let generation = journal.state.cloudGeneration
    #expect(try !engine.invalidate(revision: 9))
    #expect(try !engine.invalidate(revision: 8))
    #expect(journal.state.cloudGeneration == generation)
    #expect(try engine.invalidate(revision: 9, reconcile: true))
    #expect(journal.state.cloudGeneration == generation + 1)
    #expect(journal.state.cloudRevision == 9)
    #expect(try !engine.invalidate(revision: 9))
}

@Test @MainActor func newerDesiredRevisionPreventsInterruptedOlderSetterReplay() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.queue("old", desired: "Older")
    cloud.queue("new", desired: "Latest")
    for index in cloud.operations.indices {
        var payload = cloud.operations[index]["payload"] as! JSON
        payload["version"] = 2; payload["conflict_policy"] = "cloud_wins"
        cloud.operations[index]["payload"] = payload
    }
    let payload = cloud.operations[0]["payload"] as! JSON
    cloud.operations[0]["state"] = "executing"; cloud.operations[0]["claim"] = "original"
    var intent = Intent(id: "old", claim: "original", payload: try encoded(payload), phase: "writing", result: nil)
    intent.appliedAfterSequence = 0
    try journal.update { $0.intents["old"] = intent }
    things.title = "Local after interruption"
    await engine.cycle(force: true)
    #expect(things.writes == 1)
    #expect(things.title == "Latest")
    #expect(cloud.operations[0]["state"] as? String == "skipped")
    #expect((cloud.operations[0]["result"] as? JSON)?["reason"] as? String == "newer_cloud_edit")
    #expect(cloud.operations[1]["state"] as? String == "applied")
    #expect(journal.state.intents.isEmpty)
}

@Test @MainActor func finalCloudReceiptBlocksInterruptedRecoveryWithoutInventingReceipt() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.queue()
    var payload = cloud.operations[0]["payload"] as! JSON
    payload["version"] = 2; payload["conflict_policy"] = "cloud_wins"
    cloud.operations[0]["payload"] = payload
    cloud.operations[0]["state"] = "uncertain"; cloud.operations[0]["claim"] = "original"
    cloud.operations[0]["result"] = ["state": "uncertain", "reason": "interrupted_write"]
    let intent = Intent(id: "op", claim: "original", payload: try encoded(payload), phase: "writing", result: nil)
    try journal.update { $0.intents["op"] = intent }
    await engine.cycle(force: true)
    #expect(things.writes == 0)
    #expect(cloud.ackBodies.isEmpty)
    #expect(journal.state.intents["op"]?.phase == "writing")
    #expect(journal.state.intents["op"]?.result == nil)
    #expect(engine.message.contains("journal recovery"))
}
