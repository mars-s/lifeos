import Foundation
import Testing
import CSQLite
@testable import SyncCore

@MainActor final class FixtureThings: ThingsAutomation {
    var title = "Fixture"
    var writes = 0
    var failInventory = false
    func inventory() async throws -> JSON {
        if failInventory { throw SyncError.automation }
        return ["items": [["id": "task", "kind": "todo", "fields": ["title": ["state": "value", "value": title]]]],
                "zone": "Australia/Melbourne", "scopes": ["todo", "project", "area", "tag"],
                "coverage": "public-top-level-and-all-lists-v2",
                "coverage_evidence": ["consistent_passes": 2, "classified_records": 1, "list_ids": []]]
    }
    func apply(_ payload: JSON) async throws -> JSON {
        if title == payload["value"] as? String { return ["state": "satisfied"] }
        guard let base = payload["base"] as? JSON, title == base["value"] as? String else { return ["state": "skipped", "reason": "things_changed"] }
        writes += 1; title = payload["value"] as! String
        return ["state": "applied"]
    }
}
@MainActor final class FixtureCloud: CloudTransport {
    var sequence = 0
    var operations: [JSON] = []
    var loseAck = false
    var loseUpload = false
    var acknowledgements = 0
    var uploads: [Data] = []
    var supersedeBeforeClaim = false
    func request(_ path: String, body: JSON?) async throws -> JSON {
        switch path {
        case "pending": return ["sequence": sequence, "operations": operations.filter { ["queued", "executing"].contains($0["state"] as? String ?? "") }]
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
        case "operation": return operations.first { $0["id"] as? String == body!["id"] as? String }!
        case "ack":
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
        operations.append(["id": id, "state": "queued", "payload": ["target": "task", "kind": "todo", "field": "title", "value": desired,
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
