import Foundation
import SyncCore

final class LocalToolBridge {
    private(set) var busy = false
    private let service = LocalService()
    var enabled: Bool { UserDefaults.standard.bool(forKey: "localLifeOSToolsEnabled") }
    func invoke(_ request: JSON) async -> JSON {
        guard enabled, !busy, let tool = request["tool"] as? String,
              let arguments = request["arguments"] as? JSON,
              LocalToolContract.names.contains(tool) else { return Self.failure("Local tools are disabled or busy. No invocation was sent.") }
        busy = true
        defer { busy = false }
        do {
            let bytes = try encoded(["tool": tool, "arguments": arguments])
            guard bytes.count <= 256 * 1024 else { throw SyncError.invalid }
            switch await service.call(bytes) {
            case .reply(let data): return try decoded(data)
            case .notSent: return try decoded(await Self.run(bytes))  // the service could not start; nothing was sent
            case .busy: return Self.failure("Local tools are disabled or busy. No invocation was sent.")
            case .uncertain: throw SyncError.automation                 // never replay a call that may have run
            }
        } catch { return Self.failure("Local invocation could not finish. Check saved capture or proposal state before retrying a write.") }
    }
    nonisolated static func failure(_ text: String) -> JSON {
        ["isError": true, "content": [["type": "text", "text": text]]]
    }
    nonisolated static var project: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Developer/projects/lifeos")
    }
    /// Fallback: one Python process per call, used only when the persistent service cannot start.
    @concurrent private static func run(_ input: Data) async throws -> Data {
        guard input.count <= 256 * 1024 else { throw SyncError.invalid }
        let python = project.appendingPathComponent(".venv/bin/python")
        guard FileManager.default.isExecutableFile(atPath: python.path) else { throw SyncError.configuration }
        let process = Process(), stdin = Pipe(), stdout = Pipe()
        process.executableURL = python
        process.currentDirectoryURL = project
        process.arguments = ["-m", "lifeos.cloud_bridge"]
        process.standardInput = stdin; process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        // Do not pass the native Keychain key, cloud credentials or Python paths.
        process.environment = ["PATH": "/usr/bin:/bin:/opt/homebrew/bin", "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                               "PYTHONUNBUFFERED": "1", "PYTHONNOUSERSITE": "1"]
        LocalService.ignoreSigpipe()
        try process.run()
        let timeout = Task {
            // The cloud request can time out first. Let a multi-write apply finish
            // its verification while retaining the native busy guard.
            try await Task.sleep(for: .seconds(120))
            if process.isRunning { process.terminate() }
        }
        defer { timeout.cancel() }
        try stdin.fileHandleForWriting.write(contentsOf: input)
        try stdin.fileHandleForWriting.close()
        var result = Data()
        while let chunk = try stdout.fileHandleForReading.read(upToCount: 65536), !chunk.isEmpty {
            guard result.count + chunk.count <= 256 * 1024 else { process.terminate(); throw SyncError.invalid }
            result.append(chunk)
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw SyncError.automation }
        return result
    }
}
