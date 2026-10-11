import AppKit
import Testing
@testable import LifeOSSync

@MainActor @Test func standardDesktopShortcutsUseNativeActions() throws {
    _ = NSApplication.shared
    let controller = DesktopWindowController()
    let menu = DesktopApplicationMenu.make(windowController: controller)
    let quit = try #require(menu.items.first?.submenu?.items.first)
    #expect(quit.keyEquivalent == "q")
    #expect(quit.keyEquivalentModifierMask == .command)
    #expect(quit.action == #selector(DesktopWindowController.quitApplication(_:)))
    #expect(quit.target === controller)
    #expect(controller.validateMenuItem(quit))
    let close = try #require(menu.items.last?.submenu?.items.first)
    #expect(close.keyEquivalent == "w")
    #expect(close.keyEquivalentModifierMask == .command)
    #expect(close.action == #selector(DesktopWindowController.closeWindow(_:)))
    #expect(close.target === controller)
    #expect(!controller.validateMenuItem(close))
}
