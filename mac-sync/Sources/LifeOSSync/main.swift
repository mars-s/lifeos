import AppKit
import Foundation
import Network
import ServiceManagement
import SyncCore

struct AgentConfig: Codable {
    let appPath: String
}

final class Agent: NSObject, NSApplicationDelegate {
    let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/LifeOS/NativeSync")
    var engine: SyncEngine?
    var item: NSStatusItem?
    var retry: Task<Void, Never>?
    var midnight: Task<Void, Never>?
    let events = CloudEvents()
    let watcher = ThingsChangeWatcher()
    var calendarObservers: [NSObjectProtocol] = []
    var wakeObserver: NSObjectProtocol?
    let network = NWPathMonitor()
    var online = false
    var initialReconciliationPending = true
    var setupMessage = "Secure setup required"

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item?.button?.image = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: "LifeOS Sync")
        loadEngine(); rebuildMenu()
        watcher.onChange = { [weak self] eventID in self?.invalidate(local: true, eventID: eventID) }
        watcher.onStatus = { [weak self] in self?.writeStatus(); self?.rebuildMenu() }
        watcher.start(since: engine?.journal.state.confirmedEventID ?? 0)
        events.onStatus = { [weak self] _ in self?.writeStatus(); self?.rebuildMenu() }
        events.onRevision = { [weak self] revision, catchup in
            guard let self, let engine = self.engine else { return 0 }
            let changed: Bool
            do { changed = try engine.invalidate(revision: revision, reconcile: catchup) } catch { return 0 }
            // A paused or busy owner retains durable reconciliation work before delivery ack.
            if !changed || engine.busy || engine.journal.state.paused { return engine.journal.state.cloudRevision }
            await self.sync()
            return engine.journal.state.cloudRevision
        }
        events.onFeedRevision = { [weak self] revision, catchup in
            guard let self, let engine = self.engine else { return 0 }
            do { _ = try engine.invalidateFeed(revision: revision, reconcile: catchup) } catch { return 0 }
            if !engine.busy && !engine.journal.state.paused { await self.sync() }
            return engine.feedCursor
        }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification,
                                                                          object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.events.reconnect(); self?.watcher.start(since: self?.engine?.journal.state.confirmedEventID ?? 0); self?.invalidate(local: true, force: true) }
        }
        calendarObservers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { [weak self] notification in
            let things = (notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.bundleIdentifier == "com.culturedcode.ThingsMac"
            if things { Task { @MainActor in self?.invalidate(local: true) } }
        })
        for name in [NSNotification.Name.NSSystemTimeZoneDidChange, NSNotification.Name.NSCalendarDayChanged, NSNotification.Name.NSSystemClockDidChange] {
            calendarObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.invalidate(local: true); self?.scheduleMidnight() }
            })
        }
        scheduleMidnight()
        network.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                self.online = online; self.events.setOnline(online)
                if online {
                    let force = self.initialReconciliationPending
                    self.initialReconciliationPending = false
                    self.invalidate(local: true, force: force)
                } else { self.retry?.cancel() }
            }
        }
        network.start(queue: DispatchQueue(label: "LifeOSNetwork"))
    }
    func loadEngine() {
        do {
            let config = try JSONDecoder().decode(AgentConfig.self, from: Data(contentsOf: directory.appendingPathComponent("config.json")))
            guard FileManager.default.fileExists(atPath: config.appPath) else { throw SyncError.configuration }
            let journal = try Journal(url: directory.appendingPathComponent("journal.json"))
            engine = SyncEngine(journal: journal, cloud: HTTPSCloud(), things: BulkPublicThings(appPath: config.appPath))
            engine?.onStatus = { [weak self] status in
                guard let self else { return }
                _ = status
                self.writeStatus()
            }
        } catch { setupMessage = (error as? LocalizedError)?.errorDescription ?? "Secure setup required" }
    }
    func sync(force: Bool = false) async {
        guard let engine else { return }
        guard online else { return }
        if engine.busy { return }
        await engine.cycle(force: force); rebuildMenu()
        writeStatus()
        retry?.cancel(); retry = nil
        if let date = engine.journal.state.retryAfter, !engine.journal.state.paused {
            retry = Task { do { try await Task.sleep(for: .seconds(max(0, date.timeIntervalSinceNow))); await sync() } catch { } }
        } else if !engine.journal.state.paused && (engine.journal.state.localGeneration > engine.journal.state.uploadedLocalGeneration || engine.journal.state.cloudGeneration > engine.journal.state.drainedCloudGeneration || engine.journal.state.feedHint > engine.feedCursor || engine.replicaCommandsPending) {
            Task { await sync() }
        }
    }
    func invalidate(local: Bool, eventID: UInt64? = nil, force: Bool = false) {
        do { try engine?.invalidate(local: local, eventID: eventID) } catch { setupMessage = "Journal write failed" }
        Task { await sync(force: force) }
    }
    func scheduleMidnight() {
        midnight?.cancel()
        guard let date = Calendar.current.nextDate(after: Date(), matching: DateComponents(hour: 0), matchingPolicy: .nextTime) else { return }
        midnight = Task { do { try await Task.sleep(for: .seconds(date.timeIntervalSinceNow)); invalidate(local: true); scheduleMidnight() } catch { } }
    }
    func writeStatus() {
        guard let engine else { return }
        let summary: JSON = ["status": engine.message, "updated_at": ISO8601DateFormatter().string(from: Date()), "inventoryReads": engine.inventoryReads, "pendingRequests": engine.pendingRequests, "snapshotsUploaded": engine.snapshotsUploaded, "notificationRevision": engine.journal.state.cloudRevision, "feedCursor": engine.feedCursor, "feedHint": engine.journal.state.feedHint, "smartSync": engine.journal.state.smartSync, "connection": events.status, "watcher": watcher.status]
        try? encoded(summary).write(to: directory.appendingPathComponent("status.json"), options: .atomic)
    }
    func rebuildMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: engine?.message ?? setupMessage, action: nil, keyEquivalent: "")
        menu.addItem(withTitle: events.status, action: nil, keyEquivalent: "")
        menu.addItem(withTitle: watcher.status, action: nil, keyEquivalent: "")
        if engine != nil, setupMessage != "Secure setup required" { menu.addItem(withTitle: setupMessage, action: nil, keyEquivalent: "") }
        if let engine {
            let date = engine.journal.state.lastSync.map { $0.formatted(date: .omitted, time: .standard) } ?? "Never"
            menu.addItem(withTitle: "Last sync: \(date)", action: nil, keyEquivalent: "")
            menu.addItem(withTitle: "Pending batch: \(engine.pendingCount)", action: nil, keyEquivalent: "")
            menu.addItem(.separator())
            let paused = engine.journal.state.paused
            add(menu, paused ? "Resume sync" : "Pause sync", #selector(togglePause))
            add(menu, "Sync now", #selector(syncNow))
        }
        add(menu, "Reload secure setup", #selector(reload))
        add(menu, "Authorize Keychain access once", #selector(authorizeCredential))
        add(menu, "Start at login", #selector(login))
        menu.addItem(.separator())
        add(menu, "Quit LifeOS Sync", #selector(quit))
        item?.menu = menu
    }
    func add(_ menu: NSMenu, _ title: String, _ action: Selector) {
        let option = NSMenuItem(title: title, action: action, keyEquivalent: ""); option.target = self; menu.addItem(option)
    }
    @objc func togglePause() {
        guard let engine else { return }
        do { try engine.pause(!engine.journal.state.paused); Task { await sync(force: true) } }
        catch { setupMessage = "Journal write failed" }
        rebuildMenu()
    }
    @objc func syncNow() { invalidate(local: true, force: true) }
    @objc func reload() { if engine == nil { loadEngine() }; events.reconnect(); invalidate(local: true, force: true); rebuildMenu() }
    @objc func authorizeCredential() {
        do {
            _ = try Credential.read(interactive: true)
            setupMessage = "Keychain access approved"
            events.reconnect()
            Task { await sync(force: true) }
        } catch { setupMessage = "Keychain access was not approved" }
        rebuildMenu()
    }
    @objc func login() {
        do {
            if SMAppService.mainApp.status != .enabled { try SMAppService.mainApp.register() }
            setupMessage = "Start at login is enabled"
        }
        catch { setupMessage = "Approve LifeOS Sync in Login Items" }
        rebuildMenu()
    }
    @objc func quit() { NSApplication.shared.terminate(nil) }
}

let args = CommandLine.arguments
if let position = args.firstIndex(of: "--bulk-inventory") {
    do {
        guard args.count == position + 2,
              let resource = Bundle.main.url(forResource: "things_bulk", withExtension: "scpt") else { throw SyncError.configuration }
        let inventory = try BulkThingsInventory.read(scriptURL: resource, appPath: args[position + 1])
        try FileHandle.standardOutput.write(contentsOf: encoded(inventory))
    } catch { exit(1) }
    exit(0)
}
if args.contains("--authorize-keychain") {
    do {
        _ = try Credential.read(interactive: true)
        // Verify persistent approval without opening a second dialog.
        _ = try Credential.read()
    } catch { exit(1) }
    exit(0)
}
if args.contains("--store-key") {
    do {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard (32...4096).contains(data.count), !data.contains(10), !data.contains(0) else { throw SyncError.configuration }
        try Credential.store(data)
    } catch { exit(1) }
    exit(0)
}
if let position = args.firstIndex(of: "--import-legacy"), args.count == position + 3 {
    do {
        let source = URL(fileURLWithPath: args[position + 1]), appPath = args[position + 2]
        let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/LifeOS/NativeSync")
        let journal = try Journal(url: directory.appendingPathComponent("journal.json"))
        try journal.importLegacy(from: source, backup: directory.appendingPathComponent("legacy-readonly-journal.sqlite3"))
        try JSONEncoder().encode(AgentConfig(appPath: appPath)).write(to: directory.appendingPathComponent("config.json"), options: .atomic)
        try journal.update { $0.paused = false }
    } catch { exit(1) }
    exit(0)
}
let app = NSApplication.shared
let delegate = Agent()
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
