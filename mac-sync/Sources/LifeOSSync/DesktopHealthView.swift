import SwiftUI
import Charts

/// Design-board fixtures only. No health provider, permissions or background polling.
struct DesktopHealthView: View {
    enum Page: String, CaseIterable {
        case overview = "Overview", sleep = "Sleep", signals = "Body signals"
        case movement = "Movement", sources = "Sources"

        var symbol: String {
            switch self {
            case .overview: "circle.grid.2x2"
            case .sleep: "moon.stars"
            case .signals: "waveform.path.ecg"
            case .movement: "figure.walk"
            case .sources: "link"
            }
        }
    }
    @Binding var page: Page
    @State private var scrub: Double?
    @State private var stageFilter: SleepStage?
    @Environment(\.lifeOSReduceMotion) private var reduceMotion
    @State private var provider: String?
    @State private var range = "7 days"
    @State private var showEvidence = false
    @State private var barsIn = false

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                Text("Illustrative values · 5 October 2026 · No live connection")
                    .font(.system(size: 11)).foregroundStyle(desktopMuted)
                Spacer(minLength: 8)
                Text("PREVIEW DATA").font(.system(size: 9, weight: .semibold)).tracking(1.3)
                    .foregroundStyle(desktopAccent)
            }
            Group {
                switch page {
                case .overview: overview
                case .sleep: sleep
                case .signals: signals
                case .movement: movement
                case .sources: sources
                }
            }.id(page).transition(.opacity)
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.35), value: page)
        .font(.system(size: 13))
        .sheet(isPresented: Binding(get: { provider != nil }, set: { if !$0 { provider = nil } })) {
            VStack(alignment: .leading, spacing: 18) {
                title("\(provider ?? "Health") connection")
                Text("This screen is a design preview. No provider credentials or health permissions have been configured. Connecting a real account is a separate implementation step.")
                    .foregroundStyle(desktopMuted).fixedSize(horizontal: false, vertical: true)
                Button("Done") { provider = nil }.keyboardShortcut(.defaultAction)
            }.padding(28).frame(width: 440)
        }
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 24) {
            eyebrow("LAST NIGHT")
            Text("7h 42m").font(.system(size: 66, weight: .ultraLight)).monospacedDigit()
            title("A little more rest than usual.")
            dailySummary
            Button { page = .sleep } label: {
                HStack(spacing: 8) { Text("Explore your sleep"); NudgeArrow(name: "arrow.right") }.padding(12)
                    .modifier(DesktopGlass(shape: Capsule(), interactive: true))
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 3), spacing: 4) {
                metric("Resting heart rate", "54", "bpm · Daily summary")
                metric("HRV · RMSSD", "48", "ms · Nightly average")
                metric("Skin temperature", "+0.2°C", "From 30-day baseline")
                metric("Blood oxygen", "97%", "Nightly average")
                metric("Breathing rate", "14.2", "/min · Main sleep")
                metric("Steps", "6,248", "As of 09:35")
            }.padding(12).modifier(DesktopReadingSurface(radius: 18)).hoverLift().rise(0.15)
            HStack(alignment: .top, spacing: 24) {
                panel("The shape of your night") { stageSummary }
                panel("A steady start") {
                    row("Active zone minutes", "24 min")
                    row("Active energy", "286 kcal")
                    ProgressView(value: 6248, total: 8000).tint(desktopAccent)
                    caption("6,248 of 8,000-step goal")
                    caption("08:05 · Morning walk · 28 min")
                }
            }
            note("Readiness, Sleep Score and Stress Rhythm need their original provider. This preview keeps measurements and provider scores separate.")
        }
    }

    private var dailySummary: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                CometMark()
                Text("Daily summary").font(.system(size: 12, weight: .medium)).foregroundStyle(desktopMuted)
                Spacer(minLength: 8)
                Text("PREVIEW").font(.system(size: 9, weight: .semibold)).tracking(1.3).foregroundStyle(desktopMuted.opacity(0.7))
            }
            Text("42 minutes more sleep than your 7-night average. Your resting heart rate was 54 bpm, compared with 56 bpm.")
                .font(.system(size: 15)).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
            HStack {
                caption("Based on 7 complete nights")
                Spacer(minLength: 8)
                Button {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) { showEvidence.toggle() }
                } label: {
                    HStack(spacing: 4) {
                        Text("View evidence")
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                            .rotationEffect(.degrees(showEvidence ? 180 : 0))
                    }.font(.system(size: 12)).foregroundStyle(desktopMuted)
                }.buttonStyle(PressStyle())
            }
            if showEvidence {
                VStack(spacing: 10) {
                    row("Sleep, last night", "7h 42m")
                    row("Sleep, 7-night average", "7h 00m")
                    row("Resting heart rate", "54 bpm")
                    row("Resting heart rate, 7-night average", "56 bpm")
                }.padding(.top, 4).transition(.opacity)
            }
        }
        .padding(20).frame(maxWidth: 680, alignment: .leading)
        .modifier(LiquidSurface(radius: 22)).hoverLift().rise(0.05)
    }

    private var sleep: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top, spacing: 40) {
                VStack(alignment: .leading, spacing: 12) {
                    eyebrow("MAIN SLEEP · OCTOBER 5")
                    Text("7h 42m").font(.system(size: 58, weight: .ultraLight))
                    title("More room for rest.")
                    caption("42 minutes above your 7-night average of 7 hours.")
                }.frame(maxWidth: .infinity, alignment: .leading)
                VStack(spacing: 18) {
                    row("Bedtime", "23:12")
                    row("Wake", "07:24")
                    row("Efficiency · calculated", "93.9%")
                    row("Time to fall asleep", "12 min")
                }.frame(width: 240).padding(.top, 25)
            }
            panel("Your night, stage by stage") {
                caption("Stages processed · Illustrative stage pattern")
                sleepReadout
                sleepStages
                stageChips
            }
            HStack(alignment: .top, spacing: 24) {
                panel("Seven nights of sleep") {
                    bars([6.4, 7.1, 6.8, 7.3, 6.2, 7.5, 7.7], unit: "hours")
                    caption("Duration in hours · 7-night average 7h 00m")
                }
                panel("About this night") {
                    row("Data source", "Pixel Watch 3")
                    caption("Preview attribution · via Google Health")
                    row("Session type", "Main sleep")
                    row("Naps", "None recorded")
                    row("Sleep score", "Not provided")
                    caption("If stages are still processing, show duration and a processing label, not a guessed chart.")
                }
            }
            note("Preview data. Not a clinical assessment.")
        }
    }

    private var signals: some View {
        VStack(alignment: .leading, spacing: 24) {
            title("Small signals. Your own baseline.")
            caption("Nightly measurements and daily summaries, with methods kept separate.")
            HStack(alignment: .top, spacing: 24) {
                panel("Heart rate variability") {
                    Picker("History", selection: $range) {
                        Text("7 days").tag("7 days")
                        Text("30 days").tag("30 days")
                    }.pickerStyle(.segmented)
                    Text("48 ms").font(.system(size: 46, weight: .ultraLight))
                    caption("RMSSD · Nightly average · October 5")
                    if range == "7 days" {
                        Chart(Array([43.0, 46, 44, 51, 47, 49, 48].enumerated()), id: \.offset) { item in
                            LineMark(x: .value("Day", item.offset), y: .value("RMSSD", item.element))
                                .foregroundStyle(desktopAccent)
                            PointMark(x: .value("Day", item.offset), y: .value("RMSSD", item.element))
                                .foregroundStyle(.white)
                        }.chartYScale(domain: 35...60).chartXAxis(.hidden).frame(height: 130)
                        caption("Tue · Wed · Thu · Fri · Sat · Sun · Mon")
                        caption("Same nightly RMSSD method. No SDNN values combined.")
                    } else {
                        ContentUnavailableView("No 30-day preview history", systemImage: "chart.xyaxis.line",
                                               description: Text("Missing history stays missing."))
                            .frame(height: 180)
                    }
                    caption("Compare like with like, using your own history rather than a universal target.")
                }
                panel("Today at a glance") {
                    row("Resting heart rate", "54 bpm")
                    caption("Daily value · Sleep-based method")
                    row("Latest heart rate", "62 bpm")
                    caption("Sample 09:31 · Not live")
                    row("Breathing rate", "14.2 /min")
                    row("Blood oxygen", "97%")
                    row("Skin temperature", "+0.2°C")
                    row("VO₂ max", "45.6 ml/kg/min")
                    caption("Estimated · October 3")
                }
            }
            note("Missing ECG or rhythm data is not a normal result. Observation date, source and method belong with each measurement.")
        }
    }

    private var movement: some View {
        VStack(alignment: .leading, spacing: 24) {
            eyebrow("TODAY · THROUGH 09:35")
            Text("6,248 steps").font(.system(size: 58, weight: .ultraLight))
            title("Movement, without the pressure.")
            caption("78% of a personal 8,000-step goal. Adjust to suit your day.")
            HStack(spacing: 4) {
                metric("Distance", "4.6", "km")
                metric("Active zone minutes", "24", "min")
                metric("Active energy", "286", "kcal")
                metric("Total energy", "1,240", "kcal")
            }.padding(12).modifier(DesktopReadingSurface(radius: 18)).hoverLift().rise(0.15)
            HStack(alignment: .top, spacing: 24) {
                panel("A week on your feet") {
                    bars([7.5, 6.0, 8.1, 5.4, 10.2, 8.4, 6.248], unit: "thousand steps")
                    caption("Today is partial. Previous days are complete.")
                    Divider()
                    Text("Energy, kept in context").font(.system(size: 17, design: .serif))
                    caption("286 active + 954 basal = 1,240 total kcal")
                    caption("Estimates. Active and total energy are not added together.")
                }
                panel("Recorded activity") {
                    Text("Morning walk").font(.system(size: 21, design: .serif))
                    caption("08:05 to 08:33 · Automatically recorded")
                    row("Duration", "28 min")
                    row("Distance", "2.1 km")
                    row("Average heart rate", "111 bpm")
                    caption("Pixel Watch 3 · Preview attribution")
                    eyebrow("TIME IN HEART RATE ZONES")
                    row("Light / Moderate / Vigorous", "8 / 16 / 4 min")
                    caption("Intensity-weighted zone minutes differ from duration.")
                    row("Longest sedentary period", "48 min")
                }
            }
        }
    }

    private var sources: some View {
        VStack(alignment: .leading, spacing: 24) {
            title("Your data. Its source.")
            caption("Choose what to share. See what each connection can actually provide.")
            ForEach(["Google Health", "Oura", "Ultrahuman"], id: \.self) { name in
                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(name).font(.system(size: 19, design: .serif))
                        caption(name == "Google Health" ? "Not connected · Preview values only" :
                                    name == "Oura" ? "Provider-specific scores and contributors" : "Partner API approval required")
                    }
                    Spacer()
                    Button("Connection details") { provider = name }
                        .padding(12).modifier(DesktopGlass(shape: Capsule(), interactive: true))
                }.padding(20).modifier(DesktopReadingSurface(radius: 16))
            }
            panel("Availability notes") {
                ForEach([
                    ("Sleep duration and stages", "Keep pending stages and naps explicit."),
                    ("Heart rate, HRV and breathing", "Preserve source, date and measurement method."),
                    ("Skin temperature and VO₂ max", "Keep baseline and estimate metadata."),
                    ("Steps, energy and workouts", "Partial days and overlapping records need reconciliation."),
                    ("Readiness, stress and resilience", "Provider-specific scores are not interchangeable."),
                    ("ECG, glucose and reproductive data", "Separate availability, device and permission checks."),
                    ("Ring features", "Chronotype, battery and recovery features need provider support.")
                ], id: \.0) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.0).fontWeight(.medium)
                        caption(item.1)
                    }
                    Divider()
                }
            }
            note("Missing data stays missing. No samples is not zero. No rhythm alert does not mean normal. These are design notes, not a verified provider contract.")
        }
    }

    private var stageSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { geometry in
                let available = max(0, geometry.size.width - 6)
                HStack(spacing: 3) {
                    Rectangle().fill(SleepStage.deep.colour).frame(width: available * 88 / 462)
                    Rectangle().fill(SleepStage.rem.colour).frame(width: available * 102 / 462)
                    Rectangle().fill(SleepStage.light.colour).frame(width: available * 272 / 462)
                }
            }.frame(height: 9).clipShape(Capsule()).accessibilityHidden(true)
            caption("Deep 1h 28m · REM 1h 42m · Light 4h 32m")
            caption("23:12 to 07:24 · 30 min awake")
        }
    }

    private var focusSegment: SleepSegment? {
        guard let scrub else { return nil }
        return SleepSegment.night.first { Double($0.start) <= scrub && scrub < Double($0.end) }
    }

    private func segmentOpacity(_ segment: SleepSegment) -> Double {
        if let stageFilter { return segment.stage == stageFilter ? 1 : 0.14 }
        if let focus = focusSegment { return focus.id == segment.id ? 1 : 0.45 }
        return 0.9
    }

    /// Fixed height, so the chart does not jump while you explore.
    private var sleepReadout: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let focus = focusSegment {
                HStack(spacing: 8) {
                    Circle().fill(focus.stage.colour).frame(width: 9, height: 9)
                    Text(focus.stage.title).font(.system(size: 17, design: .serif))
                    Text("\(SleepSegment.clock(focus.start)) to \(SleepSegment.clock(focus.end)) · \(SleepSegment.duration(focus.minutes))")
                        .foregroundStyle(desktopMuted).monospacedDigit()
                }
                caption(focus.stage.blurb)
            } else if let stageFilter {
                let total = SleepSegment.night.filter { $0.stage == stageFilter }
                Text("\(stageFilter.title) · \(SleepSegment.duration(total.reduce(0) { $0 + $1.minutes }))")
                    .font(.system(size: 17, design: .serif))
                caption("\(total.count) stretches across the night. Move over the chart for detail.")
            } else {
                Text("Explore the night").font(.system(size: 17, design: .serif))
                caption("Move across the chart to see each stretch. Pick a stage below to isolate it.")
            }
        }.frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
            .animation(nil, value: scrub)
    }

    private var stageChips: some View {
        HStack(spacing: 10) {
            ForEach(SleepStage.allCases, id: \.self) { stage in
                let minutes = SleepSegment.night.filter { $0.stage == stage }.reduce(0) { $0 + $1.minutes }
                let on = stageFilter == stage
                Button {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                        stageFilter = on ? nil : stage
                    }
                } label: {
                    HStack(spacing: 8) {
                        Circle().fill(stage.colour).frame(width: 9, height: 9)
                        Text(stage.title).font(.system(size: 12, weight: .medium))
                        Text(SleepSegment.duration(minutes)).font(.system(size: 12)).monospacedDigit()
                            .foregroundStyle(desktopMuted)
                    }.padding(.horizontal, 12).padding(.vertical, 8)
                        .background(on ? stage.colour.opacity(0.25) : Color.white.opacity(0.06), in: Capsule())
                        .overlay(Capsule().stroke(on ? stage.colour : .clear, lineWidth: 1))
                        .scaleEffect(on && !reduceMotion ? 1.05 : 1)
                        .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.55), value: on)
                }.accessibilityLabel("\(stage.title), \(SleepSegment.duration(minutes))")
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityHint("Highlights only this stage")
            }
            Spacer(minLength: 0)
        }
    }

    // Pattern is illustrative, not reconstructed from recorded samples.
    private var sleepStages: some View {
        Chart {
            ForEach(SleepSegment.night) { segment in
                RectangleMark(xStart: .value("Start", segment.start), xEnd: .value("End", segment.end),
                              yStart: .value("Stage", segment.stage.level),
                              yEnd: .value("Stage end", segment.stage.level + 0.8))
                    .foregroundStyle(segment.stage.colour.opacity(segmentOpacity(segment)))
                    .cornerRadius(3)
            }
            if let scrub {
                RuleMark(x: .value("Time", scrub))
                    .foregroundStyle(Color.white.opacity(0.7))
                    .lineStyle(StrokeStyle(lineWidth: 1))
            }
        }
        .chartXScale(domain: 0...Double(SleepSegment.total))
        .chartYScale(domain: 0...4)
        .chartXAxis {
            AxisMarks(values: [0, 120, 240, 360]) { value in
                AxisGridLine().foregroundStyle(Color.white.opacity(0.08))
                AxisValueLabel {
                    if let minutes = value.as(Int.self) { Text(SleepSegment.clock(minutes)) }
                }
            }
        }
        .chartYAxis {
            AxisMarks(values: [0.4, 1.4, 2.4, 3.4]) { value in
                AxisValueLabel {
                    if let level = value.as(Double.self), let stage = SleepStage(level: Int(level)) {
                        Text(stage.title)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let point): scrub = minute(at: point, proxy: proxy, geometry: geometry)
                        case .ended: scrub = nil
                        }
                    }
                    .gesture(DragGesture(minimumDistance: 0)
                        .onChanged { scrub = minute(at: $0.location, proxy: proxy, geometry: geometry) })
            }
        }
        .frame(height: 190)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: stageFilter)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Illustrative sleep stages, not recorded samples. Deep 1 hour 28, REM 1 hour 42, light 4 hours 32, awake 30 minutes.")
    }

    private func minute(at point: CGPoint, proxy: ChartProxy, geometry: GeometryProxy) -> Double? {
        guard let frame = proxy.plotFrame else { return nil }
        let x = point.x - geometry[frame].origin.x
        guard let value: Double = proxy.value(atX: x) else { return nil }
        return min(max(value, 0), Double(SleepSegment.total) - 0.01)
    }

    private func bars(_ values: [Double], unit: String) -> some View {
        Chart(Array(values.enumerated()), id: \.offset) { item in
            BarMark(x: .value("Day", ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"][item.offset]),
                    y: .value(unit, barsIn ? item.element : 0))
                .foregroundStyle(item.offset == 6 ? desktopAccent : desktopAccent.opacity(0.4))
                .cornerRadius(4)
        }.frame(height: 140).chartYAxis(.hidden)
            .animation(reduceMotion ? nil : .spring(response: 0.7, dampingFraction: 0.8), value: barsIn)
            .onAppear { barsIn = true }
            .onChange(of: page) { _, _ in barsIn = false; DispatchQueue.main.async { barsIn = true } }
    }

    private func title(_ text: String) -> some View {
        Text(text).font(.system(size: 31, weight: .regular, design: .serif))
            .accessibilityAddTraits(.isHeader)
    }
    private func eyebrow(_ text: String) -> some View {
        Text(text).font(.system(size: 10, weight: .medium)).tracking(1.4).foregroundStyle(desktopMuted)
    }
    private func caption(_ text: String) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(desktopMuted)
            .fixedSize(horizontal: false, vertical: true).lineSpacing(3)
    }
    private func metric(_ label: String, _ value: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            caption(label)
            Text(value).font(.system(size: 28, weight: .light)).monospacedDigit()
            caption(detail)
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading).hoverTint(10)
    }
    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(desktopMuted)
            Spacer(minLength: 10)
            Text(value).monospacedDigit()
        }
    }
    private func panel<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).font(.system(size: 21, design: .serif)).accessibilityAddTraits(.isHeader)
            content()
        }.frame(maxWidth: .infinity, alignment: .leading).padding(22)
            .modifier(DesktopReadingSurface(radius: 18)).hoverLift().rise(0.1)
    }
    private func note(_ text: String) -> some View {
        Label { caption(text) } icon: { Image(systemName: "info.circle").foregroundStyle(desktopAccent) }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(desktopAccent.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }
}


enum SleepStage: CaseIterable {
    case awake, rem, light, deep

    /// Vertical position on the chart. Deep sits at the bottom.
    var level: Double {
        switch self { case .deep: 0; case .light: 1; case .rem: 2; case .awake: 3 }
    }
    init?(level: Int) {
        switch level { case 0: self = .deep; case 1: self = .light; case 2: self = .rem; case 3: self = .awake; default: return nil }
    }
    var title: String {
        switch self { case .awake: "Awake"; case .rem: "REM"; case .light: "Light"; case .deep: "Deep" }
    }
    var colour: Color {
        switch self {
        case .awake: Color(red: 0.98, green: 0.78, blue: 0.5)
        case .rem: Color(red: 0.40, green: 0.80, blue: 0.88)
        case .light: Color(red: 0.45, green: 0.66, blue: 0.96)
        case .deep: Color(red: 0.22, green: 0.38, blue: 0.85)
        }
    }
    var blurb: String {
        switch self {
        case .awake: "Brief wake-ups are normal. Most are forgotten by morning."
        case .rem: "Dreaming sleep. The brain is busy and the body is still."
        case .light: "The easy, in-between stage that makes up most of a night."
        case .deep: "The slowest sleep. The body repairs itself most here."
        }
    }
}

/// Illustrative night: 23:12 to 07:24. Totals match the preview summary (deep 88, REM 102, light 272, awake 30).
struct SleepSegment: Identifiable {
    let id: Int
    let stage: SleepStage
    let start: Int
    let minutes: Int
    var end: Int { start + minutes }

    static let total = 492
    private static let startOfNight = 23 * 60 + 12

    static let night: [SleepSegment] = {
        let plan: [(SleepStage, Int)] = [
            (.awake, 12), (.light, 24), (.deep, 30), (.light, 18), (.rem, 10), (.light, 14),
            (.deep, 28), (.light, 26), (.rem, 16), (.awake, 4), (.light, 22),
            (.deep, 20), (.light, 30), (.rem, 22), (.awake, 6), (.light, 28),
            (.deep, 10), (.light, 34), (.rem, 26), (.awake, 3), (.light, 20),
            (.rem, 28), (.light, 36), (.awake, 5), (.light, 20)
        ]
        var cursor = 0
        return plan.enumerated().map { index, item in
            defer { cursor += item.1 }
            return SleepSegment(id: index, stage: item.0, start: cursor, minutes: item.1)
        }
    }()

    static func clock(_ minutes: Int) -> String {
        let absolute = (startOfNight + minutes) % 1440
        return String(format: "%02d:%02d", absolute / 60, absolute % 60)
    }
    static func duration(_ minutes: Int) -> String {
        minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes) min"
    }
}
