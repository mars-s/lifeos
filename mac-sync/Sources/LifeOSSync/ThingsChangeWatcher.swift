import Foundation
import CoreServices

final class ThingsChangeWatcher {
    private var stream: FSEventStreamRef?
    private var debounce: Task<Void, Never>?
    var onChange: ((UInt64) -> Void)?
    private var latestEventID: UInt64 = 0
    var onStatus: (() -> Void)?
    private(set) var status = "Local watcher unavailable" { didSet { onStatus?() } }
    func start(since eventID: UInt64 = 0) {
        stop()
            let group = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac")
            // Register only for metadata events. Opening the protected directory to
            // discover children can block startup on an unnecessary App Data prompt.
            let roots = [group.path]
            var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
            let callback: FSEventStreamCallback = { _, info, count, eventPaths, flags, ids in
                guard let info else { return }
                let watcher = Unmanaged<ThingsChangeWatcher>.fromOpaque(info).takeUnretainedValue()
                let dropped = (0..<count).contains { flags[$0] & FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped | kFSEventStreamEventFlagRootChanged) != 0 }
                let paths = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] ?? []
                let relevant = paths.contains { path in
                    !path.contains("/Backups/") && (path.contains("/Things Database.thingsdatabase") || URL(fileURLWithPath: path).lastPathComponent.hasPrefix("ThingsData-") || path.hasSuffix("JLMPQHK86H.com.culturedcode.ThingsMac"))
                }
                guard dropped || relevant else { return }
                let latest = (0..<count).map { ids[$0] }.max() ?? 0
                Task { @MainActor in watcher.changed(dropped: dropped, eventID: latest) }
            }
            guard let stream = FSEventStreamCreate(nil, callback, &context, roots as CFArray, eventID == 0 ? FSEventStreamEventId(kFSEventStreamEventIdSinceNow) : eventID, 0.3, FSEventStreamCreateFlags(kFSEventStreamCreateFlagWatchRoot | kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes)) else {
                status = "Local watcher degraded: event stream unavailable"; return
            }
            self.stream = stream
            FSEventStreamSetDispatchQueue(stream, .main)
            guard FSEventStreamStart(stream) else { stop(); status = "Local watcher degraded: permission or storage unavailable"; return }
            status = "Watching local metadata"
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
        debounce?.cancel()
        if let stream { FSEventStreamStop(stream); FSEventStreamInvalidate(stream); FSEventStreamRelease(stream) }
        stream = nil
    }
}
