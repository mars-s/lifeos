import Foundation
import LocalAuthentication
import Security
import SwiftUI
import SyncCore

enum HealthConnectionError: LocalizedError {
    case missingToken, keychain, unauthorised, unavailable, invalidResponse
    var errorDescription: String? {
        switch self {
        case .missingToken: "Connect this app to your local Convex backend."
        case .keychain: "Keychain access failed. Reconnect to authorise this build."
        case .unauthorised: "The backend rejected this connection. Import its current token again."
        case .unavailable: "Convex is offline. Start the local Docker Compose backend, then retry."
        case .invalidResponse: "The backend returned an unsupported health record."
        }
    }
}

enum HealthCredential {
    private static var identity: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "LifeOS.Convex.Health",
         kSecAttrAccount as String: "local-native-gateway"]
    }
    static func read() throws -> String {
        var query = identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        let context = LAContext()
        context.interactionNotAllowed = true
        query[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { throw HealthConnectionError.missingToken }
        guard status == errSecSuccess, let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else { throw HealthConnectionError.keychain }
        return token
    }
    static func store(_ token: String) throws {
        guard token.count == 64, token.allSatisfy({ $0.isHexDigit && $0.isASCII }) else {
            throw HealthConnectionError.invalidResponse
        }
        let data = Data(token.utf8)
        let updated = SecItemUpdate(identity as CFDictionary,
                                    [kSecValueData as String: data] as CFDictionary)
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw HealthConnectionError.keychain }
        var query = identity
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw HealthConnectionError.keychain }
    }
    static func importConfiguration(_ url: URL) throws {
        guard let text = String(data: try Data(contentsOf: url), encoding: .utf8),
              let line = text.split(separator: "\n").first(where: { $0.hasPrefix("LIFEOS_NATIVE_TOKEN=") })
        else { throw HealthConnectionError.invalidResponse }
        try store(String(line.dropFirst("LIFEOS_NATIVE_TOKEN=".count)))
    }
    static func remove() throws {
        let status = SecItemDelete(identity as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw HealthConnectionError.keychain }
    }
}

// Never forward the native bearer token through an HTTP redirect.
nonisolated private final class HealthRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor final class ConvexHealthStore: ObservableObject {
    let preview: Bool
    @Published var previewState = HealthPreviewState.recorded
    @Published private(set) var days: [HealthDay] = []
    @Published private(set) var status = "Not connected"
    @Published private(set) var loading = false
    @Published private(set) var connected = false
    @Published private(set) var refreshed: Date?
    private(set) var loadedSource: String?
    @Published var source = CommandLine.arguments.contains("--health-synthetic") ? "synthetic" : "google-health"
    private var generation = 0
    private let session = URLSession(configuration: .ephemeral, delegate: HealthRedirectPolicy(),
                                     delegateQueue: nil)

    init(preview: Bool = false) {
        self.preview = preview
        if preview {
            source = "synthetic"
            days = (try? HealthPreview.days()) ?? []
            connected = true
            status = "Illustrative preview · No backend connection"
        }
    }

    func reload(clear: Bool = false) async {
        generation += 1
        let requestGeneration = generation
        let requestedSource = source
        loadedSource = requestedSource
        if clear { days = []; refreshed = nil }
        loading = true
        defer {
            if generation == requestGeneration, !(preview && previewState == .loading) { loading = false }
        }
        if preview {
            if previewState == .loading {
                days = []; connected = false; status = "Preview: loading illustrative records"
                // Hold the explicit fixture until Finished/Recorded is selected. No timer runs.
                return
            }
            days = [.empty, .failure].contains(previewState) ? [] : (try? HealthPreview.days()) ?? []
            connected = ![.offline, .failure].contains(previewState)
            refreshed = previewState == .failure ? nil : Date()
            status = switch previewState {
            case .failure: "Preview: health request failed. Retry to restore illustrative records."
            case .offline: "Preview: backend unavailable · Showing sample records"
            default: "Illustrative preview · No backend connection"
            }
            return
        }
        do {
            let token = try HealthCredential.read()
            var components = URLComponents(string: "http://127.0.0.1:3211/health/days")!
            components.queryItems = [.init(name: "source", value: requestedSource), .init(name: "limit", value: "30")]
            var request = URLRequest(url: components.url!)
            request.timeoutInterval = 8
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw HealthConnectionError.unavailable }
            if response.statusCode == 401 { throw HealthConnectionError.unauthorised }
            guard response.statusCode == 200 else { throw HealthConnectionError.unavailable }
            let records: [HealthDay]
            do { records = try JSONDecoder().decode([HealthDay].self, from: data) }
            catch { throw HealthConnectionError.invalidResponse }
            guard records.allSatisfy({ $0.source == requestedSource }) else { throw HealthConnectionError.invalidResponse }
            guard generation == requestGeneration, !Task.isCancelled else { return }
            days = records.sorted { $0.date > $1.date }
            connected = true; refreshed = Date()
            status = days.isEmpty ? "Connected · No stored health records" : "Connected · Local Convex"
        } catch {
            guard generation == requestGeneration, !Task.isCancelled else { return }
            connected = false
            status = (error as? HealthConnectionError)?.localizedDescription ??
                HealthConnectionError.unavailable.localizedDescription
        }
    }

    func disconnect() {
        guard !preview else { return }
        do {
            try HealthCredential.remove()
            generation += 1
            days = []; refreshed = nil; loading = false; connected = false
            status = "Disconnected"
        } catch { status = HealthConnectionError.keychain.localizedDescription }
    }
    func importConfiguration(_ url: URL) async {
        guard !preview else { return }
        do {
            try HealthCredential.importConfiguration(url)
            await reload(clear: true)
        } catch { status = "Connection file could not be imported. Select the backend’s .env.local file." }
    }
}
