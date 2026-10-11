import AppKit
import SwiftUI

private struct CloseSheetShortcut: ViewModifier {
    @Environment(\.dismiss) private var dismiss

    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: DesktopApplicationMenu.closeSheetNotification)) { _ in
            dismiss()
        }
    }
}

extension View {
    func closeSheetShortcut() -> some View { modifier(CloseSheetShortcut()) }
}

enum DesktopApplicationMenu {
    static let closeSheetNotification = Notification.Name("LifeOSClosePresentedSheet")

    static func make(windowController: DesktopWindowController) -> NSMenu {
        let menu = NSMenu()
        let application = NSMenu(title: "LifeOS")
        let quit = NSMenuItem(title: "Quit LifeOS", action: #selector(DesktopWindowController.quitApplication(_:)), keyEquivalent: "q")
        quit.target = windowController
        quit.keyEquivalentModifierMask = .command
        application.addItem(quit)
        let applicationItem = NSMenuItem(title: "LifeOS", action: nil, keyEquivalent: "")
        applicationItem.submenu = application
        menu.addItem(applicationItem)

        let file = NSMenu(title: "File")
        let close = NSMenuItem(title: "Close Window", action: #selector(DesktopWindowController.closeWindow(_:)), keyEquivalent: "w")
        close.keyEquivalentModifierMask = .command
        close.target = windowController
        file.addItem(close)
        let fileItem = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        fileItem.submenu = file
        menu.addItem(fileItem)
        return menu
    }
}
