import AppKit
import Foundation
import Security
import LocalAuthentication
import SyncCore

enum Credential {
    static let service = "LifeOSNativeSync"
    static func store(_ data: Data) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service, kSecAttrAccount as String: "agent"]
        var lookup = query; lookup[kSecReturnAttributes as String] = true
        let context = LAContext(); context.interactionNotAllowed = true
        lookup[kSecUseAuthenticationContext as String] = context
        let status = SecItemCopyMatching(lookup as CFDictionary, nil)
        // Credential replacement belongs to the explicit user-operated setup.
        let result: OSStatus
        if status == errSecItemNotFound {
            var add = query; add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            result = SecItemAdd(add as CFDictionary, nil)
        } else if status == errSecSuccess {
            result = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        } else { throw SyncError.configuration }
        guard result == errSecSuccess else { throw SyncError.configuration }
    }
    static func read(interactive: Bool = false) throws -> String {
        // The login Keychain's legacy ACL dialogs are separate from biometrics.
        // Background access must never block the menu bar behind a consent dialog.
        if !interactive { SecKeychainSetUserInteractionAllowed(false) }
        defer { if !interactive { SecKeychainSetUserInteractionAllowed(true) } }
        let context = LAContext(); context.interactionNotAllowed = !interactive
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service, kSecAttrAccount as String: "agent",
                                   kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
                                   kSecUseAuthenticationContext as String: context,
                                   kSecUseAuthenticationUI as String: interactive ? kSecUseAuthenticationUIAllow : kSecUseAuthenticationUIFail]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data, let key = String(data: data, encoding: .utf8),
              (32...4096).contains(key.count), !key.contains("\n") else { throw SyncError.configuration }
        return key
    }
}

final class NoRedirect: NSObject, URLSessionTaskDelegate {
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask,
                               willPerformHTTPRedirection response: HTTPURLResponse,
                               newRequest request: URLRequest,
                               completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class HTTPSCloud: CloudTransport {
    private let origin = "https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev"
    private let session: URLSession
    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30; config.timeoutIntervalForResource = 60
        config.httpShouldSetCookies = false; config.urlCache = nil
        session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }
    func request(_ path: String, body: JSON?) async throws -> JSON {
        guard ["pending", "snapshot", "claim", "ack", "operation"].contains(path),
              let url = URL(string: origin + "/api/native/" + path) else { throw SyncError.invalid }
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue(try Credential.read(), forHTTPHeaderField: "X-LifeOS-Agent-Key")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("LifeOSNativeSync/2.0", forHTTPHeaderField: "User-Agent")
        request.setValue("2", forHTTPHeaderField: "X-LifeOS-Protocol")
        if let body { request.httpBody = try encoded(body) }
        // Stream responses and abort above the known queue/snapshot response budget.
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw SyncError.invalid }
        guard (200..<300).contains(http.statusCode) else { throw SyncError.http(http.statusCode) }
        var data = Data()
        for try await byte in bytes { guard data.count < 256 * 1024 else { throw SyncError.invalid }; data.append(byte) }
        return try decoded(data)
    }
}

nonisolated enum AutomationProcess {
    @concurrent static func run(_ arguments: [String], input: Data? = nil) async throws -> Data {
        let process = Process(), output = Pipe(), stdin = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = arguments; process.standardOutput = output
        process.standardError = FileHandle.nullDevice; process.standardInput = stdin
        try process.run()
        let timeout = Task {
            try await Task.sleep(for: .seconds(45))
            if process.isRunning { process.terminate() }
        }
        defer { timeout.cancel() }
        if let input { try stdin.fileHandleForWriting.write(contentsOf: input) }
        try stdin.fileHandleForWriting.close()
        var data = Data()
        while let chunk = try output.fileHandleForReading.read(upToCount: 65536), !chunk.isEmpty {
            guard data.count + chunk.count <= 8 * 1024 * 1024 else { process.terminate(); throw SyncError.automation }
            data.append(chunk)
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw SyncError.automation }
        return data
    }
}

final class PublicThings: ThingsAutomation {
    let appPath: String
    init(appPath: String) { self.appPath = appPath }
    private func resource(_ name: String, _ ext: String) throws -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else { throw SyncError.configuration }
        return url.path
    }
    private func classify() async throws -> [String: String] {
        let bytes = try await AutomationProcess.run([resource("things_classify", "scpt"), appPath])
        return try thingsClassifications(bytes)
    }
    func inventory() async throws -> JSON {
        if !NSWorkspace.shared.runningApplications.contains(where: { $0.bundleURL?.path == appPath }) {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = false; configuration.hides = true
            _ = try await NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: appPath), configuration: configuration)
        }
        let before = try await classify()
        let request: JSON = ["action": "inventory", "app_path": appPath, "allow_write": false, "classifications": before]
        let output = try await AutomationProcess.run(["-l", "JavaScript", resource("things_read", "js")], input: encoded(request))
        guard before == (try await classify()) else { throw SyncError.automation }
        return try decoded(output)
    }
    func apply(_ payload: JSON) async throws -> JSON {
        if payload["field"] as? String == "in_trash_list" {
            let request = try TrashRequest(payload: payload, appPath: appPath)
            let data = try await AutomationProcess.run([resource("native-trash", "applescript")] + request.arguments)
            return try decoded(data)
        }
        let data = try await AutomationProcess.run(["-l", "JavaScript", resource("native-write", "js")],
                                                   input: encoded(["payload": payload, "app_path": appPath, "allow_write": true]))
        return try decoded(data)
    }
}
