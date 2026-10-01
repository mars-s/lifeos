import Foundation
import CSQLite
import Darwin
import CryptoKit

public typealias JSON = [String: Any]

public enum SyncError: Error, LocalizedError {
    case invalid, storage, configuration, migration, interrupted, http(Int), automation
    public var errorDescription: String? {
        switch self {
        case .http(401): "Cloud credential needs secure setup."
        case .http(503): "Cloud write activation is pending."
        case .http: "Cloud request failed; the durable journal is retained."
        case .storage: "Local journal could not be saved. Sync is stopped."
        case .migration: "Import the existing mirror journal before starting."
        case .configuration: "Secure credential unavailable. Use Authorize Keychain access once."
        case .automation: "Things automation is unavailable. Check its permission or open Things."
        case .interrupted: "An interrupted operation needs journal recovery."
        case .invalid: "Unsupported or invalid sync data."
        }
    }
}

public func encoded(_ value: JSON) throws -> Data {
    guard JSONSerialization.isValidJSONObject(value) else { throw SyncError.invalid }
    return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
}
public func decoded(_ data: Data) throws -> JSON {
    guard let value = try JSONSerialization.jsonObject(with: data) as? JSON else { throw SyncError.invalid }
    return value
}

public struct Intent: Codable, Equatable, Sendable {
    public let id: String
    public let claim: String
    public let payload: Data
    public var phase: String
    public var result: Data?
    public var appliedAfterSequence: Int? = nil
    public var observedBefore: Data? = nil
    public var verifiedAfter: Data? = nil
    public var mergeDecision: Data? = nil
}
public struct JournalState: Codable, Sendable {
    public var sequence: Int = 0
    public var pendingUpload: Data?
    public var intents: [String: Intent] = [:]
    public var paused = true
    public var lastSync: Date?
    public var failures = 0
    public var retryAfter: Date?
    public var cloudRevision = 0
    public var cloudGeneration = 0
    public var drainedCloudGeneration = 0
    public var localGeneration = 1
    public var uploadedLocalGeneration = 0
    public var semanticHash: String?
    public var pendingHash: String?
    public var pendingLocalGeneration: Int?
    public var confirmationNeeded = false
    public var localEventID: UInt64 = 0
    public var confirmedEventID: UInt64 = 0
    public var pendingEventID: UInt64?
    public var uncertainOperationIDs: Set<String> = []
    public var feedHint = 0
    public var smartSync = false
    public var receiptConfirmations: [String: Data] = [:]
    public init() {}
    private enum CodingKeys: String, CodingKey { case sequence, pendingUpload, intents, paused, lastSync, failures, retryAfter, cloudRevision, cloudGeneration, drainedCloudGeneration, localGeneration, uploadedLocalGeneration, semanticHash, pendingHash, pendingLocalGeneration, confirmationNeeded, localEventID, confirmedEventID, pendingEventID, uncertainOperationIDs, feedHint, smartSync, receiptConfirmations }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sequence = try c.decodeIfPresent(Int.self, forKey: .sequence) ?? 0
        pendingUpload = try c.decodeIfPresent(Data.self, forKey: .pendingUpload)
        intents = try c.decodeIfPresent([String: Intent].self, forKey: .intents) ?? [:]
        paused = try c.decodeIfPresent(Bool.self, forKey: .paused) ?? true
        lastSync = try c.decodeIfPresent(Date.self, forKey: .lastSync)
        failures = try c.decodeIfPresent(Int.self, forKey: .failures) ?? 0
        retryAfter = try c.decodeIfPresent(Date.self, forKey: .retryAfter)
        cloudRevision = try c.decodeIfPresent(Int.self, forKey: .cloudRevision) ?? 0
        cloudGeneration = try c.decodeIfPresent(Int.self, forKey: .cloudGeneration) ?? 0
        drainedCloudGeneration = try c.decodeIfPresent(Int.self, forKey: .drainedCloudGeneration) ?? 0
        localGeneration = try c.decodeIfPresent(Int.self, forKey: .localGeneration) ?? 1
        uploadedLocalGeneration = try c.decodeIfPresent(Int.self, forKey: .uploadedLocalGeneration) ?? 0
        semanticHash = try c.decodeIfPresent(String.self, forKey: .semanticHash)
        pendingHash = try c.decodeIfPresent(String.self, forKey: .pendingHash)
        pendingLocalGeneration = try c.decodeIfPresent(Int.self, forKey: .pendingLocalGeneration)
        confirmationNeeded = try c.decodeIfPresent(Bool.self, forKey: .confirmationNeeded) ?? false
        localEventID = try c.decodeIfPresent(UInt64.self, forKey: .localEventID) ?? 0
        confirmedEventID = try c.decodeIfPresent(UInt64.self, forKey: .confirmedEventID) ?? 0
        pendingEventID = try c.decodeIfPresent(UInt64.self, forKey: .pendingEventID)
        uncertainOperationIDs = try c.decodeIfPresent(Set<String>.self, forKey: .uncertainOperationIDs) ?? []
        feedHint = try c.decodeIfPresent(Int.self, forKey: .feedHint) ?? 0
        smartSync = try c.decodeIfPresent(Bool.self, forKey: .smartSync) ?? false
        receiptConfirmations = try c.decodeIfPresent([String: Data].self, forKey: .receiptConfirmations) ?? [:]
    }
}

@MainActor public final class Journal {
    public let url: URL
    public private(set) var state: JournalState
    private var lock: Int32 = -1
    public init(url: URL) throws {
        self.url = url
        let folder = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        if FileManager.default.fileExists(atPath: url.path) {
            guard (try url.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true else { throw SyncError.storage }
            state = try JSONDecoder().decode(JournalState.self, from: Data(contentsOf: url))
        } else { state = JournalState() }
        lock = open(folder.appendingPathComponent("agent.lock").path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else { if lock >= 0 { close(lock) }; throw SyncError.storage }
    }
    deinit { if lock >= 0 { close(lock) } }
    public func update(_ transform: (inout JournalState) throws -> Void) throws {
        var next = state
        try transform(&next)
        try JSONEncoder().encode(next).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        let handle = try FileHandle(forWritingTo: url)
        try handle.synchronize(); try handle.close()
        let directory = open(url.deletingLastPathComponent().path, O_RDONLY)
        guard directory >= 0 else { throw SyncError.storage }
        defer { close(directory) }
        guard fsync(directory) == 0 else { throw SyncError.storage }
        state = next
    }
    public func importLegacy(from url: URL, backup: URL) throws {
        guard state.sequence == 0, state.pendingUpload == nil, state.intents.isEmpty else { throw SyncError.migration }
        var source: OpaquePointer?, target: OpaquePointer?
        guard sqlite3_open_v2(url.path, &source, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { throw SyncError.migration }
        defer { sqlite3_close(source); sqlite3_close(target) }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(source, "SELECT COALESCE(MAX(seq),0),SUM(CASE WHEN delivered=0 THEN 1 ELSE 0 END) FROM uploads", -1, &stmt, nil) == SQLITE_OK else { throw SyncError.migration }
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_step(stmt) == SQLITE_ROW, sqlite3_column_int64(stmt, 1) == 0 else { throw SyncError.migration }
        let sequence = Int(sqlite3_column_int64(stmt, 0))
        guard !FileManager.default.fileExists(atPath: backup.path), sqlite3_open(backup.path, &target) == SQLITE_OK,
              let copy = sqlite3_backup_init(target, "main", source, "main") else { throw SyncError.migration }
        let step = sqlite3_backup_step(copy, -1), finish = sqlite3_backup_finish(copy)
        guard step == SQLITE_DONE, finish == SQLITE_OK else { throw SyncError.storage }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: backup.path)
        try update { $0.sequence = sequence; $0.paused = true }
    }
}

@MainActor public protocol CloudTransport {
    func request(_ path: String, body: JSON?) async throws -> JSON
}
@MainActor public protocol ThingsAutomation {
    func inventory() async throws -> JSON
    func apply(_ payload: JSON) async throws -> JSON
}

@MainActor public final class SyncEngine {
    public let journal: Journal
    private let cloud: any CloudTransport
    private let things: any ThingsAutomation
    private var replica: LocalReplica?
    public private(set) var busy = false
    public var onStatus: ((String) -> Void)?
    public private(set) var message = "Paused" { didSet { onStatus?(message) } }
    public private(set) var pendingCount = 0
    public private(set) var inventoryReads = 0
    public private(set) var pendingRequests = 0
    public private(set) var snapshotsUploaded = 0
    public private(set) var fetchedRevision = 0
    public init(journal: Journal, cloud: any CloudTransport, things: any ThingsAutomation) {
        self.journal = journal; self.cloud = cloud; self.things = things
    }
    public func pause(_ value: Bool) throws { try journal.update { $0.paused = value }; message = value ? "Paused" : "Ready" }
    public var feedCursor: Int { (try? replica?.cursor) ?? 0 }
    public var replicaCommandsPending: Bool { (try? replica?.commandsPending) ?? false }
    public func invalidateFeed(revision: Int, reconcile: Bool = false) throws -> Bool {
        guard revision >= 0 else { throw SyncError.invalid }
        let changed = revision > journal.state.feedHint || reconcile
        if changed { try journal.update { $0.feedHint = max($0.feedHint, revision) } }
        return changed
    }
    private func catchUpFeed() async throws {
        if replica == nil { replica = try LocalReplica(url: journal.url.deletingLastPathComponent().appendingPathComponent("replica.sqlite")) }
        guard let replica else { throw SyncError.storage }
        if try !replica.ready { try await bootstrapReplica(replica) }
        while true {
            let page = try await cloud.request("changes", body: ["since": try replica.cursor, "limit": 100])
            if page["reset"] as? Bool == true { try await bootstrapReplica(replica); continue }
            let prior = try replica.cursor
            try replica.apply(page)
            guard let more = page["has_more"] as? Bool else { throw SyncError.invalid }
            if !more { break }
            guard try replica.cursor > prior else { throw SyncError.invalid }
        }
    }
    private func bootstrapReplica(_ replica: LocalReplica) async throws {
        var body: JSON = [:], first = true
        while true {
            let page = try await cloud.request("bootstrap", body: body)
            try replica.bootstrap(page, first: first)
            first = false
            guard let more = page["has_more"] as? Bool else { throw SyncError.invalid }
            if !more { return }
            guard let continuation = page["next_cursor"] as? String, !continuation.isEmpty else { throw SyncError.invalid }
            body = ["cursor": continuation]
        }
    }
    @discardableResult public func invalidate(local: Bool = false, revision: Int? = nil, eventID: UInt64? = nil, reconcile: Bool = false) throws -> Bool {
        let newRevision = revision.map { $0 > journal.state.cloudRevision } ?? false
        guard local || newRevision || reconcile else { return false }
        try journal.update {
            if local { $0.localGeneration += 1 }
            if let eventID { $0.localEventID = max($0.localEventID, eventID) }
            if let revision { $0.cloudRevision = max($0.cloudRevision, revision) }
            if newRevision || reconcile { $0.cloudGeneration += 1 }
        }
        return true
    }
    private func acknowledge(_ intent: Intent) async throws {
        guard let data = intent.result else { throw SyncError.invalid }
        var body: JSON = ["id": intent.id, "claim": intent.claim, "result": try decoded(data)]
        if let fence = intent.appliedAfterSequence { body["applied_after_sequence"] = fence }
        if let value = intent.observedBefore { body["observed_before"] = try decoded(value) }
        if let value = intent.verifiedAfter { body["verified_after"] = try decoded(value) }
        if let value = intent.mergeDecision { body["merge_decision"] = try decoded(value) }
        let response = try await cloud.request("ack", body: body)
        let confirmation = try (response["receipt_confirmation"] as? JSON).map { try encoded($0) }
        let uncertain = try decoded(data)["state"] as? String == "uncertain"
        try journal.update {
            if uncertain { $0.uncertainOperationIDs.insert(intent.id) }
            if let confirmation { $0.receiptConfirmations[intent.id] = confirmation; $0.confirmationNeeded = true }
            $0.intents.removeValue(forKey: intent.id)
        }
    }
    private func execute(_ saved: Intent) async throws {
        var intent = saved
        if intent.result != nil { try await acknowledge(intent); return }
        let payload = try decoded(intent.payload)
        let interrupted = intent.phase == "writing"
        let recoverable = payload["conflict_policy"] as? String == "cloud_wins" && payload["version"] as? Int == 2
        let smart = payload["conflict_policy"] as? String == "smart_merge_v1" && payload["version"] as? Int == 3
        if smart && intent.appliedAfterSequence == nil {
            intent.appliedAfterSequence = journal.state.sequence
            try journal.update { $0.intents[intent.id] = intent }
        }
        if (intent.phase == "writing" && recoverable) || (smart && intent.phase != "prepared") {
            let remote = try await cloud.request("operation", body: ["id": intent.id])
            guard remote["state"] as? String == "executing", remote["claim"] as? String == intent.claim,
                  let currentPayload = remote["payload"] as? JSON, try encoded(currentPayload) == intent.payload else { throw SyncError.interrupted }
            guard let ordinal = remote["ordinal"] as? Int, ordinal > 0,
                  let desiredRevision = remote["current_desired_revision"] as? Int, desiredRevision >= 0 else { throw SyncError.invalid }
            if (smart ? desiredRevision != ordinal : desiredRevision > ordinal) || (smart && payload["field"] as? String != "in_trash_list" && remote["target_trashed_desired"] as? Bool == true) {
                intent.result = try encoded(["state": "skipped", "reason": "newer_cloud_edit"])
                intent.phase = "receipt"
                try journal.update { $0.intents[intent.id] = intent }
                try await acknowledge(intent)
                return
            }
        }
        if intent.phase == "writing" && !recoverable && !smart {
            intent.result = try encoded(["state": "uncertain", "reason": "interrupted_write"])
            intent.phase = "receipt"
            try journal.update { $0.intents[intent.id] = intent }
            try await acknowledge(intent); return
        }
        if intent.phase == "prepared" {
            let claimed: JSON
            do { claimed = try await cloud.request("claim", body: ["id": intent.id, "claim": intent.claim]) }
            catch SyncError.http(409) {
                let remote = try await cloud.request("operation", body: ["id": intent.id])
                if let state = remote["state"] as? String, ["superseded", "skipped", "failed"].contains(state) {
                    // A prepared intent has never called Things. Its cloud final state wins.
                    try journal.update { $0.intents.removeValue(forKey: intent.id) }
                    return
                }
                throw SyncError.http(409)
            }
            guard claimed["claim"] as? String == intent.claim, claimed["state"] as? String == "executing",
                  let payload = claimed["payload"] as? JSON, try encoded(payload) == intent.payload else { throw SyncError.invalid }
            intent.phase = "claimed"
            try journal.update { $0.intents[intent.id] = intent }
        }
        guard intent.phase == "claimed" || (intent.phase == "writing" && (recoverable || smart)) else { throw SyncError.invalid }
        guard !journal.state.paused else { return }
        if smart {
            let remote = try await cloud.request("operation", body: ["id": intent.id])
            guard remote["state"] as? String == "executing", remote["claim"] as? String == intent.claim,
                  let current = remote["payload"] as? JSON, try encoded(current) == intent.payload,
                  let ordinal = remote["ordinal"] as? Int, let desired = remote["current_desired_revision"] as? Int else { throw SyncError.interrupted }
            if desired != ordinal || (payload["field"] as? String != "in_trash_list" && remote["target_trashed_desired"] as? Bool == true) {
                intent.result = try encoded(["state": "skipped", "reason": "newer_cloud_edit"]); intent.phase = "receipt"
                try journal.update { $0.intents[intent.id] = intent }; try await acknowledge(intent); return
            }
            if !interrupted {
                var preparation = payload; preparation["prepare_only"] = true
                let decision = try await things.apply(preparation)
                guard let merge = decision["merge_decision"] as? JSON else { throw SyncError.invalid }
                intent.mergeDecision = try encoded(merge)
                try journal.update { $0.intents[intent.id] = intent }
                let latest = try await cloud.request("operation", body: ["id": intent.id])
                guard latest["state"] as? String == "executing", latest["claim"] as? String == intent.claim,
                      let current = latest["payload"] as? JSON, try encoded(current) == intent.payload,
                      let head = latest["current_desired_revision"] as? Int else { throw SyncError.interrupted }
                if head != ordinal || (payload["field"] as? String != "in_trash_list" && latest["target_trashed_desired"] as? Bool == true) {
                    intent.result = try encoded(["state": "skipped", "reason": "newer_cloud_edit"]); intent.phase = "receipt"
                    try journal.update { $0.intents[intent.id] = intent }; try await acknowledge(intent); return
                }
            }
        }
        intent.phase = "writing"
        if intent.appliedAfterSequence == nil { intent.appliedAfterSequence = journal.state.sequence }
        try journal.update { $0.intents[intent.id] = intent }
        var result: JSON
        do {
            var requestPayload = payload
            if interrupted && (recoverable || smart) { requestPayload["recovering"] = true }
            if let decision = intent.mergeDecision { requestPayload["prepared_decision"] = try decoded(decision) }
            result = try await things.apply(requestPayload)
        }
        catch {
            result = ["state": "uncertain", "reason": "verification_failed"]
            if smart {
                let decision: JSON
                if let retained = intent.mergeDecision {
                    decision = try decoded(retained)
                } else {
                    guard let base = payload["base"] as? JSON, let desired = payload["value"],
                          let kind = payload["intent_kind"] as? String, ["explicit_set", "derived_patch"].contains(kind) else { throw SyncError.invalid }
                    decision = ["algorithm": "supported_fields_v1", "intent_kind": kind, "classification": "interrupted",
                                "base": base, "local": ["state": "unknown", "reason": "verification_failed"], "desired": desired]
                }
                result["merge_decision"] = decision
                if let local = decision["local"] as? JSON { result["observed_before"] = local }
            }
        }
        guard let status = result["state"] as? String, ["applied", "satisfied", "skipped", "failed", "uncertain"].contains(status) else { throw SyncError.invalid }
        if let audit = result.removeValue(forKey: "observed_before") as? JSON { intent.observedBefore = try encoded(audit) }
        if let audit = result.removeValue(forKey: "verified_after") as? JSON { intent.verifiedAfter = try encoded(audit) }
        if let audit = result.removeValue(forKey: "merge_decision") as? JSON { intent.mergeDecision = try encoded(audit) }
        intent.result = try encoded(result); intent.phase = "receipt"
        try journal.update { $0.intents[intent.id] = intent; $0.localGeneration += 1; if (recoverable || smart) && ["applied", "satisfied"].contains(status) { $0.confirmationNeeded = true } }
        try await acknowledge(intent)
    }
    private func upload() async throws {
        if journal.state.pendingUpload == nil {
            message = "Reading Things inventory"
            inventoryReads += 1
            let generation = journal.state.localGeneration, revision = journal.state.cloudRevision, eventID = journal.state.localEventID
            let confirmations = journal.state.receiptConfirmations
            let inventory = try await things.inventory()
            guard let items = inventory["items"] as? [JSON], items.count <= 10000 else { throw SyncError.invalid }
            var manifest = inventory; manifest.removeValue(forKey: "items")
            manifest.removeValue(forKey: "observed_at")
            let hash = SHA256.hash(data: try encoded(["items": items, "manifest": manifest])).map { String(format: "%02x", $0) }.joined()
            if hash == journal.state.semanticHash && !journal.state.confirmationNeeded {
                try journal.update { $0.uploadedLocalGeneration = generation; $0.confirmedEventID = eventID }; return
            }
            manifest["seen_cloud_revision"] = revision
            if !confirmations.isEmpty { manifest["receipt_confirmations"] = try confirmations.keys.sorted().prefix(200).map { try decoded(confirmations[$0]!) } }
            manifest["observed_at"] = ISO8601DateFormatter().string(from: Date())
            let data = try encoded(["sequence": journal.state.sequence + 1, "items": items, "manifest": manifest])
            guard data.count <= 1024 * 1024 else { throw SyncError.invalid }
            try journal.update { $0.sequence += 1; $0.pendingUpload = data; $0.pendingHash = hash; $0.pendingLocalGeneration = generation; $0.pendingEventID = eventID }
        }
        guard let data = journal.state.pendingUpload else { throw SyncError.invalid }
        message = "Uploading cloud snapshot"
        _ = try await cloud.request("snapshot", body: decoded(data))
        snapshotsUploaded += 1
        try journal.update { $0.pendingUpload = nil; $0.lastSync = Date(); $0.semanticHash = $0.pendingHash; $0.pendingHash = nil; $0.uploadedLocalGeneration = $0.pendingLocalGeneration ?? $0.uploadedLocalGeneration; $0.pendingLocalGeneration = nil; $0.confirmedEventID = $0.pendingEventID ?? $0.confirmedEventID; $0.pendingEventID = nil }
        if let proofs = (try decoded(data)["manifest"] as? JSON)?["receipt_confirmations"] as? [JSON] {
            try journal.update { state in for proof in proofs { if let id = proof["id"] as? String, state.receiptConfirmations[id] == (try encoded(proof)) { state.receiptConfirmations.removeValue(forKey: id) } } }
        }
    }
    public func cycle(force: Bool = false) async {
        guard !busy, !journal.state.paused else { return }
        guard force || journal.state.retryAfter.map({ $0 <= Date() }) ?? true else { return }
        busy = true; defer { busy = false }
        do {
            message = "Reading cloud queue"
            for saved in journal.state.intents.values.sorted(by: { $0.id < $1.id }) { try await execute(saved) }
            let cloudGeneration = journal.state.cloudGeneration
            if journal.state.smartSync { try await catchUpFeed() }
            let commandsPending = try replica?.commandsPending ?? true
            let readQueue = !journal.state.smartSync || cloudGeneration > journal.state.drainedCloudGeneration || commandsPending
            var blocked = false
            if readQueue {
            pendingRequests += 1
            var remote = try await cloud.request("pending", body: nil)
            guard let remoteSequence = remote["sequence"] as? Int,
                  remoteSequence <= journal.state.sequence,
                  journal.state.sequence - remoteSequence <= (journal.state.pendingUpload == nil ? 0 : 1) else { throw SyncError.migration }
            guard !journal.state.paused else { message = "Paused"; return }
            if remote["smart_sync_version"] as? Int == 3 { try journal.update { $0.smartSync = true } }
            var visited = Set<String>()
            while true {
            guard let operations = remote["operations"] as? [JSON] else { throw SyncError.invalid }
            try journal.update { $0.cloudRevision = max($0.cloudRevision, remote["revision"] as? Int ?? 0); $0.confirmationNeeded = $0.confirmationNeeded || remote["overlaysNeedConfirmation"] as? Bool == true }
            pendingCount = operations.count
            var progressed = false
            for op in operations {
                if journal.state.paused { break }
                guard let id = op["id"] as? String, let payload = op["payload"] as? JSON else { throw SyncError.invalid }
                if !visited.insert(id).inserted { blocked = true; continue }
                if op["state"] as? String == "executing" { blocked = true; continue }
                let intent = Intent(id: id, claim: UUID().uuidString, payload: try encoded(payload), phase: "prepared", result: nil)
                try journal.update { $0.intents[id] = intent }
                try await execute(intent)
                progressed = true
            }
            if journal.state.paused || operations.isEmpty || !progressed { break }
            pendingRequests += 1
            remote = try await cloud.request("pending", body: nil)
            }
            guard !journal.state.paused else { message = "Paused"; return }
            fetchedRevision = remote["revision"] as? Int ?? 0
            try replica?.clearCommands()
            if journal.state.smartSync && replica == nil { try await catchUpFeed() }
            }
            if journal.state.pendingUpload != nil { try await upload() }
            if journal.state.localGeneration > journal.state.uploadedLocalGeneration || journal.state.confirmationNeeded { try await upload() }
            try journal.update { $0.failures = 0; $0.retryAfter = nil; $0.drainedCloudGeneration = cloudGeneration; $0.confirmationNeeded = !$0.receiptConfirmations.isEmpty }
            message = blocked ? "An operation needs journal recovery" : journal.state.uncertainOperationIDs.isEmpty ? "Synced" : "\(journal.state.uncertainOperationIDs.count) uncertain operation(s) need review"
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "Sync paused for retry; journal retained"
            do { try journal.update { $0.failures = min($0.failures + 1, 8); $0.retryAfter = Date().addingTimeInterval(min(3600, pow(2, Double($0.failures)) * 15) + Double.random(in: 0...10)) } }
            catch { message = SyncError.storage.errorDescription! }
        }
    }
}
