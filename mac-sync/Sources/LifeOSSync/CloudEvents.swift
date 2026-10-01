import Foundation
import SyncCore

final class CloudEvents {
    private var task: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var online = false
    private var session: URLSession
    var onRevision: ((Int) async -> Int)?
    var onStatus: ((String) -> Void)?
    private(set) var status = "Offline" { didSet { onStatus?(status) } }
    init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false; config.urlCache = nil
        session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }
    func setOnline(_ value: Bool) {
        guard online != value else { return }
        online = value
        task?.cancel(); socket?.cancel(with: .goingAway, reason: nil)
        task = nil; socket = nil
        if value { task = Task { await run() } } else { status = "Offline" }
    }
    func reconnect() {
        guard online else { return }
        setOnline(false); setOnline(true)
    }
    private func run() async {
        var failures = 0
        while online && !Task.isCancelled {
            do {
                var request = URLRequest(url: URL(string: "wss://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev/api/native/events")!)
                request.setValue(try Credential.read(), forHTTPHeaderField: "X-LifeOS-Agent-Key")
                request.setValue("2", forHTTPHeaderField: "X-LifeOS-Protocol")
                let connection = session.webSocketTask(with: request)
                socket = connection; connection.resume(); status = "Connecting"
                // Register the socket before catch-up. The server sends its durable watermark.
                let maintenance = Task {
                    while !Task.isCancelled {
                        do {
                            try await Task.sleep(for: .seconds(240))
                            let deadline = Task {
                                do { try await Task.sleep(for: .seconds(30)); connection.cancel(with: .goingAway, reason: nil) }
                                catch { }
                            }
                            defer { deadline.cancel() }
                            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                                connection.sendPing { error in
                                    if let error { continuation.resume(throwing: error) }
                                    else { continuation.resume() }
                                }
                            }
                        } catch {
                            if !Task.isCancelled { connection.cancel(with: .goingAway, reason: nil) }
                            return
                        }
                    }
                }
                defer { maintenance.cancel(); connection.cancel(with: .goingAway, reason: nil) }
                while online && !Task.isCancelled {
                    let message = try await connection.receive()
                    let data: Data
                    switch message { case .data(let bytes): data = bytes; case .string(let string): data = Data(string.utf8); @unknown default: throw SyncError.invalid }
                    guard data.count <= 1024, let revision = try decoded(data)["revision"] as? Int,
                          try decoded(data)["version"] as? Int == 1, revision >= 0 else { throw SyncError.invalid }
                    status = "Connected"; failures = 0
                    if let confirmed = await onRevision?(revision), confirmed >= revision {
                        try await connection.send(.data(try encoded(["version": 1, "ack": confirmed])))
                    }
                }
            } catch {
                guard online && !Task.isCancelled else { break }
                failures = min(failures + 1, 8)
                let code = (socket?.response as? HTTPURLResponse)?.statusCode
                status = error is SyncError || code == 401 || code == 403 ? "Secure connection needs approval or retry" : "Connection retry pending"
                do { try await Task.sleep(for: .seconds(min(300, pow(2, Double(failures))) + Double.random(in: 0...1))) }
                catch { break }
            }
        }
    }
}
