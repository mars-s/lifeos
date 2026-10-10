import SwiftUI
import AppKit

private let ink = Color(red: 0.055, green: 0.069, blue: 0.075)
private let muted = Color(red: 0.59, green: 0.67, blue: 0.71)
private let accent = Color(red: 0.41, green: 0.76, blue: 0.82)

@main
struct LifeOSStudyApp: App {
    init() {
        let arguments = CommandLine.arguments
        if let flag = arguments.firstIndex(of: "--snapshot"),
           arguments.indices.contains(flag + 1) {
            let renderer = ImageRenderer(content:
                LifeOSView()
                    .preferredColorScheme(.dark)
                    .frame(width: 1200, height: 800)
            )
            renderer.scale = 1
            if let cgImage = renderer.cgImage,
               let data = NSBitmapImageRep(cgImage: cgImage)
                .representation(using: .png, properties: [:]) {
                do {
                    let destination = URL(fileURLWithPath: arguments[flag + 1])
                    try FileManager.default.createDirectory(
                        at: destination.deletingLastPathComponent(),
                        withIntermediateDirectories: true
                    )
                    try data.write(to: destination)
                    print("Snapshot saved: \(destination.path)")
                    exit(0)
                } catch {
                    fputs("Snapshot write failed.\n", stderr)
                    exit(1)
                }
            }
            fputs("Snapshot rendering failed.\n", stderr)
            exit(1)
        }
    }

    var body: some Scene {
        WindowGroup("LifeOS · Design study") {
            LifeOSView()
                .preferredColorScheme(.dark)
                .frame(minWidth: 860, minHeight: 680)
                .onAppear {
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                    DispatchQueue.main.async {
                        if let window = NSApp.windows.first {
                            window.titlebarAppearsTransparent = true
                            window.titleVisibility = .hidden
                            window.setContentSize(NSSize(width: 1200, height: 800))
                            window.center()
                        }
                    }
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1200, height: 800)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}

struct LifeOSView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = true
    @State private var selected = "Today"
    @State private var focusRunning = false
    @State private var focusSeconds = 50 * 60
    @State private var showCapture = false
    @State private var showTask = false
    @State private var capture = ""
    @State private var draft = ""
    @State private var complete = false
    @State private var dayOffset = 0
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 0) {
            sidebar
                .frame(width: expanded ? 184 : 68)
            ZStack(alignment: .top) {
                mountainBackground
                VStack(spacing: 0) {
                    toolbar
                    if selected == "Today" {
                        today
                    } else {
                        destination
                    }
                }
            }
        }
        .background(ink)
        .foregroundStyle(Color(red: 0.90, green: 0.92, blue: 0.90))
        .buttonStyle(.plain)
        .onReceive(ticker) { _ in
            if focusRunning && focusSeconds > 0 {
                focusSeconds -= 1
                if focusSeconds == 0 { focusRunning = false }
            }
        }
        .sheet(isPresented: $showCapture) { captureSheet }
        .sheet(isPresented: $showTask) { taskSheet }
    }

    private var mountainImage: NSImage? {
        let source = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("shared/mountain.png")
        let paths: [String] = [
            ProcessInfo.processInfo.environment["LIFEOS_STUDY_MOUNTAIN"],
            Bundle.main.url(forResource: "mountain", withExtension: "png")?.path(percentEncoded: false),
            source.path(percentEncoded: false),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("../shared/mountain.png").standardized.path(percentEncoded: false)
        ].compactMap { $0 }
        return paths.compactMap { NSImage(contentsOfFile: $0) }.first
    }

    private var mountainBackground: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                LinearGradient(colors: [
                    Color(red: 0.07, green: 0.48, blue: 0.60),
                    Color(red: 0.27, green: 0.52, blue: 0.59), ink
                ], startPoint: .topTrailing, endPoint: .bottomLeading)
                if let image = mountainImage {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geometry.size.width, height: 520)
                        .clipped()
                }
                LinearGradient(stops: [
                    .init(color: .clear, location: 0),
                    .init(color: ink.opacity(0.02), location: 0.24),
                    .init(color: ink.opacity(0.74), location: 0.48),
                    .init(color: ink, location: 0.65)
                ], startPoint: .top, endPoint: .bottom)
            }
        }
        .allowsHitTesting(false)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                Button {
                    withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 1)) {
                        expanded.toggle()
                    }
                } label: {
                    Image(systemName: "sidebar.left").font(.system(size: 13))
                        .frame(width: 30, height: 32)
                }
                .help(expanded ? "Collapse sidebar" : "Expand sidebar")
            }.padding(.top, 7)
            if expanded {
                Text("LIFEOS").font(.system(size: 17, weight: .light)).tracking(3.7)
                    .padding(.top, 18)
                Text("Your personal space").font(.system(size: 10)).foregroundStyle(muted)
                    .padding(.top, 5).padding(.bottom, 30)
            } else {
                Text("L").font(.system(size: 21, weight: .light)).padding(.vertical, 22)
                    .frame(maxWidth: .infinity)
            }
            ForEach(Array(zip(["Today", "Tasks", "Calendar", "Journal", "Review"],
                              ["sun.max", "checkmark.circle", "calendar", "book", "chart.xyaxis.line"])), id: \.0) { item in
                Button { selected = item.0 } label: {
                    HStack(spacing: 11) {
                        Image(systemName: item.1).font(.system(size: 14))
                            .frame(width: 17)
                        if expanded { Text(item.0).font(.system(size: 12)) }
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(selected == item.0 ? Color.white : muted)
                    .padding(.horizontal, 11).frame(height: 37)
                    .background(selected == item.0 ? Color.white.opacity(0.09) : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }.help(item.0)
            }
            if expanded {
                Text("PINNED").font(.system(size: 8, weight: .medium)).tracking(1.5)
                    .foregroundStyle(muted).padding(.top, 34).padding(.bottom, 9)
                Button { selected = "Journal" } label: {
                    Label("A quieter morning", systemImage: "sparkles")
                        .font(.system(size: 10)).foregroundStyle(muted)
                }
            }
            Spacer()
            Button { showCapture = true } label: {
                HStack {
                    Image(systemName: "plus")
                    if expanded {
                        Text("New capture")
                        Spacer()
                        Text("⌘N").foregroundStyle(muted).font(.system(size: 9))
                    }
                }.font(.system(size: 11)).padding(11)
                    .frame(maxWidth: .infinity)
                    .background(Color.white.opacity(0.045))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }.keyboardShortcut("n")
            if expanded {
                Label("Design prototype", systemImage: "circle.fill")
                    .font(.system(size: 9)).foregroundStyle(accent)
                    .padding(.top, 24)
                Text("Sample data · no service writes")
                    .font(.system(size: 8)).foregroundStyle(muted).padding(.top, 5)
                HStack {
                    Label("Avi", systemImage: "person.crop.circle")
                    Spacer()
                    Image(systemName: "gearshape")
                }.font(.system(size: 11)).foregroundStyle(muted).padding(.top, 30)
            }
        }
        .padding(.horizontal, expanded ? 13 : 12)
        .padding(.bottom, 20)
        .background(LinearGradient(colors: [
            Color(red: 0.095, green: 0.21, blue: 0.25),
            Color(red: 0.095, green: 0.12, blue: 0.14)
        ], startPoint: .top, endPoint: .bottom))
        .overlay(alignment: .trailing) { Color.white.opacity(0.04).frame(width: 1) }
    }

    private var toolbar: some View {
        HStack {
            Text(selected).font(.system(size: 11, weight: .medium))
            Spacer()
            Button { dayOffset -= 1 } label: { Image(systemName: "chevron.left") }
                .help("Previous sample day")
            Text(dateLabel).font(.system(size: 10)).padding(.horizontal, 7)
            Button { dayOffset += 1 } label: { Image(systemName: "chevron.right") }
                .help("Next sample day")
            Rectangle().fill(Color.white.opacity(0.2)).frame(width: 1, height: 14)
                .padding(.horizontal, 12)
            Button { selected = "Tasks" } label: { Image(systemName: "magnifyingglass") }
                .help("Browse sample tasks")
            Button { showCapture = true } label: { Image(systemName: "mic") }
                .padding(.leading, 13).help("Open capture draft")
        }.font(.system(size: 12)).padding(.horizontal, 26)
            .frame(height: 51)
    }

    private var dateLabel: String {
        let date = Calendar(identifier: .gregorian).date(from: DateComponents(year: 2026, month: 10, day: 6 + dayOffset))!
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter.string(from: date)
    }

    private var today: some View {
        VStack(spacing: 0) {
            HStack(spacing: 35) {
                metric(icon: "checkmark.circle", value: complete ? "4 / 8" : "3 / 8", label: "Tasks")
                metric(icon: "clock", value: "2h 15m", label: "Open time")
                metric(icon: "book", value: "1", label: "Journal")
            }.padding(.top, 8)
            ZStack(alignment: .top) {
                Arc().stroke(Color.white.opacity(0.48), lineWidth: 1.5)
                    .frame(width: 366, height: 71).padding(.top, 27)
                HStack {
                    Text("09:40")
                    Spacer()
                    Text("10:30")
                }.font(.system(size: 9)).foregroundStyle(Color.white.opacity(0.55))
                    .frame(width: 370).padding(.top, 83)
                VStack(spacing: 0) {
                    Text(focusRunning || focusSeconds != 3000
                         ? String(format: "%02d:%02d", focusSeconds / 60, focusSeconds % 60) : "50")
                        .font(.system(size: 74, weight: .ultraLight)).tracking(-4)
                        .monospacedDigit().padding(.top, 37)
                    Text(focusRunning ? "YOUR FOCUS IS UNDER WAY" : "MINUTES TO YOURSELF")
                        .font(.system(size: 8, weight: .medium)).tracking(2)
                    Text("Make room for what matters.")
                        .font(.custom("Baskerville", size: 34))
                        .padding(.top, 26)
                    Text("Your morning is open until 10:30. A little uninterrupted time\nfor the first draft, before the rest of your day begins.")
                        .font(.system(size: 12)).lineSpacing(5)
                        .foregroundStyle(Color.white.opacity(0.8))
                        .multilineTextAlignment(.center).padding(.top, 16)
                    Button {
                        if focusSeconds == 0 { focusSeconds = 3000 }
                        focusRunning.toggle()
                    } label: {
                        Label(focusRunning ? "Pause focus" : (focusSeconds == 3000 ? "Start a 50-minute focus" : "Resume focus"),
                              systemImage: focusRunning ? "pause" : "play")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(ink).padding(.horizontal, 21).padding(.vertical, 12)
                        .background(Color(red: 0.93, green: 0.94, blue: 0.91))
                        .clipShape(Capsule())
                    }.padding(.top, 19)
                }.frame(maxWidth: .infinity)
            }.frame(height: 314).padding(.top, 7)
            HStack(alignment: .top, spacing: 42) {
                nextTask.frame(maxWidth: .infinity)
                timeline.frame(width: 290)
            }.padding(.horizontal, 53).padding(.top, 29)
            Spacer(minLength: 22)
            HStack {
                Text(draft.isEmpty ? "A good morning, Avi." : "Capture draft saved for this session.")
                Spacer()
                Button { selected = "Calendar" } label: {
                    Text("View full timeline →")
                }
            }.font(.system(size: 9)).foregroundStyle(muted)
                .padding(.horizontal, 53).padding(.bottom, 27)
        }
    }

    private func metric(icon: String, value: String, label: String) -> some View {
        VStack(spacing: 9) {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11))
                Text(value).font(.system(size: 15, weight: .light))
            }.frame(width: 60, height: 60)
                .overlay(Circle().stroke(Color.white.opacity(0.13), lineWidth: 1))
            Text(label).font(.system(size: 9)).foregroundStyle(Color.white.opacity(0.67))
        }
    }

    private var nextTask: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Up next").font(.custom("Baskerville", size: 19))
                Spacer()
                Button { selected = "Tasks" } label: { Text("All tasks") }
                    .font(.system(size: 9)).foregroundStyle(muted)
            }
            Button { showTask = true } label: {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 11) {
                        Image(systemName: complete ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(complete ? accent : .white.opacity(0.8))
                        Text("Shape the LifeOS first draft").font(.system(size: 15))
                        Spacer()
                        Image(systemName: "arrow.right").foregroundStyle(muted)
                    }
                    Text("One clear daily story. Keep the rest a layer away.")
                        .font(.system(size: 10)).foregroundStyle(muted)
                    HStack(spacing: 7) {
                        Text("Studio").foregroundStyle(accent)
                        Text("·  50 min  ·  Today").foregroundStyle(muted)
                    }.font(.system(size: 9))
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(red: 0.12, green: 0.18, blue: 0.19).opacity(0.95))
                    .clipShape(RoundedRectangle(cornerRadius: 15))
            }
            Button { showCapture = true } label: {
                HStack(spacing: 13) {
                    Image(systemName: "mic").font(.system(size: 13))
                        .frame(width: 30, height: 30)
                        .background(Color.white.opacity(0.045)).clipShape(Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text("What's on your mind?").font(.system(size: 12))
                        Text("A thought, a note, a voice memo.").font(.system(size: 9))
                            .foregroundStyle(muted)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(muted)
                }.padding(.top, 10)
            }
        }
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Your day").font(.custom("Baskerville", size: 19))
                Spacer()
                Button { showCapture = true } label: { Image(systemName: "plus") }
                Button { selected = "Calendar" } label: { Image(systemName: "calendar") }
            }.font(.system(size: 12))
            timelineRow(icon: "calendar", time: "10:30", title: "Design catch-up", note: "30 min · Maya Chen", target: "Calendar")
            timelineRow(icon: "checkmark", time: "09:10", title: "Weekly priorities outlined", note: "Task completed · Studio", target: "Tasks")
            timelineRow(icon: "book", time: "08:45", title: "A slower start", note: "Journal · Sample entry", target: "Journal")
        }
    }

    private func timelineRow(icon: String, time: String, title: String, note: String, target: String) -> some View {
        Button { selected = target } label: {
            HStack(alignment: .top, spacing: 13) {
                VStack(spacing: 5) {
                    Image(systemName: icon).font(.system(size: 9))
                        .foregroundStyle(accent)
                        .frame(width: 20, height: 20)
                        .background(Color.white.opacity(0.06)).clipShape(Circle())
                    Rectangle().fill(muted.opacity(0.35)).frame(width: 1, height: 37)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(time).font(.system(size: 8)).foregroundStyle(muted)
                    Text(title).font(.system(size: 11))
                    Text(note).font(.system(size: 9)).foregroundStyle(muted)
                }
                Spacer()
                Image(systemName: "arrow.right").font(.system(size: 10))
                    .foregroundStyle(muted).padding(.top, 16)
            }
        }
    }

    private var destination: some View {
        VStack(alignment: .leading, spacing: 25) {
            Text(selected == "Review" ? "See the shape of your week." : selected)
                .font(.custom("Baskerville", size: 40))
            Text("A design study with sample records. Nothing here changes Things or Calendar.")
                .font(.system(size: 12)).foregroundStyle(muted)
            if selected == "Tasks" {
                nextTask.frame(maxWidth: 620)
            } else if selected == "Calendar" {
                timeline.frame(maxWidth: 620)
                Text("09:40 – 10:30 · Proposed focus · Shape the LifeOS first draft")
                    .padding(20).background(accent.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else if selected == "Journal" {
                Text("A slower start").font(.custom("Baskerville", size: 26))
                Text("08:45 · Sample journal entry\n\nLeave enough space to think before filling the day. One useful first step is enough.")
                    .font(.system(size: 14)).lineSpacing(7).frame(maxWidth: 550, alignment: .leading)
                if !draft.isEmpty {
                    Text("Your capture draft").font(.system(size: 13, weight: .semibold))
                    Text(draft).font(.system(size: 14)).textSelection(.enabled)
                }
            } else {
                HStack(spacing: 30) {
                    metric(icon: "checkmark.circle", value: complete ? "4 / 8" : "3 / 8", label: "Sample tasks")
                    metric(icon: "clock", value: "2h 15m", label: "Open time today")
                    metric(icon: "book", value: "1", label: "Journal entry")
                }
                Text("One quieter morning connects a journal entry, a first draft and a design catch-up.")
                    .font(.custom("Baskerville", size: 25)).frame(maxWidth: 570, alignment: .leading)
            }
            Spacer()
            Button("Back to Today") { selected = "Today" }
                .font(.system(size: 12)).foregroundStyle(accent)
        }.padding(53).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(ink.opacity(0.72))
    }

    private var captureSheet: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("What's on your mind?").font(.custom("Baskerville", size: 30))
            Text("Text capture only in this prototype. This draft stays in this session and is not sent anywhere.")
                .font(.system(size: 12)).foregroundStyle(muted)
            TextEditor(text: $capture)
                .font(.system(size: 15)).scrollContentBackground(.hidden)
                .padding(12).background(Color.white.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: 12)).frame(height: 180)
            HStack {
                Button("Cancel") { showCapture = false }
                Spacer()
                Button("Keep draft") {
                    draft = capture
                    showCapture = false
                    selected = "Journal"
                }.disabled(capture.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .buttonStyle(.borderedProminent).tint(accent)
            }
        }.padding(30).frame(width: 520).background(ink)
    }

    private var taskSheet: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Shape the LifeOS first draft").font(.custom("Baskerville", size: 29))
            Text("Studio · Today · 50 minutes").font(.system(size: 12)).foregroundStyle(accent)
            Text("One clear daily story. Keep the rest a layer away.\n\nStart with the next useful action. Connect the task to its meeting and journal evidence, without making the home screen feel busy.")
                .font(.system(size: 14)).lineSpacing(6)
            Text("Sample task. Completing it only changes this prototype.")
                .font(.system(size: 11)).foregroundStyle(muted)
            HStack {
                Button("Close") { showTask = false }
                Spacer()
                Button(complete ? "Mark incomplete" : "Complete sample task") {
                    complete.toggle()
                    showTask = false
                }.buttonStyle(.borderedProminent).tint(accent)
            }
        }.padding(30).frame(width: 520).background(ink)
    }
}

struct Arc: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: rect.maxY))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.maxY),
                          control: CGPoint(x: rect.midX, y: -rect.height))
        return path
    }
}
