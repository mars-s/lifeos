import Darwin
import Foundation
import SyncCore

/// Persistent LifeOS local service (`local-service/src/main.ts`, run by Node).
///
/// It keeps one warm Python worker, so a tool call costs tens of milliseconds instead of
/// starting Python each time. Protocol: the service prints a ready line once, then one JSON
/// reply line per JSON request line, strictly in order. Calls are serialised by the actor
/// and by the caller's busy guard. Raw requests and replies never reach logs.
actor LocalService {
    /// busy: another call is in flight. Nothing was sent, and the caller must not fall back to
    /// a second invocation path while that call runs.
    enum Outcome: Sendable { case reply(Data), notSent, busy, uncertain }
    typealias Launch = @Sendable () -> (executable: URL, arguments: [String], directory: URL)?

    static let readyLine = Data(#"{"protocol":1,"ready":"lifeos-local-service"}"#.utf8)
    static let maxBytes = 256 * 1024
    private let readyTimeout: Duration
    private let callTimeout: Duration
    private let launch: Launch
    private var process: Process?
    private var input: FileHandle?
    private var lines: LineChannel?
    private var inFlight = false

    init(readyTimeout: Duration = .seconds(20), callTimeout: Duration = .seconds(130),
         launch: @escaping Launch = { LocalService.defaultLaunch() }) {
        self.readyTimeout = readyTimeout
        self.callTimeout = callTimeout
        self.launch = launch
    }

    nonisolated static func ignoreSigpipe() { signal(SIGPIPE, SIG_IGN) }

    /// Node 22.18+ runs the TypeScript entry point directly. Absolute paths only: the agent has a minimal PATH.
    nonisolated static func defaultLaunch() -> (executable: URL, arguments: [String], directory: URL)? {
        let project = LocalToolBridge.project
        let entry = project.appendingPathComponent("local-service/src/main.ts")
        let deps = project.appendingPathComponent("local-service/node_modules/effect")
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "\(home)/.local/bin/node"]
        guard FileManager.default.fileExists(atPath: entry.path), FileManager.default.fileExists(atPath: deps.path),
              let node = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { return nil }
        return (URL(fileURLWithPath: node), [entry.path], project.appendingPathComponent("local-service"))
    }

    func call(_ request: Data) async -> Outcome {
        guard !inFlight else { return .busy }
        inFlight = true
        defer { inFlight = false }
        guard request.count <= Self.maxBytes, !request.contains(0x0A) else { return .notSent }
        guard await ensureRunning(), let input, let lines else { return .notSent }
        do {
            try input.write(contentsOf: request + Data([0x0A]))
        } catch {
            stop(); return .uncertain  // a partial write may have reached the service
        }
        guard let reply = await lines.next(timeout: callTimeout) else { stop(); return .uncertain }
        return .reply(reply)
    }

    private func ensureRunning() async -> Bool {
        if let process, process.isRunning, lines?.closed == false { return true }
        stop()
        guard let spec = launch() else { return false }
        Self.ignoreSigpipe()
        let process = Process(), stdin = Pipe(), stdout = Pipe()
        process.executableURL = spec.executable
        process.arguments = spec.arguments
        process.currentDirectoryURL = spec.directory
        process.standardInput = stdin; process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        // Same minimal environment as the per-call bridge: no Keychain key, cloud credentials or Python paths.
        process.environment = ["PATH": "/usr/bin:/bin:/opt/homebrew/bin", "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                               "NODE_NO_WARNINGS": "1"]
        let channel = LineChannel(maxLine: Self.maxBytes)
        stdout.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            if chunk.isEmpty { handle.readabilityHandler = nil; channel.close() } else { channel.append(chunk) }
        }
        process.terminationHandler = { _ in channel.close() }
        do { try process.run() } catch { stdout.fileHandleForReading.readabilityHandler = nil; return false }
        self.process = process; self.input = stdin.fileHandleForWriting; self.lines = channel
        guard await channel.next(timeout: readyTimeout) == Self.readyLine else { stop(); return false }
        return true
    }

    private func stop() {
        lines?.close()
        if let process, process.isRunning {
            process.terminate()
            let pid = process.processIdentifier
            DispatchQueue.global().asyncAfter(deadline: .now() + 3) { if process.isRunning { kill(pid, SIGKILL) } }
        }
        try? input?.close()
        process = nil; input = nil; lines = nil
    }

    deinit { if let process, process.isRunning { process.terminate() } }
}

/// Thread-safe newline framing over a pipe. One waiter at a time (calls are serialised).
nonisolated final class LineChannel: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer = Data()
    private var ready: [Data] = []
    private var waiter: CheckedContinuation<Data?, Never>?
    private var waiterID = 0
    private var expiredID = -1
    private var isClosed = false
    private let maxLine: Int

    init(maxLine: Int) { self.maxLine = maxLine }

    var closed: Bool { lock.withLock { isClosed } }

    func append(_ chunk: Data) {
        var deliver: (CheckedContinuation<Data?, Never>, Data)?
        var overflow = false
        lock.withLock {
            guard !isClosed else { return }
            buffer.append(chunk)
            while let newline = buffer.firstIndex(of: 0x0A) {
                ready.append(Data(buffer[buffer.startIndex..<newline]))
                buffer = Data(buffer[buffer.index(after: newline)...])
            }
            overflow = buffer.count > maxLine * 2
            if let waiter, !ready.isEmpty { deliver = (waiter, ready.removeFirst()); self.waiter = nil }
        }
        if let deliver { deliver.0.resume(returning: deliver.1) }
        if overflow { close() }
    }

    func close() {
        let pending: CheckedContinuation<Data?, Never>? = lock.withLock {
            isClosed = true
            defer { waiter = nil }
            return waiter
        }
        pending?.resume(returning: nil)
    }

    /// The next complete line, or nil on close or timeout. A line longer than maxLine is rejected.
    func next(timeout: Duration) async -> Data? {
        let id: Int = lock.withLock { waiterID += 1; return waiterID }
        let timer = Task { [weak self] in
            try? await Task.sleep(for: timeout)
            if !Task.isCancelled { self?.expire(id) }
        }
        defer { timer.cancel() }
        let line: Data? = await withCheckedContinuation { continuation in
            let immediate: Data?? = lock.withLock {
                if !ready.isEmpty { return .some(ready.removeFirst()) }
                if isClosed || expiredID == id { return .some(nil) }
                waiter = continuation
                return .none
            }
            if let immediate { continuation.resume(returning: immediate) }
        }
        guard let line, line.count <= maxLine else { return nil }
        return line
    }

    private func expire(_ id: Int) {
        let pending: CheckedContinuation<Data?, Never>? = lock.withLock {
            guard waiterID == id else { return nil }
            expiredID = id
            defer { waiter = nil }
            return waiter
        }
        pending?.resume(returning: nil)
    }
}
