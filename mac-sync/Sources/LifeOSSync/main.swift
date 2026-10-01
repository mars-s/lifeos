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
    var timer: Timer?
    var wakeObserver: NSObjectProtocol?
    let network = NWPathMonitor()
    var setupMessage = "Secure setup required"

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item?.button?.image = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: "LifeOS Sync")
        loadEngine(); rebuildMenu()
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.sync() }
        }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification,
                                                                          object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.sync(force: true) }
        }
        network.pathUpdateHandler = { [weak self] path in
            if path.status == .satisfied { Task { @MainActor in await self?.sync(force: true) } }
        }
        network.start(queue: DispatchQueue(label: "LifeOSNetwork"))
        Task { await sync(force: true) }
    }
    func loadEngine() {
        do {
            let config = try JSONDecoder().decode(AgentConfig.self, from: Data(contentsOf: directory.appendingPathComponent("config.json")))
            guard FileManager.default.fileExists(atPath: config.appPath) else { throw SyncError.configuration }
            let journal = try Journal(url: directory.appendingPathComponent("journal.json"))
            engine = SyncEngine(journal: journal, cloud: HTTPSCloud(), things: PublicThings(appPath: config.appPath))
        } catch { setupMessage = (error as? LocalizedError)?.errorDescription ?? "Secure setup required" }
    }
    func sync(force: Bool = false) async {
        guard let engine else { return }
        if !force, let last = engine.journal.state.lastSync, Date().timeIntervalSince(last) < 300,
           engine.journal.state.intents.isEmpty { return }
        await engine.cycle(force: force); rebuildMenu()
    }
    func rebuildMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: engine?.message ?? setupMessage, action: nil, keyEquivalent: "")
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
    @objc func syncNow() { Task { await sync(force: true) } }
    @objc func reload() { if engine == nil { loadEngine() }; rebuildMenu() }
    @objc func login() {
        do { try SMAppService.mainApp.register() }
        catch { setupMessage = "Approve LifeOS Sync in Login Items" }
        rebuildMenu()
    }
    @objc func quit() { NSApplication.shared.terminate(nil) }
}

let args = CommandLine.arguments
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
