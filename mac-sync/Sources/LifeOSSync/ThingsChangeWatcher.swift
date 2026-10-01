import Foundation
import CoreServices

nonisolated private final class WatchGeneration: @unchecked Sendable {
    private let lock = NSLock()
    private var active = true
    let events: @Sendable (Bool, UInt64) -> Void
    let status: @Sendable (String) -> Void
    init(events: @escaping @Sendable (Bool, UInt64) -> Void, status: @escaping @Sendable (String) -> Void) {
        self.events = events; self.status = status
    }
    var isActive: Bool {
        lock.lock(); defer { lock.unlock() }; return active
    }
    func cancel() { lock.lock(); active = false; lock.unlock() }
}

// Stream ownership stays on one utility queue. Generation validity uses a lock
// because cancellation must remain immediate while macOS waits for consent.
nonisolated private final class WatchStreamState: @unchecked Sendable {
    var stream: FSEventStreamRef?
    var generation: WatchGeneration?
    func close() {
        if let stream { FSEventStreamStop(stream); FSEventStreamInvalidate(stream); FSEventStreamRelease(stream) }
        stream = nil; generation = nil
    }
}

nonisolated private final class WatchRegistration: @unchecked Sendable {
    private let queue = DispatchQueue(label: "LifeOSMetadataRegistration", qos: .utility)
    private let state = WatchStreamState()
    deinit {
        let state = state
        queue.async { state.close() }
    }
    func stop(_ generation: WatchGeneration) {
        generation.cancel()
        queue.async { [state] in if state.generation === generation { state.close() } }
    }
    func start(root: String, since eventID: UInt64, generation: WatchGeneration) {
        queue.async { [state, queue] in
            guard generation.isActive else { return }
            state.close()
            var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(generation).toOpaque(),
                retain: { info in
                    guard let info else { return nil }
                    return UnsafeRawPointer(Unmanaged<WatchGeneration>.fromOpaque(info).retain().toOpaque())
                }, release: { info in
                    if let info { Unmanaged<WatchGeneration>.fromOpaque(info).release() }
                }, copyDescription: nil)
            let callback: FSEventStreamCallback = { _, info, count, eventPaths, flags, ids in
                guard let info else { return }
                let generation = Unmanaged<WatchGeneration>.fromOpaque(info).takeUnretainedValue()
                guard generation.isActive else { return }
                let dropped = (0..<count).contains { flags[$0] & FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped | kFSEventStreamEventFlagRootChanged) != 0 }
                let paths = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] ?? []
                let relevant = paths.contains { path in
                    !path.contains("/Backups/") && (path.contains("/Things Database.thingsdatabase") || URL(fileURLWithPath: path).lastPathComponent.hasPrefix("ThingsData-") || path.hasSuffix("JLMPQHK86H.com.culturedcode.ThingsMac"))
                }
                guard dropped || relevant else { return }
                generation.events(dropped, (0..<count).map { ids[$0] }.max() ?? 0)
            }
            guard let stream = FSEventStreamCreate(nil, callback, &context, [root] as CFArray,
                eventID == 0 ? FSEventStreamEventId(kFSEventStreamEventIdSinceNow) : eventID, 0.3,
                FSEventStreamCreateFlags(kFSEventStreamCreateFlagWatchRoot | kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes)) else {
                if generation.isActive { generation.status("Local watcher degraded: event stream unavailable") }
                return
            }
            guard generation.isActive else { FSEventStreamInvalidate(stream); FSEventStreamRelease(stream); return }
            state.stream = stream; state.generation = generation
            FSEventStreamSetDispatchQueue(stream, queue)
            guard FSEventStreamStart(stream), generation.isActive else {
                state.close()
                if generation.isActive { generation.status("Local watcher degraded: permission or storage unavailable") }
                return
            }
            generation.status("Watching local metadata")
        }
    }
}

final class ThingsChangeWatcher {
    private let registration = WatchRegistration()
    private var generation: WatchGeneration?
    private var version: UInt64 = 0
    private var debounce: Task<Void, Never>?
    var onChange: ((UInt64) -> Void)?
    private var latestEventID: UInt64 = 0
    var onStatus: (() -> Void)?
    private(set) var status = "Local watcher unavailable" { didSet { onStatus?() } }
    func start(since eventID: UInt64 = 0) {
        stop()
        let version = version
        let generation = WatchGeneration(events: { [weak self] dropped, latest in
            Task { @MainActor in guard let self, self.version == version else { return }; self.changed(dropped: dropped, eventID: latest) }
        }, status: { [weak self] status in
            Task { @MainActor in guard let self, self.version == version else { return }; self.status = status }
        })
        self.generation = generation
        status = "Local watcher pending permission or registration"
        let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac").path
        registration.start(root: root, since: eventID, generation: generation)
    }
    private func changed(dropped: Bool, eventID: UInt64) {
        latestEventID = max(latestEventID, eventID)
        if dropped { status = "Local events dropped or storage replaced: reconciling" }
        debounce?.cancel()
        debounce = Task {
            do { try await Task.sleep(for: .milliseconds(500)); onChange?(latestEventID) }
            catch { }
        }
    }
    func stop() {
        version &+= 1
        debounce?.cancel(); debounce = nil
        if let generation { registration.stop(generation) }
        generation = nil
    }
}
