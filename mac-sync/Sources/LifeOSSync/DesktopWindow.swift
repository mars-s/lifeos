import AppKit
import SwiftUI

/// This window observes its owning Agent. It never creates a sync engine.
final class DesktopWindowController: NSObject, NSWindowDelegate {
    let model = DesktopModel()
    private(set) var window: NSWindow?

    func open() {
        if window == nil {
            let host = NSHostingView(rootView: DesktopView(model: model).preferredColorScheme(.dark))
            let newWindow = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered, defer: false
            )
            newWindow.title = "LifeOS"
            newWindow.titlebarAppearsTransparent = true
            newWindow.titleVisibility = .hidden
            newWindow.minSize = NSSize(width: 900, height: 680)
            newWindow.isReleasedWhenClosed = false
            newWindow.contentView = host
            newWindow.delegate = self
            newWindow.setFrameAutosaveName("LifeOSDesktop")
            if !newWindow.setFrameUsingName("LifeOSDesktop") { newWindow.center() }
            window = newWindow
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Isolated check of the same window host, without constructing Agent or SyncEngine.
    static func verify(snapshot: URL?) throws {
        let controller = DesktopWindowController()
        controller.model.preview = true
        controller.model.status = "Preview: no sync services started"
        controller.open()
        guard let first = controller.window else { throw SyncErrorForDesktop.failed }
        controller.open()
        guard controller.window === first else { throw SyncErrorForDesktop.failed }
        first.close()
        controller.open()
        guard controller.window === first else { throw SyncErrorForDesktop.failed }
        controller.model.drafts.append("Synthetic window verification")
        guard controller.model.drafts.count == 1 else { throw SyncErrorForDesktop.failed }
        controller.model.toggleFocus()
        guard controller.model.focusRunning else { throw SyncErrorForDesktop.failed }
        controller.model.toggleFocus()
        guard !controller.model.focusRunning else { throw SyncErrorForDesktop.failed }
        controller.model.drafts = []
        if let snapshot {
            let renderer = ImageRenderer(content:
                DesktopView(model: controller.model, snapshot: true).preferredColorScheme(.dark).frame(width: 1200, height: 800)
            )
            renderer.scale = 1
            guard let image = renderer.cgImage,
                  let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
            else { throw SyncErrorForDesktop.failed }
            try data.write(to: snapshot)
            let base = snapshot.deletingPathExtension()
            for (suffix, page) in [("sleep", DesktopHealthView.Page.sleep), ("movement", .movement)] {
                let extra = ImageRenderer(content:
                    DesktopView(model: controller.model, snapshot: true, section: "Health", healthPage: page)
                        .preferredColorScheme(.dark).frame(width: 1200, height: 800))
                extra.scale = 1
                guard let cg = extra.cgImage,
                      let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
                else { throw SyncErrorForDesktop.failed }
                try png.write(to: base.appendingPathExtension("\(suffix).png"))
            }
        }
        first.close()
        print("Desktop check passed: one reusable window, focus pause, session draft, no sync engine.")
    }
}

private enum SyncErrorForDesktop: Error { case failed }

final class DesktopModel: ObservableObject {
    @Published var preview = false
    @Published var status = "Starting LifeOS"
    @Published var connection = "Connecting"
    @Published var pending = 0
    @Published var lastSync: Date?
    @Published var paused = true
    @Published var drafts: [String] = []
    @Published var focusSeconds = 3000
    @Published var focusRunning = false
    private var focusTask: Task<Void, Never>?
    private var deadline: Date?

    func toggleFocus() {
        if focusRunning {
            updateRemaining()
            focusTask?.cancel()
            focusTask = nil
            focusRunning = false
            deadline = nil
            return
        }
        if focusSeconds == 0 { focusSeconds = 3000 }
        deadline = Date().addingTimeInterval(Double(focusSeconds))
        focusRunning = true
        focusTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                guard let self else { return }
                self.updateRemaining()
                if self.focusSeconds == 0 {
                    self.focusRunning = false
                    self.deadline = nil
                    self.focusTask = nil
                    return
                }
            }
        }
    }

    private func updateRemaining() {
        if let deadline { focusSeconds = max(0, Int(ceil(deadline.timeIntervalSinceNow))) }
    }
}

let desktopInk = Color(red: 0.055, green: 0.069, blue: 0.075)
let desktopMuted = Color(red: 0.68, green: 0.75, blue: 0.77)
let desktopAccent = Color(red: 0.41, green: 0.76, blue: 0.82)

struct DesktopView: View {
    @ObservedObject var model: DesktopModel
    var snapshot = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = true
    @State private var selected: String
    @State private var healthPage: DesktopHealthView.Page
    @State private var healthOpen = true
    @State private var showCapture = false
    @State private var capture = ""

    init(model: DesktopModel, snapshot: Bool = false, section: String = "Today",
         healthPage: DesktopHealthView.Page = .overview) {
        _model = ObservedObject(wrappedValue: model)
        self.snapshot = snapshot
        _selected = State(initialValue: section)
        _healthPage = State(initialValue: healthPage)
    }

    /// Each place in the app gets its own backdrop. Health sub pages pick their own.
    private var scene: DesktopScene {
        guard selected == "Health" else { return .mountain }
        switch healthPage {
        case .sleep: return .twilight
        case .movement: return .field
        default: return .mountain
        }
    }
    private let sections = ["Today", "Health", "Tasks", "Calendar", "Journal", "Review"]
    private let symbols = ["sun.max", "heart", "checkmark.circle", "calendar", "book", "chart.xyaxis.line"]

    var body: some View {
        ZStack(alignment: .top) {
            background
            HStack(spacing: 0) {
                sidebar.frame(width: expanded ? 190 : 64).padding(.leading, 12).padding(.trailing, 8).padding(.top, 46).padding(.bottom, 12)
                VStack(spacing: 0) {
                    HStack {
                        HStack(spacing: 6) {
                            Text(selected).font(.system(size: 13, weight: .medium))
                            if selected == "Health" {
                                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
                                    .foregroundStyle(desktopMuted)
                                Text(healthPage.rawValue).font(.system(size: 13)).foregroundStyle(desktopMuted)
                                    .id(healthPage)
                                    .transition(.opacity)
                            }
                        }.animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: healthPage)
                        Spacer()
                        Text(Date.now, format: .dateTime.weekday(.wide).day().month(.wide))
                            .font(.system(size: 12))
                        Button { showCapture = true } label: {
                            Image(systemName: "square.and.pencil").font(.system(size: 13)).frame(width: 28, height: 28)
                                .modifier(DesktopGlass(shape: Circle(), interactive: true))
                        }
                            .accessibilityLabel("New session draft")
                    }.frame(height: 28).padding(.horizontal, 40).padding(.top, 2).padding(.bottom, 20)
                    if snapshot {
                        page
                    } else {
                        ScrollView { page }.defaultScrollAnchor(.top)
                    }
                }
            }
        }
        .background(desktopInk)
        .overlay(alignment: .topLeading) { sidebarToggle }
        .ignoresSafeArea(.container, edges: .top)
        .foregroundStyle(Color(white: 0.93))
        .buttonStyle(PressStyle())
        .sheet(isPresented: $showCapture) { captureSheet }
    }

    /// Sits beside the traffic lights, on the picture, like a floating glass button.
    private var sidebarToggle: some View {
        Button {
            withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 1)) { expanded.toggle() }
        } label: {
            Image(systemName: "sidebar.left").font(.system(size: 13)).frame(width: 28, height: 28)
                .modifier(DesktopGlass(shape: Circle(), interactive: true))
        }
        .accessibilityLabel(expanded ? "Collapse sidebar" : "Expand sidebar")
        .padding(.leading, 82).padding(.top, 2)
    }

    private var page: some View {
        VStack(spacing: 26) {
            if selected == "Today" { today }
            else if selected == "Health" { DesktopHealthView(page: $healthPage) }
            else { destination }
            statusPanel
        }.padding(.horizontal, 40).padding(.bottom, 30)
    }

    /// All three scenes stay mounted. Changing page cross-fades them and eases the zoom.
    private var background: some View {
        let motion: Animation? = reduceMotion ? nil : .easeInOut(duration: 1.1)
        return GeometryReader { geometry in
            ZStack(alignment: .top) {
                ForEach(DesktopScene.allCases, id: \.self) { item in
                    let active = item == scene
                    ZStack(alignment: .top) {
                        LinearGradient(colors: [item.glow, desktopInk],
                                       startPoint: .topTrailing, endPoint: .bottomLeading)
                        if let image = item.image {
                            Image(nsImage: image).resizable().scaledToFill()
                                .frame(width: geometry.size.width, height: 520).clipped()
                            Color.black.opacity(item.scrim).frame(height: 520)
                        }
                    }
                    .opacity(active ? 1 : 0)
                    .scaleEffect(active ? 1 : 1.05, anchor: .top)
                }
                LinearGradient(stops: [
                    .init(color: .clear, location: 0),
                    .init(color: desktopInk.opacity(0.1), location: 0.27),
                    .init(color: desktopInk.opacity(0.85), location: 0.54),
                    .init(color: desktopInk, location: 0.72)
                ], startPoint: .top, endPoint: .bottom)
            }.animation(motion, value: scene)
        }.allowsHitTesting(false)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 12) {
            Color.clear.frame(height: 6)
            if expanded {
                Text("LIFEOS").font(.system(size: 19, weight: .light)).tracking(3)
                Text("Your personal space").font(.system(size: 12)).foregroundStyle(desktopMuted)
                    .padding(.bottom, 18)
            }
            ForEach(sections.indices, id: \.self) { index in
                let name = sections[index]
                let isHealth = name == "Health"
                let submenuShown = isHealth && expanded && healthOpen
                Button {
                    if isHealth && selected == "Health" && expanded {
                        withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 1)) {
                            healthOpen.toggle()
                        }
                    } else {
                        selected = name
                        if isHealth { healthOpen = true }
                    }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: symbols[index]).frame(width: 18)
                        if expanded { Text(name).font(.system(size: 13)) }
                        if expanded { Spacer(minLength: 0) }
                        if isHealth && expanded {
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(desktopMuted)
                                .rotationEffect(.degrees(healthOpen ? 90 : 0))
                        }
                    }.frame(maxWidth: .infinity).padding(11)
                        .background(selected == name ? Color.white.opacity(submenuShown ? 0.05 : 0.1) : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 7)).hoverTint(7)
                }.accessibilityLabel(name)
                    .accessibilityHint(isHealth ? (healthOpen ? "Collapses health pages" : "Expands health pages") : "")
                if submenuShown {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(DesktopHealthView.Page.allCases, id: \.self) { sub in
                            let current = selected == "Health" && healthPage == sub
                            Button {
                                selected = "Health"
                                healthPage = sub
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: sub.symbol).font(.system(size: 11)).frame(width: 16)
                                    Text(sub.rawValue).font(.system(size: 12.5))
                                    Spacer(minLength: 0)
                                }.padding(.vertical, 8).padding(.horizontal, 10)
                                    .foregroundStyle(current ? Color.white : desktopMuted)
                                    .background(current ? Color.white.opacity(0.12) : .clear)
                                    .clipShape(RoundedRectangle(cornerRadius: 7)).hoverTint(7)
                            }.accessibilityLabel("Health, \(sub.rawValue)")
                                .accessibilityAddTraits(current ? .isSelected : [])
                        }
                    }.padding(.leading, 18)
                        .overlay(alignment: .leading) {
                            Rectangle().fill(Color.white.opacity(0.14)).frame(width: 1).padding(.vertical, 6)
                                .padding(.leading, 9)
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            Spacer()
            Button { showCapture = true } label: {
                HStack(spacing: 12) {
                    Image(systemName: "plus").frame(width: 18)
                    if expanded { Text("New session draft").font(.system(size: 13)).lineLimit(1).minimumScaleFactor(0.85); Spacer(minLength: 0) }
                }.frame(maxWidth: .infinity).padding(11)
                    .background(desktopAccent.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
            }.keyboardShortcut("n", modifiers: .command)
                .accessibilityLabel("New session draft")
            if expanded {
                Text("Drafts stay in this session.\nNo task or calendar writes.")
                    .font(.system(size: 11)).foregroundStyle(desktopMuted).lineSpacing(3)
            }
        }.padding(.horizontal, expanded ? 14 : 8).padding(.top, expanded ? 0 : 14).padding(.bottom, 24)
            .background(desktopInk.opacity(0.08), in: RoundedRectangle(cornerRadius: 22))
            .modifier(DesktopGlass(shape: RoundedRectangle(cornerRadius: 22), clear: true))
    }

    private var today: some View {
        VStack(spacing: 20) {
            DesktopGlassGroup {
              HStack(spacing: 30) {
                summary("\(model.pending)", "Pending", "arrow.triangle.2.circlepath", "Review")
                summary("50 min", "Focus", "clock", "Today")
                summary("\(model.drafts.count)", "Drafts", "book", "Journal")
              }
            }.padding(.top, 18)
            ZStack(alignment: .bottom) {
                FocusArc().stroke(Color.white.opacity(0.45), lineWidth: 1)
                    .frame(maxWidth: 440).frame(height: 80).accessibilityHidden(true)
                Text(model.focusSeconds == 3000 && !model.focusRunning
                     ? "50" : String(format: "%02d:%02d", model.focusSeconds / 60, model.focusSeconds % 60))
                    .font(.system(size: 68, weight: .ultraLight)).monospacedDigit().offset(y: 20)
            }.padding(.top, 24)
            Text("MINUTES TO YOURSELF").font(.system(size: 11, weight: .medium)).tracking(2)
                .padding(.top, 9)
            Text("Make room for what matters.")
                .font(.system(size: 35, weight: .regular, design: .serif)).multilineTextAlignment(.center)
            Text("A little uninterrupted time, on your terms.\nThis timer does not reserve calendar time.")
                .font(.system(size: 14)).foregroundStyle(desktopMuted)
                .multilineTextAlignment(.center).lineSpacing(5)
            Button { model.toggleFocus() } label: {
                Label(model.focusRunning ? "Pause focus" : model.focusSeconds == 3000 ? "Start a 50-minute focus" : "Resume focus",
                      systemImage: model.focusRunning ? "pause" : "play")
                    .font(.system(size: 13, weight: .semibold)).padding(.horizontal, 24).padding(.vertical, 13)
                    .modifier(DesktopGlass(shape: Capsule(), tint: desktopAccent.opacity(0.25), interactive: true))
            }
            HStack(alignment: .top, spacing: 26) {
                VStack(alignment: .leading, spacing: 15) {
                    heading("Up next")
                    Text("Your native workspace")
                        .font(.system(size: 17, weight: .medium))
                    Text(model.preview
                         ? "This preview runs without the sync owner. Task and calendar views will connect next."
                         : "This window observes the existing sync owner. Task and calendar views will connect next.")
                        .font(.system(size: 14)).foregroundStyle(desktopMuted).lineSpacing(4)
                    Button { showCapture = true } label: {
                        Label("What’s on your mind?", systemImage: "square.and.pencil")
                    }.padding(.top, 8)
                }.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 15) {
                    heading("Your session")
                    Text("\(model.drafts.count) local draft\(model.drafts.count == 1 ? "" : "s")")
                    Text("Not yet saved to the LifeOS journal.").font(.system(size: 13)).foregroundStyle(desktopMuted)
                    Button("View drafts") { selected = "Journal" }.foregroundStyle(desktopAccent)
                }.frame(width: 235, alignment: .leading)
            }.padding(24).modifier(DesktopReadingSurface(radius: 16)).hoverLift().padding(.top, 18)
        }
    }

    private func summary(_ value: String, _ label: String, _ symbol: String, _ target: String) -> some View {
        Button { selected = target } label: {
            VStack(spacing: 10) {
                VStack(spacing: 5) {
                    Image(systemName: symbol).font(.system(size: 13))
                    Text(value).font(.system(size: 16, weight: .light))
                }.frame(width: 68, height: 68)
                    .modifier(DesktopGlass(shape: Circle(), interactive: true))
                Text(label).font(.system(size: 12)).foregroundStyle(desktopMuted)
            }
        }.accessibilityLabel("\(label): \(value)")
    }

    private var destination: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading(selected)
            if selected == "Journal" {
                Text("Session drafts, not durable journal entries.").foregroundStyle(desktopMuted)
                if model.drafts.isEmpty { Text("Nothing captured in this session yet.") }
                ForEach(Array(model.drafts.enumerated()), id: \.offset) { _, draft in
                    Text(draft).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(20).modifier(DesktopReadingSurface(radius: 12))
                }
            } else if selected == "Review" {
                Text("\(model.pending) pending sync operations")
                Text("This is the existing sync queue count, not an approval card. Approvals stay in the current LifeOS workflow.")
                    .foregroundStyle(desktopMuted)
            } else {
                Text("The \(selected.lowercased()) view is not connected yet.")
                Text("Continue using Things, Calendar and ChatGPT for your records. This shell does not invent or change them.")
                    .foregroundStyle(desktopMuted)
            }
        }.font(.system(size: 14)).frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 50).padding(.bottom, 40)
    }

    private var statusPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(model.preview ? "Safe UI preview" : model.paused ? "Sync paused or unavailable" : "LifeOS Sync",
                  systemImage: model.preview ? "eye" : "arrow.triangle.2.circlepath")
                .foregroundStyle(desktopAccent)
            Text(model.status).textSelection(.enabled)
            if !model.preview {
                Text(model.connection)
                Text(model.lastSync.map { "Last sync: \($0.formatted())" } ?? "No confirmed sync yet")
            }
            Text(model.preview ? "No engine, watchers, Keychain reads or external writes." : "Closing this window keeps the menu bar and sync running.")
                .foregroundStyle(desktopMuted)
        }.font(.system(size: 12)).frame(maxWidth: .infinity, alignment: .leading)
            .padding(18).modifier(DesktopReadingSurface(radius: 12))
    }

    private var captureSheet: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading("What’s on your mind?")
            Text("Session draft only. It disappears when LifeOS quits. No AI extraction or sync runs here yet.")
                .font(.system(size: 13)).foregroundStyle(desktopMuted)
            TextEditor(text: $capture).font(.system(size: 15)).frame(height: 160)
                .accessibilityLabel("Draft text")
            HStack {
                Button("Cancel") { showCapture = false }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Keep in session") {
                    model.drafts.append(capture.trimmingCharacters(in: .whitespacesAndNewlines))
                    capture = ""
                    selected = "Journal"
                    showCapture = false
                }.disabled(capture.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }.padding(28).frame(width: 510).modifier(DesktopReadingSurface(radius: 20))
    }

    private func heading(_ text: String) -> some View {
        Text(text).font(.system(size: 24, weight: .regular, design: .serif))
            .accessibilityAddTraits(.isHeader)
    }
}

/// A backdrop for one mood. Images load once and fall back to a plain gradient if missing.
enum DesktopScene: CaseIterable {
    case mountain, twilight, field

    var glow: Color {
        switch self {
        case .mountain: Color(red: 0.08, green: 0.47, blue: 0.59)
        case .twilight: Color(red: 0.06, green: 0.15, blue: 0.36)
        case .field: Color(red: 0.26, green: 0.58, blue: 0.86)
        }
    }
    /// Darkens bright pictures so white text stays readable.
    var scrim: Double {
        switch self {
        case .mountain: 0
        case .twilight: 0.12
        case .field: 0.34
        }
    }
    var image: NSImage? { Self.images[self] }

    private static let images: [DesktopScene: NSImage] = {
        var found: [DesktopScene: NSImage] = [:]
        for (scene, name) in [(DesktopScene.mountain, "mountain"), (.twilight, "twilight-forest"), (.field, "sunny-field")] {
            if let url = Bundle.main.url(forResource: name, withExtension: "png"),
               let image = NSImage(contentsOf: url) { found[scene] = image }
        }
        return found
    }()
}

/// Glass belongs to navigation and controls, not every content surface.
struct DesktopGlass<S: Shape>: ViewModifier {
    let shape: S
    var tint: Color = .clear
    var interactive = false
    var clear = false
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    @ViewBuilder func body(content: Content) -> some View {
        if reduceTransparency || contrast == .increased {
            content.background(desktopInk, in: shape)
                .overlay(shape.stroke(Color.white.opacity(0.4), lineWidth: 1).allowsHitTesting(false))
        } else if #available(macOS 26, *) {
            content.glassEffect((clear ? Glass.clear : Glass.regular).tint(tint).interactive(interactive), in: shape)
        } else {
            content.background(.regularMaterial, in: shape)
                .overlay(shape.stroke(Color.white.opacity(0.16), lineWidth: 1).allowsHitTesting(false))
        }
    }
}

private struct DesktopGlassGroup<Content: View>: View {
    @ViewBuilder let content: () -> Content
    @ViewBuilder var body: some View {
        if #available(macOS 26, *) {
            GlassEffectContainer(spacing: 20) { content() }
        } else {
            content()
        }
    }
}

/// Every card uses the liquid glass look, just more frosted than the hero card.
struct DesktopReadingSurface: ViewModifier {
    let radius: CGFloat
    func body(content: Content) -> some View {
        content.modifier(LiquidSurface(radius: radius, tint: 0.42))
    }
}

struct SolidReadingSurface: ViewModifier {
    let radius: CGFloat
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius)
        return content
            .background {
                if reduceTransparency || contrast == .increased {
                    shape.fill(desktopInk)
                } else {
                    shape.fill(.regularMaterial)
                }
            }
            .overlay(shape.stroke(Color.white.opacity(contrast == .increased ? 0.4 : 0.12), lineWidth: 1)
                .allowsHitTesting(false))
    }
}

private struct FocusArc: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: rect.height))
        path.addQuadCurve(to: CGPoint(x: rect.width, y: rect.height),
                          control: CGPoint(x: rect.midX, y: -rect.height))
        return path
    }
}
