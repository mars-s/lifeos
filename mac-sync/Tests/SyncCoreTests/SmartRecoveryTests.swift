import Foundation
import Testing
@testable import SyncCore

@MainActor private final class SmartFaultThings: ThingsAutomation {
    var preparationFails = false
    var invocationFails = false
    var prepares = 0
    var invocations = 0
    var duringPreparation: (() -> Void)?
    var duringInvocation: ((JSON) throws -> Void)?
    func inventory() async throws -> JSON { try await FixtureThings().inventory() }
    func apply(_ payload: JSON) async throws -> JSON {
        if payload["prepare_only"] as? Bool == true {
            prepares += 1
            if preparationFails { throw SyncError.automation }
            duringPreparation?()
            return ["merge_decision": ["algorithm": "supported_fields_v1", "intent_kind": "explicit_set", "classification": "cloud_only", "base": payload["base"]!, "local": ["state": "value", "value": "Fixture"], "desired": payload["value"]!]]
        }
        invocations += 1
        try duringInvocation?(payload)
        if invocationFails { throw SyncError.automation }
        return ["state": "applied"]
    }
}

@Test @MainActor func smartDecisionIsDurableBeforeInvocationAndAckLossReplaysExactReceipt() async throws {
    let (root, journal, cloud, things, engine) = try smartFixture()
    defer { try? FileManager.default.removeItem(at: root) }
    things.duringInvocation = { payload in
        let reopened = try Journal(url: journal.url)
        #expect(reopened.state.intents["op"]?.phase == "writing")
        #expect(reopened.state.intents["op"]?.mergeDecision != nil)
        #expect(payload["prepared_decision"] as? JSON != nil)
    }
    cloud.loseAck = true
    await engine.cycle(force: true)
    #expect(things.invocations == 1)
    #expect(journal.state.intents["op"]?.phase == "receipt")
    let first = cloud.ackBodies[0]
    await engine.cycle(force: true)
    #expect(things.invocations == 1)
    #expect(things.prepares == 1)
    #expect(cloud.ackBodies[1] == first)
    #expect(journal.state.intents.isEmpty)
}

@Test @MainActor func smartWritingRecoveryWithOriginalBeforeValueInvokesVerificationOnly() async throws {
    let (root, journal, cloud, things, engine) = try smartFixture()
    defer { try? FileManager.default.removeItem(at: root) }
    let payload = cloud.operations[0]["payload"] as! JSON
    cloud.operations[0]["state"] = "executing"; cloud.operations[0]["claim"] = "retained"
    var intent = Intent(id: "op", claim: "retained", payload: try encoded(payload), phase: "writing", result: nil)
    intent.appliedAfterSequence = 0
    try journal.update { $0.intents["op"] = intent }
    things.invocationFails = true
    things.duringInvocation = { request in
        #expect(request["recovering"] as? Bool == true)
        #expect(request["prepare_only"] == nil)
    }
    await engine.cycle(force: true)
    #expect(things.prepares == 0)
    #expect(things.invocations == 1)
    #expect(cloud.operations[0]["state"] as? String == "uncertain")
    let recoveredAck = try decoded(cloud.ackBodies[0])
    let recoveredDecision = recoveredAck["merge_decision"] as? JSON
    #expect(recoveredDecision?["classification"] as? String == "interrupted")
    #expect(try encoded(recoveredDecision?["base"] as! JSON) == encoded(payload["base"] as! JSON))
    #expect(recoveredDecision?["desired"] as? String == payload["value"] as? String)
    #expect((recoveredAck["observed_before"] as? JSON)?["state"] as? String == "unknown")
    #expect((recoveredAck["observed_before"] as? JSON)?["reason"] as? String == "verification_failed")
    #expect(recoveredAck["verified_after"] == nil)
    await engine.cycle(force: true)
    #expect(things.invocations == 1)
}

@Test @MainActor func receiptConfirmationBatchesAreCapturedBeforeInventoryAndRetainedUntilAccepted() async throws {
    let (root, journal, things, cloud, engine) = try fixture()
    defer { try? FileManager.default.removeItem(at: root) }
    try journal.update { state in
        state.confirmationNeeded = true
        for n in 0..<255 { state.receiptConfirmations["proof-\(n)"] = try encoded(["id": "proof-\(n)", "ordinal": n + 1, "applied_after_sequence": 0, "receipt_hash": String(repeating: "a", count: 64)]) }
    }
    things.duringRead = {
        try journal.update { $0.receiptConfirmations["after-read-start"] = try encoded(["id": "after-read-start", "ordinal": 256, "applied_after_sequence": 0, "receipt_hash": String(repeating: "b", count: 64)]) }
        things.duringRead = nil
    }
    cloud.loseUpload = true
    await engine.cycle(force: true)
    let first = cloud.uploads[0]
    let proofs = (try decoded(first)["manifest"] as? JSON)?["receipt_confirmations"] as? [JSON]
    #expect(proofs?.count == 200)
    #expect(proofs?.contains { $0["id"] as? String == "after-read-start" } == false)
    #expect(journal.state.receiptConfirmations.count == 256)
    await engine.cycle(force: true)
    #expect(cloud.uploads[1] == first)
    #expect(cloud.uploads.count == 3)
    let remainder = (try decoded(cloud.uploads.last!)["manifest"] as? JSON)?["receipt_confirmations"] as? [JSON]
    #expect(remainder?.count == 56)
    #expect(remainder?.contains { $0["id"] as? String == "after-read-start" } == true)
    #expect(journal.state.receiptConfirmations.isEmpty)
    #expect(!journal.state.confirmationNeeded)
}

@MainActor private func smartFixture() throws -> (URL, Journal, FixtureCloud, SmartFaultThings, SyncEngine) {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let journal = try Journal(url: root.appendingPathComponent("journal.json"))
    let cloud = FixtureCloud(), things = SmartFaultThings()
    cloud.queue()
    var payload = cloud.operations[0]["payload"] as! JSON
    payload["version"] = 3; payload["conflict_policy"] = "smart_merge_v1"; payload["intent_kind"] = "explicit_set"
    cloud.operations[0]["payload"] = payload
    let engine = SyncEngine(journal: journal, cloud: cloud, things: things)
    try engine.pause(false)
    return (root, journal, cloud, things, engine)
}

@Test @MainActor func smartPreparationFailureRemainsClaimedAndCanRetryWithoutInventingAReceipt() async throws {
    let (root, journal, cloud, things, engine) = try smartFixture()
    defer { try? FileManager.default.removeItem(at: root) }
    things.preparationFails = true
    await engine.cycle(force: true)
    #expect(journal.state.intents["op"]?.phase == "claimed")
    #expect(cloud.acknowledgements == 0)
    #expect(things.invocations == 0)
    things.preparationFails = false
    await engine.cycle(force: true)
    #expect(things.invocations == 1)
    #expect(cloud.operations[0]["state"] as? String == "applied")
    #expect(journal.state.intents.isEmpty)
}

@Test @MainActor func smartInvocationFailureRetainsPreparedAuditAndFinalizesUncertainOnce() async throws {
    let (root, journal, cloud, things, engine) = try smartFixture()
    defer { try? FileManager.default.removeItem(at: root) }
    things.invocationFails = true
    await engine.cycle(force: true)
    #expect(things.invocations == 1)
    #expect(cloud.operations[0]["state"] as? String == "uncertain")
    let ack = try decoded(cloud.ackBodies[0])
    #expect((ack["merge_decision"] as? JSON)?["classification"] as? String == "cloud_only")
    #expect((ack["observed_before"] as? JSON)?["value"] as? String == "Fixture")
    #expect(ack["verified_after"] == nil)
    #expect(ack["applied_after_sequence"] as? Int == 0)
    #expect(journal.state.uncertainOperationIDs.contains("op"))
    await engine.cycle(force: true)
    #expect(things.invocations == 1)
}

@Test @MainActor func smartSupersessionAfterPreparationPreventsInvocation() async throws {
    let (root, _, cloud, things, engine) = try smartFixture()
    defer { try? FileManager.default.removeItem(at: root) }
    things.duringPreparation = {
        cloud.operations.append(["id": "new-head", "ordinal": 2, "state": "satisfied", "payload": cloud.operations[0]["payload"]!])
    }
    await engine.cycle(force: true)
    #expect(things.prepares == 1)
    #expect(things.invocations == 0)
    #expect((cloud.operations[0]["result"] as? JSON)?["reason"] as? String == "newer_cloud_edit")
}

@MainActor private final class OwnFeedCloud: CloudTransport {
    var paths: [String] = []
    var foreignClaim = false
    func request(_ path: String, body: JSON?) async throws -> JSON {
        paths.append(path)
        if foreignClaim && path == "pending" {
            return ["sequence": 0, "revision": 1, "smart_sync_version": 3, "operations": [["id": "foreign", "state": "executing", "claim": "other-adapter", "payload": ["target": "task"]]], "overlaysNeedConfirmation": false]
        }
        guard path == "changes" else { throw SyncError.invalid }
        return ["version": 3, "cursor": 2, "reset": false, "has_more": false, "changes": [["revision": 2, "kind": "operation", "id": "own-receipt", "payload": ["operation": ["id": "own-receipt", "state": "applied"], "command_changed": foreignClaim]]]]
    }
}

@Test @MainActor func blockedForeignSmartCommandConsumesHintWithoutRepeatedPendingOrInventory() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let journal = try Journal(url: root.appendingPathComponent("journal.json"))
    let replica = try LocalReplica(url: root.appendingPathComponent("replica.sqlite"))
    try replica.bootstrap(["version": 3, "cursor": 1, "sequence": 0, "operation_revision": 0, "has_more": false, "items": []], first: true)
    try replica.clearCommands()
    try journal.update { $0.smartSync = true; $0.paused = false; $0.uploadedLocalGeneration = $0.localGeneration }
    let cloud = OwnFeedCloud(), things = FixtureThings(); cloud.foreignClaim = true
    let engine = SyncEngine(journal: journal, cloud: cloud, things: things)
    _ = try engine.invalidateFeed(revision: 2)
    await engine.cycle()
    #expect(engine.message == "An operation needs journal recovery")
    #expect(!engine.replicaCommandsPending)
    await engine.cycle()
    #expect(cloud.paths.filter { $0 == "pending" }.count == 1)
    #expect(things.reads == 0)
    #expect(things.writes == 0)
}

@Test @MainActor func ownFeedReceiptAdvancesCursorWithoutPendingRequestOrInventory() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let journal = try Journal(url: root.appendingPathComponent("journal.json"))
    let replica = try LocalReplica(url: root.appendingPathComponent("replica.sqlite"))
    try replica.bootstrap(["version": 3, "cursor": 1, "sequence": 0, "operation_revision": 0, "has_more": false, "items": []], first: true)
    try replica.clearCommands()
    try journal.update { $0.smartSync = true; $0.paused = false; $0.uploadedLocalGeneration = $0.localGeneration }
    let cloud = OwnFeedCloud(), things = FixtureThings()
    let engine = SyncEngine(journal: journal, cloud: cloud, things: things)
    _ = try engine.invalidateFeed(revision: 2)
    await engine.cycle()
    #expect(engine.feedCursor == 2)
    #expect(cloud.paths == ["changes"])
    #expect(things.reads == 0)
    #expect(things.writes == 0)
    #expect(engine.pendingRequests == 0)
    #expect(!engine.replicaCommandsPending)
}
