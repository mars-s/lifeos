import Foundation
import Testing
@testable import SyncCore

private func value(_ v: Any) -> JSON { ["state": "value", "value": v] }
private func operation(_ op: String = "update", policy: String = "things_wins") -> JSON {
    var p: JSON = ["version": 4, "protocol": "things_ops_v1", "op": op, "kind": "todo", "target": "task",
                   "base": ["title": value("Before")], "base_revisions": ["title": 1], "conflict_policy": policy,
                   "intent_kind": "explicit_set", "depends_on": [], "refs": [], "verify": ["title"], "fields": ["title": "After"]]
    if op == "create" { p["target"] = "tmp-new"; p["temp_id"] = "tmp-new"; p["base"] = JSON() }
    return p
}
@Test func thingsPayloadRejectsWrongProtocolAndVerifyKeys() throws {
    _ = try ThingsOperation(operation())
    var p = operation(); p["protocol"] = "unknown"
    #expect(throws: SyncError.self) { try ThingsOperation(p) }
    p = operation(); p["verify"] = ["title", "notes"]
    #expect(throws: SyncError.self) { try ThingsOperation(p) }
}
@Test func thingsRefsResolveOnlyReferencePositionsAndLeaveNullQueued() throws {
    var p = operation(); p["target"] = "tmp-task"; p["fields"] = ["title": "tmp-task"]
    p["container"] = ["type": "project", "id": "tmp-project"]
    let op = try ThingsOperation(p)
    #expect(try op.resolving(["tmp-task": NSNull()]) == nil)
    #expect(try op.resolving([:]) == nil)
    let resolved = try op.resolving(["tmp-task": "Real1", "tmp-project": "Real2"])!
    #expect(resolved.payload["target"] as? String == "Real1")
    #expect((resolved.payload["fields"] as? JSON)?["title"] as? String == "tmp-task")
    #expect((resolved.payload["container"] as? JSON)?["id"] as? String == "Real2")
}
@Test func thingsVerifyNormalisesNullDeadlineAndTagCaseButRequiresEveryKey() throws {
    var p = operation(); p["fields"] = ["deadline": NSNull(), "tags": ["Home", "Errand"]]; p["verify"] = ["deadline", "tags"]
    let op = try ThingsOperation(p)
    #expect(op.matches(["deadline": ["state": "absent"], "tags": value(["errand", "HOME"])]))
    #expect(!op.matches(["tags": value(["Home", "Errand"])]))
    #expect(!op.matches(["deadline": ["state": "absent"], "tags": value(["Home"])]))
    #expect(op.verified(["deadline": ["state": "absent"], "extra": value(1)]).keys.sorted() == ["deadline", "tags"])
}
@Test func thingsPoliciesCompareBasesAndClassifyEachVerifyKey() throws {
    let op = try ThingsOperation(operation(policy: "smart_merge_v1"))
    #expect(!op.conflicts(["title": value("Before")]))
    #expect(op.conflicts(["title": value("Local")]))
    #expect((op.decision(["title": value("Before")])["fields"] as? [String: String])?["title"] == "cloud_only")
    #expect((op.decision(["title": value("Local")])["fields"] as? [String: String])?["title"] == "cloud_fallback")
    #expect((op.decision(["title": value("After")])["fields"] as? [String: String])?["title"] == "same_value")
    let create = try ThingsOperation(operation("create"))
    #expect((create.decision([:])["fields"] as? [String: String])?["title"] == "created")
}
@Test func thingsUnsupportedVerificationIsLimitedToContractExceptions() throws {
    let title = try ThingsOperation(operation())
    #expect(!title.matches(["title": ["state": "unsupported"]]))
    var p = operation(); p["fields"] = ["checklist": []]; p["verify"] = ["checklist"]
    #expect(try ThingsOperation(p).matches(["checklist": ["state": "unsupported"]]))
}
@Test func thingsWhenUsesPublicListsAndPreservesUnknownActivation() {
    #expect(thingsWhen(activation: ["state": "absent"], lists: [], today: "2026-10-31")["value"] as? String == "anytime")
    #expect(thingsWhen(activation: ["state": "unknown"], lists: [], today: "2026-10-31")["state"] as? String == "unknown")
    #expect(thingsWhen(activation: ["state": "absent"], lists: ["TMSomedayListSource"], today: "2026-10-31")["value"] as? String == "someday")
    #expect(thingsWhen(activation: ["state": "absent"], lists: ["TMTodayListSource"], today: "2026-10-31")["value"] as? String == "today")
}

@MainActor private final class OperationThings: ThingsAutomation {
    var title = "Before", creates = 0, writes = 0
    var onFinish: (() throws -> Void)?
    var requests: [JSON] = []
    func inventory() async throws -> JSON { try await FixtureThings().inventory() }
    func apply(_ p: JSON) async throws -> JSON {
        requests.append(p)
        switch p["v4_action"] as? String {
        case "read": return ["fields": ["title": value(title), "extra": value("not in audit")]]
        case "write":
            if p["op"] as? String == "create" { creates += 1; title = "After"; return ["created_id": "New1"] }
            writes += 1; title = (p["fields"] as? JSON)?["title"] as? String ?? title; return [:]
        case "finish_create": try onFinish?(); return [:]
        default: throw SyncError.invalid
        }
    }
}
@MainActor private func operationFixture(_ p: JSON) throws -> (URL, Journal, FixtureCloud, OperationThings, SyncEngine) {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let journal = try Journal(url: root.appendingPathComponent("journal.json"))
    let cloud = FixtureCloud(), things = OperationThings()
    cloud.operations = [["id": "v4", "ordinal": 1, "state": "queued", "payload": p, "resolved_refs": JSON()]]
    let engine = SyncEngine(journal: journal, cloud: cloud, things: things); try engine.pause(false)
    return (root, journal, cloud, things, engine)
}
@Test @MainActor func thingsCreateIDIsDurableBeforeFinishAndAckRetriesNeverCreateAgain() async throws {
    let (root, journal, cloud, things, engine) = try operationFixture(operation("create", policy: "smart_merge_v1"))
    defer { try? FileManager.default.removeItem(at: root) }
    things.onFinish = {
        let disk = try JSONDecoder().decode(JournalState.self, from: Data(contentsOf: journal.url))
        #expect(disk.intents["v4"]?.createdID == "New1")
        #expect(disk.intents["v4"]?.phase == "writing")
    }
    cloud.loseAck = true
    await engine.cycle(force: true)
    #expect(things.creates == 1)
    let receipt = try decoded(cloud.ackBodies[0])
    #expect((receipt["result"] as? JSON)?["created_id"] as? String == "New1")
    #expect(receipt["applied_after_sequence"] as? Int == 0)
    #expect((receipt["verified_after"] as? JSON)?.keys.sorted() == ["title"])
    #expect((receipt["observed_before"] as? JSON)?.keys.sorted() == ["title"])
    #expect((receipt["merge_decision"] as? JSON)?["algorithm"] as? String == "things_fields_v1")
    await engine.cycle(force: true)
    #expect(things.creates == 1)
    #expect(cloud.ackBodies[0] == cloud.ackBodies[1])
    #expect(journal.state.receiptConfirmations.isEmpty)
    #expect(cloud.uploads.count == 1)
}
@Test @MainActor func thingsInterruptedCreateWithoutIDNeverCallsAutomation() async throws {
    let (root, journal, cloud, things, engine) = try operationFixture(operation("create"))
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.operations[0]["state"] = "executing"
    let intent = Intent(id: "v4", claim: "retained", payload: try encoded(operation("create")), phase: "writing", result: nil)
    try journal.update { $0.intents["v4"] = intent }
    await engine.cycle(force: true)
    #expect(things.creates == 0)
    #expect((try decoded(cloud.ackBodies[0])["result"] as? JSON)?["reason"] as? String == "interrupted_write")
}
@Test @MainActor func thingsInterruptedCreateWithIDOnlyReadsAndReportsSatisfied() async throws {
    let (root, journal, cloud, things, engine) = try operationFixture(operation("create"))
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.operations[0]["state"] = "executing"; things.title = "After"
    var intent = Intent(id: "v4", claim: "retained", payload: try encoded(operation("create")), phase: "writing", result: nil)
    intent.createdID = "New1"; intent.appliedAfterSequence = 0
    try journal.update { $0.intents["v4"] = intent }
    await engine.cycle(force: true)
    #expect(things.creates == 0)
    #expect((try decoded(cloud.ackBodies[0])["result"] as? JSON)?["created_id"] as? String == "New1")
    #expect((try decoded(cloud.ackBodies[0])["result"] as? JSON)?["state"] as? String == "satisfied")
}
@Test @MainActor func thingsWinsSkipsDivergenceAndCloudWinsApplies() async throws {
    for policy in ["things_wins", "cloud_wins", "smart_merge_v1"] {
        let (root, _, cloud, things, engine) = try operationFixture(operation(policy: policy))
        defer { try? FileManager.default.removeItem(at: root) }
        things.title = "Local"
        await engine.cycle(force: true)
        #expect(things.writes == (policy == "things_wins" ? 0 : 1))
        let receipt = try decoded(cloud.ackBodies[0])
        #expect(receipt["applied_after_sequence"] as? Int == 0)
        #expect((receipt["merge_decision"] != nil) == (policy == "smart_merge_v1"))
    }
}
@Test @MainActor func replicaAcceptsHeadingBeforeMacAdvertisesHeadingScope() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let replica = try LocalReplica(url: root.appendingPathComponent("replica.sqlite"))
    try replica.bootstrap(["version": 3, "cursor": 0, "sequence": 0, "operation_revision": 0, "has_more": false,
                           "items": [["id": "heading1", "kind": "heading", "deleted": 0, "fields": ["title": value("Later"), "project_id": value("project1")]]]], first: true)
    #expect(try replica.ready)
}

@Test @MainActor func thingsNullRefsStayQueuedWithoutClaimAndResolvedTargetIsSubstituted() async throws {
    var p = operation(); p["target"] = "tmp-task"; p["base"] = JSON()
    let (root, journal, cloud, things, engine) = try operationFixture(p)
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.operations[0]["resolved_refs"] = ["tmp-task": NSNull()]
    await engine.cycle(force: true)
    #expect(!cloud.events.contains("claim"))
    #expect(journal.state.intents.isEmpty)
    #expect(things.requests.isEmpty)
    cloud.operations[0]["resolved_refs"] = ["tmp-task": "Real1"]
    await engine.cycle(force: true)
    #expect(things.requests.allSatisfy { $0["target"] as? String == "Real1" })
    #expect(things.writes == 1)
}
@Test @MainActor func thingsPendingOrderIsPreservedRatherThanSortingOperationIDs() async throws {
    let (root, _, cloud, things, engine) = try operationFixture(operation(policy: "cloud_wins"))
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.operations[0]["id"] = "z-first"
    var second = operation(policy: "cloud_wins"); second["fields"] = ["title": "Last"]
    cloud.operations.append(["id": "a-last", "ordinal": 2, "state": "queued", "payload": second, "resolved_refs": JSON()])
    await engine.cycle(force: true)
    #expect(things.title == "Last")
    #expect(try cloud.ackBodies.map { try decoded($0)["id"] as? String } == ["z-first", "a-last"])
}
@Test @MainActor func thingsInterruptedKnownCreateMismatchNeverFinishesOrCreatesAgain() async throws {
    let (root, journal, cloud, things, engine) = try operationFixture(operation("create"))
    defer { try? FileManager.default.removeItem(at: root) }
    cloud.operations[0]["state"] = "executing"
    var intent = Intent(id: "v4", claim: "retained", payload: try encoded(operation("create")), phase: "writing", result: nil)
    intent.createdID = "New1"; intent.appliedAfterSequence = 0
    try journal.update { $0.intents["v4"] = intent }
    await engine.cycle(force: true)
    #expect(things.requests.count == 1)
    #expect(things.requests.first?["v4_action"] as? String == "read")
    let result = try decoded(cloud.ackBodies[0])["result"] as? JSON
    #expect(result?["state"] as? String == "uncertain")
    #expect(result?["reason"] as? String == "interrupted_write")
    #expect(result?["created_id"] == nil)
}
