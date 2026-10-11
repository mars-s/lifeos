import AppKit
import SwiftUI
import Charts
import SyncCore

struct DesktopConvexHealthView: View {
    @Binding var page: DesktopHealthView.Page
    @ObservedObject var store: ConvexHealthStore
    @State private var sleepInspections: [String: Date] = [:]
    @State private var selectedStage = "All stages"
    @Binding var selectedDate: String?
    @Binding var period: HealthPeriod
    @State private var historyInspection: String?
    @State private var selectedMetric: HealthMetric?
    @State private var sampleInspection: Date?
    @Environment(\.lifeOSReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    init(page: Binding<DesktopHealthView.Page>, store: ConvexHealthStore,
         selectedDate: Binding<String?>, period: Binding<HealthPeriod>) {
        _page = page
        self.store = store
        _selectedDate = selectedDate
        _period = period
    }

    private var historyModel: HealthHistory { HealthHistory(days: store.days) }
    private var selectedDay: HealthDay? { historyModel.selected(selectedDate) }
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            connection
            if page == .sources {
                panel("Your data, on your Mac") {
                    if store.preview {
                        Text("These records are illustrative and exist only in memory. The preview never reads Keychain or connects to a backend.")
                        Text("\(store.days.count) illustrative days available. Switch preview state above to explore missing data and connection failures.")
                    } else {
                    Text("This app reads stored records from your local Convex backend, not from Google directly.")
                    Text("Google OAuth and automatic health ingestion are not connected yet. An empty database stays empty, with no invented measurements.")
                        .foregroundStyle(desktopMuted)
                    Text("The app stores only its gateway token in Keychain. The backend admin key stays outside the app.")
                        .foregroundStyle(desktopMuted)
                    if !store.days.isEmpty {
                        Text("\(store.days.count) stored days available · \(store.source)")
                    }
                    }
                }
            } else if let day = selectedDay {
                dayNavigation(day)
                HStack {
                    Text("\(day.date) · \(day.timeZone)").foregroundStyle(desktopMuted)
                    Spacer()
                    Text(store.source == "synthetic" ? "ILLUSTRATIVE PREVIEW" : "STORED MEASUREMENTS")
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(desktopAccent)
                }.font(.system(size: 11))
                if !store.connected {
                    Label("Showing the last loaded records. The backend is currently unavailable.", systemImage: "wifi.slash")
                        .foregroundStyle(desktopMuted)
                }
                switch page {
                case .overview: overview(day)
                case .sleep: sleep(day)
                case .signals: signals(day)
                case .movement: movement(day)
                case .sources: EmptyView()
                }
            } else {
                panel(store.loading ? "Loading your health records" : store.connected ? "No health records yet" : "Your health records are unavailable") {
                    if store.loading { ProgressView().controlSize(.small) }
                    Text(emptyStateMessage)
                        .foregroundStyle(desktopMuted)
                    KeyboardActionButton("Open Sources") { page = .sources }.buttonStyle(PressStyle())
                    if !store.loading { KeyboardActionButton("Retry") { refresh() }.buttonStyle(PressStyle()) }
                }
            }
        }
        .font(.system(size: 13))
        .task(id: store.source) {
            if store.loadedSource != store.source || store.refreshed == nil {
                await store.reload(clear: true)
            } else if !store.preview, store.refreshed.map({ Date().timeIntervalSince($0) > 300 }) ?? false {
                await store.reload()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, !store.loading,
               store.refreshed.map({ Date().timeIntervalSince($0) > 300 }) ?? false {
                Task { await store.reload() }
            }
        }
        .onChange(of: selectedDate) { _, _ in sleepInspections = [:]; historyInspection = nil; sampleInspection = nil }
        .onChange(of: period) { _, _ in historyInspection = nil }
        .onChange(of: store.previewState) { _, _ in Task { await store.reload(clear: true) } }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: page)
        .sheet(item: $selectedMetric) { item in
            if let day = selectedDay { metricDetail(item, day: day).closeSheetShortcut() }
        }
    }

    private var emptyStateMessage: String {
        if store.loading { return "Loading stored days. Your measurements will appear here when the request finishes." }
        if store.preview {
            if store.previewState == .failure {
                return "The preview request failed. Retry to restore illustrative records, or open Sources to choose another scenario."
            }
            return "The empty preview has no measurements. Open Sources to return to illustrative records. No backend is connected."
        }
        return store.connected
            ? "The local backend is connected, but this source has no stored days yet."
            : "Connect the app to Convex in Sources. If it is already configured, start Docker and retry."
    }

    private var connection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: store.connected ? "externaldrive.connected.to.line.below" : "externaldrive")
                    .foregroundStyle(desktopAccent)
                Text(store.status).foregroundStyle(desktopMuted)
                Spacer(minLength: 12)
                if store.loading { ProgressView().controlSize(.small) }
                KeyboardActionButton(store.loading ? "Loading…" : store.connected ? "Refresh" : "Retry") { refresh() }
                    .disabled(store.loading).buttonStyle(PressStyle())
            }
            if page == .sources {
                if store.preview {
                    Picker("Preview state", selection: $store.previewState) {
                        ForEach(HealthPreviewState.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }.pickerStyle(.segmented)
                        .keyboardChoice(HealthPreviewState.allCases, selection: $store.previewState)
                    if store.previewState == .loading {
                        KeyboardActionButton("Finish preview load") { store.previewState = .recorded }
                    }
                    Text("Use these states to explore the interface. Finish the loading preview above, or choose Recorded. No stored records are changed.")
                        .font(.caption).foregroundStyle(desktopMuted)
                } else {
                Picker("Data source", selection: $store.source) {
                    Text("Google Health").tag("google-health")
                    Text("Synthetic test data").tag("synthetic")
                }.pickerStyle(.segmented)
                HStack(spacing: 16) {
                    KeyboardActionButton("Connect local backend…") { selectConfiguration() }.buttonStyle(PressStyle())
                    KeyboardActionButton("Disconnect") { store.disconnect() }.buttonStyle(PressStyle())
                }
                Text("Select the backend’s .env.local file. Only LIFEOS_NATIVE_TOKEN is imported.")
                    .font(.system(size: 11)).foregroundStyle(desktopMuted)
                }
            }
            if let date = store.refreshed {
                Text("Last loaded \(date.formatted(date: .abbreviated, time: .shortened)) · Refresh on demand")
                    .font(.system(size: 10)).foregroundStyle(desktopMuted)
            }
        }.font(.system(size: 12)).padding(page == .sources ? 18 : 12)
            .modifier(DesktopReadingSurface(radius: 18))
    }

    private func refresh() {
        if store.preview && [.offline, .failure].contains(store.previewState) {
            store.previewState = .recorded
        } else { Task { await store.reload() } }
    }

    private func dayNavigation(_ day: HealthDay) -> some View {
        ViewThatFits(in: .horizontal) {
        HStack(spacing: 12) {
            recordedDayPicker
            Spacer(minLength: 8)
            periodPicker
        }
        VStack(alignment: .leading, spacing: 12) {
            recordedDayPicker
            periodPicker
        }
        }
    }

    private var recordedDayPicker: some View {
        let selection = Binding(get: { selectedDay?.date ?? "" }, set: { selectedDate = $0 })
        return Picker("Recorded day", selection: selection) {
                ForEach(store.days) { item in Text(item.date).tag(item.date) }
            }.frame(maxWidth: 200).accessibilityHint("Choose a stored day to inspect its measurements")
                .keyboardChoice(store.days.map(\.date), selection: selection)
    }

    private var periodPicker: some View {
        Picker("Comparison period", selection: $period) {
                ForEach(HealthPeriod.allCases, id: \.self) { Text($0.title).tag($0) }
            }.pickerStyle(.segmented).labelsHidden().frame(maxWidth: 260)
                .accessibilityLabel("Comparison period")
                .keyboardChoice(HealthPeriod.allCases, selection: $period)
    }

    private func selectConfiguration() {
        let picker = NSOpenPanel()
        picker.title = "Connect LifeOS to local Convex"
        picker.message = "Choose the backend’s .env.local configuration. The admin key is not imported."
        picker.canChooseDirectories = false
        picker.allowsMultipleSelection = false
        picker.showsHiddenFiles = true
        picker.begin { result in
            guard result == .OK, let url = picker.url else { return }
            Task { await store.importConfiguration(url) }
        }
    }

    private func overview(_ day: HealthDay) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Your day, in perspective.").font(.system(size: 28, design: .serif))
            Text(HealthDay.duration(day.sleepMinutes))
                .font(.system(size: 60, weight: .ultraLight)).monospacedDigit()
            Text("Sleep duration").foregroundStyle(desktopMuted)
            measurements(day)
            panel("Daily summary") {
                HStack(spacing: 10) {
                    CometMark()
                    Text("Comparisons use recorded days only.")
                        .foregroundStyle(desktopMuted)
                }
                if let minutes = day.sleepMinutes {
                    let previous = historyModel.window(ending: day.date, period: period, previous: true).compactMap(\.sleepMinutes)
                    if !previous.isEmpty {
                        let average = previous.reduce(0, +) / Double(previous.count)
                        Text("\(HealthDay.duration(minutes)) sleep, compared with \(HealthDay.duration(average)) across \(previous.count) recorded days in the previous \(period.rawValue)-day period.")
                    } else {
                        Text("Sleep was \(HealthDay.duration(minutes)). More stored days are needed for a comparison.")
                    }
                } else { Text("Sleep duration has not been recorded for this day.") }
            }
            KeyboardActionButton("Explore sleep") { page = .sleep }.buttonStyle(PressStyle())
        }
    }

    private func measurements(_ day: HealthDay) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), alignment: .leading)], spacing: 12) {
            ForEach(HealthMetric.allCases.filter { $0 != .activeMinutes }) { item in
                KeyboardActionButton { selectedMetric = item } label: {
                    metric(item.title, day[keyPath: item.value], item.unit, precision: item == .steps ? 0 : 1)
                }.buttonStyle(.plain)
                    .accessibilityLabel("\(item.title), \(day[keyPath: item.value].map { String($0) + " " + item.unit } ?? "not recorded")")
                    .accessibilityHint("Open recorded history, source and measurement details")
            }
        }.padding(12).modifier(DesktopReadingSurface(radius: 18))
    }

    private func metricDetail(_ item: HealthMetric, day: HealthDay) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text(item.title).font(.system(size: 26, design: .serif)).accessibilityAddTraits(.isHeader)
                Spacer()
                KeyboardActionButton("Done") { selectedMetric = nil }.keyboardShortcut(.cancelAction)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    metric(item.title, day[keyPath: item.value], item.unit, precision: item == .steps ? 0 : 1)
                    Text(item.explanation).foregroundStyle(desktopMuted)
                    Text("\(day.date) · \(day.timeZone)").font(.caption).foregroundStyle(desktopMuted)
                    Text("Source: \(day.source == "synthetic" ? "Illustrative preview data" : day.source)")
                    Text("Record updated \(Date(timeIntervalSince1970: day.updatedAt / 1000).formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(desktopMuted)
                    Picker("Detail comparison period", selection: $period) {
                        ForEach(HealthPeriod.allCases, id: \.self) { Text($0.title).tag($0) }
                    }.pickerStyle(.segmented)
                        .keyboardChoice(HealthPeriod.allCases, selection: $period)
                    history("Recorded history", value: item.value, unit: item.unit)
                    Text("Measurements are shown as supplied, not a diagnosis or a provider readiness score.")
                        .font(.caption).foregroundStyle(desktopMuted)
                }
            }
        }.padding(28).frame(minWidth: 440, idealWidth: 560, maxWidth: 640, minHeight: 480, idealHeight: 640)
            .background(desktopInk).foregroundStyle(Color(white: 0.93))
    }

    private func sleep(_ day: HealthDay) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Your recorded night.").font(.system(size: 28, design: .serif))
            Text(HealthDay.duration(day.sleepMinutes)).font(.system(size: 58, weight: .ultraLight))
            panel("Sleep efficiency") {
                metric("Calculated efficiency, not Sleep Score", day.sleepEfficiency, "%")
            }
            if let sessions = day.sleepSessions, !sessions.isEmpty {
                ForEach(sessions) { session in
                    let inspection = Binding<Date?>(
                        get: { sleepInspections[session.id] },
                        set: { sleepInspections[session.id] = $0 }
                    )
                    panel(session.label) {
                        Text(HealthDay.duration(session.minutesAsleep)).font(.system(size: 25, weight: .light))
                        Text("\(clock(session.startTime, zone: day.timeZone)) to \(clock(session.endTime, zone: day.timeZone))")
                            .foregroundStyle(desktopMuted)
                        if session.stages.isEmpty {
                            Text("No sleep stages recorded. Duration is shown without a guessed timeline.")
                                .foregroundStyle(desktopMuted)
                        } else {
                            Picker("Sleep stage", selection: $selectedStage) {
                                ForEach(["All stages", "AWAKE", "REM", "LIGHT", "DEEP"], id: \.self) { Text($0).tag($0) }
                            }.pickerStyle(.segmented)
                                .keyboardChoice(["All stages", "AWAKE", "REM", "LIGHT", "DEEP"], selection: $selectedStage)
                            Chart {
                            ForEach(session.stages) { stage in
                                if let start = stage.start, let end = stage.end {
                                    BarMark(xStart: .value("Start", start), xEnd: .value("End", end),
                                            y: .value("Stage", stage.type))
                                        .foregroundStyle(stageColour(stage.type))
                                        .opacity(selectedStage == "All stages" || selectedStage == stage.type ? 1 : 0.18)
                                        .cornerRadius(4)
                                }
                            }
                                if let time = inspection.wrappedValue { RuleMark(x: .value("Inspected time", time)).foregroundStyle(.white.opacity(0.7)) }
                            }
                            .chartYScale(domain: ["DEEP", "LIGHT", "REM", "AWAKE"])
                            .chartXSelection(value: inspection)
                            .recordedChartGesture()
                            .frame(height: 210)
                            .environment(\.timeZone, TimeZone(identifier: day.timeZone) ?? .current)
                            .accessibilityLabel("Recorded sleep stages for \(session.label)")
                            if let start = HealthDay.timestamp(session.startTime),
                               let end = HealthDay.timestamp(session.endTime), end > start {
                                Slider(value: Binding(
                                    get: { min(max((inspection.wrappedValue ?? start).timeIntervalSince1970, start.timeIntervalSince1970), end.timeIntervalSince1970) },
                                    set: { inspection.wrappedValue = Date(timeIntervalSince1970: $0) }
                                ), in: start.timeIntervalSince1970...end.timeIntervalSince1970, step: 60)
                                .accessibilityLabel("Inspect sleep time")
                                .accessibilityValue(clock(ISO8601DateFormatter().string(from: inspection.wrappedValue ?? start), zone: day.timeZone))
                                .accessibilityHint("Use arrow keys to inspect the night minute by minute")
                                .focusable()
                                .onKeyPress(keys: [.leftArrow, .rightArrow]) { press in
                                    let delta: TimeInterval = press.key == .leftArrow ? -60 : 60
                                    inspection.wrappedValue = min(max((inspection.wrappedValue ?? start).addingTimeInterval(delta), start), end)
                                    return .handled
                                }
                                HStack(spacing: 16) {
                                    KeyboardActionButton("Earlier minute") {
                                        inspection.wrappedValue = max((inspection.wrappedValue ?? start).addingTimeInterval(-60), start)
                                    }.disabled((inspection.wrappedValue ?? start) <= start)
                                    KeyboardActionButton("Later minute") {
                                        inspection.wrappedValue = min((inspection.wrappedValue ?? start).addingTimeInterval(60), end)
                                    }.disabled((inspection.wrappedValue ?? start) >= end)
                                }
                            }
                            if let inspection = inspection.wrappedValue,
                               let stage = session.stages.first(where: {
                                   guard let start = $0.start, let end = $0.end else { return false }
                                   return inspection >= start && inspection < end
                               }) {
                                Text("\(stage.type) · \(clock(stage.startTime, zone: day.timeZone)) to \(clock(stage.endTime, zone: day.timeZone))")
                                    .foregroundStyle(desktopAccent)
                            } else if let inspection = inspection.wrappedValue {
                                Text("No recorded stage at \(clock(ISO8601DateFormatter().string(from: inspection), zone: day.timeZone)).")
                                    .foregroundStyle(desktopMuted)
                            } else {
                                Text("Drag across the timeline to inspect a recorded stage.").foregroundStyle(desktopMuted)
                            }
                            let stages = session.stages.filter { selectedStage == "All stages" || $0.type == selectedStage }
                            let validMinutes = stages.compactMap { stage -> Double? in
                                guard let start = stage.start, let end = stage.end, end > start else { return nil }
                                return end.timeIntervalSince(start) / 60
                            }
                            Text("\(selectedStage == "All stages" ? "Recorded stages" : selectedStage): \(HealthDay.duration(validMinutes.isEmpty ? nil : validMinutes.reduce(0, +)))")
                                .font(.caption).foregroundStyle(desktopMuted)
                        }
                    }
                }
            } else {
                panel("Sleep stages") {
                    Text("No sessions stored for this day.").foregroundStyle(desktopMuted)
                }
            }
            history("Stored sleep history", value: \.sleepMinutes, unit: "minutes")
        }
    }

    private func signals(_ day: HealthDay) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Your recorded body signals").font(.system(size: 28, design: .serif))
            measurements(day)
            series("Heart rate", samples: day.heartRateSeries, unit: "bpm", zone: day.timeZone)
            series("HRV", samples: day.hrvSeries, unit: "ms", zone: day.timeZone)
            series("Blood oxygen", samples: day.spo2Series, unit: "%", zone: day.timeZone)
        }
    }

    private func movement(_ day: HealthDay) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Your day in motion.").font(.system(size: 28, design: .serif))
            panel("Your recorded movement") {
                HStack {
                    KeyboardActionButton { selectedMetric = .steps } label: {
                        metric("Steps", day.steps, "steps", precision: 0)
                    }.buttonStyle(.plain).accessibilityHint("Open step history and source details")
                    KeyboardActionButton { selectedMetric = .activeMinutes } label: {
                        metric("Active minutes", day.activeMinutes, "min")
                    }.buttonStyle(.plain).accessibilityHint("Open active-minute history and source details")
                }
                Text("Active minutes are not active-zone minutes. Distance, energy and workouts have not been imported.")
                    .foregroundStyle(desktopMuted)
            }
            history("Stored steps history", value: \.steps, unit: "steps")
        }
    }

    private func series(_ title: String, samples: [HealthSample]?, unit: String, zone: String) -> some View {
        panel(title) {
            if let samples, samples.contains(where: { HealthDay.timestamp($0.t) != nil }) {
                let valid = samples.compactMap { sample -> (Date, Double)? in
                    guard let date = HealthDay.timestamp(sample.t), sample.v.isFinite else { return nil }
                    return (date, sample.v)
                }.sorted { $0.0 < $1.0 }
                let nearest = sampleInspection.flatMap { selected in
                    valid.min(by: { abs($0.0.timeIntervalSince(selected)) < abs($1.0.timeIntervalSince(selected)) })?.0
                }
                Chart(Array(samples.enumerated()), id: \.offset) { sample in
                    if let time = HealthDay.timestamp(sample.element.t) {
                        PointMark(x: .value("Time", time), y: .value(unit, sample.element.v))
                            .foregroundStyle(desktopAccent).symbolSize(time == nearest ? 90 : 15)
                    }
                }.frame(height: 150).environment(\.timeZone, TimeZone(identifier: zone) ?? .current)
                    .chartXSelection(value: $sampleInspection)
                    .recordedChartGesture()
                    .accessibilityLabel("\(title), recorded samples in \(unit)")
                RecordedSelectionControls(title: "\(title) sample", values: valid.map(\.0), selection: Binding(
                    get: { nearest }, set: { sampleInspection = $0 }
                )) { selected in
                    guard let sample = valid.first(where: { $0.0 == selected }) else { return "No sample recorded" }
                    return "\(sample.1.formatted(.number.precision(.fractionLength(0...1)))) \(unit) at \(clock(ISO8601DateFormatter().string(from: selected), zone: zone))"
                }
                Text("Recorded samples only. Gaps are not filled in.").foregroundStyle(desktopMuted)
            } else {
                Text("No samples recorded.").foregroundStyle(desktopMuted)
            }
        }
    }
    private func history(_ title: String, value: KeyPath<HealthDay, Double?>, unit: String) -> some View {
        panel(title) {
            let days = selectedDay.map { historyModel.window(ending: $0.date, period: period) } ?? []
            let previous = selectedDay.map { historyModel.window(ending: $0.date, period: period, previous: true) } ?? []
            if days.contains(where: { $0[keyPath: value] != nil }) {
                Chart(days) { day in
                    if let number = day[keyPath: value] {
                        BarMark(x: .value("Date", day.date), y: .value(unit, number))
                            .foregroundStyle(desktopAccent).cornerRadius(4)
                            .opacity(historyInspection == nil || historyInspection == day.date ? 1 : 0.35)
                    }
                }.frame(height: 170)
                    .chartXAxis {
                        let stride = max(1, (days.count + 4) / 5)
                        AxisMarks(values: days.enumerated().filter { $0.offset % stride == 0 || $0.offset == days.count - 1 }.map { $0.element.date }) { axis in
                            AxisGridLine()
                            AxisValueLabel {
                                if let date = axis.as(String.self) { Text(shortDay(date)) }
                            }
                        }
                    }
                    .chartXSelection(value: $historyInspection)
                    .recordedChartGesture()
                    .accessibilityLabel("\(title), \(period.rawValue)-day period")
                RecordedSelectionControls(title: "recorded day", values: days.filter { $0[keyPath: value] != nil }.map(\.date),
                                          selection: $historyInspection) { date in
                    guard let number = days.first(where: { $0.date == date })?[keyPath: value] else { return "\(date): not recorded" }
                    return "\(date): \(measurement(number, unit: unit))"
                }
                if let date = historyInspection, let day = days.first(where: { $0.date == date }) {
                    KeyboardActionButton("Inspect \(day.date)") { selectedDate = day.date }
                        .accessibilityHint("Open all recorded measurements for this day")
                }
                if let average = HealthHistory.average(days, value: value) {
                    Text("Average \(measurement(average, unit: unit)) · \(days.compactMap { $0[keyPath: value] }.count) recorded days")
                        .foregroundStyle(desktopMuted)
                    if let baseline = HealthHistory.average(previous, value: value) {
                        Text("Previous \(period.rawValue) days: \(measurement(baseline, unit: unit))")
                            .foregroundStyle(desktopMuted)
                    } else { Text("No measurements in the previous period.").foregroundStyle(desktopMuted) }
                }
                Text("Missing days are not counted as zero.").font(.caption).foregroundStyle(desktopMuted)
            } else { Text("No history recorded.").foregroundStyle(desktopMuted) }
        }
    }
    private func measurement(_ value: Double, unit: String) -> String {
        if unit == "minutes" { return HealthDay.duration(value) }
        return "\(value.formatted(.number.precision(.fractionLength(0...1)))) \(unit)"
    }
    private func shortDay(_ key: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_AU")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: key) else { return key }
        formatter.dateFormat = "d MMM"
        return formatter.string(from: date)
    }
    private func metric(_ label: String, _ value: Double?, _ unit: String, precision: Int = 1) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.system(size: 12)).foregroundStyle(desktopMuted)
            Text(value.map { $0.formatted(.number.precision(.fractionLength(0...precision))) } ?? "Not recorded")
                .font(.system(size: value == nil ? 17 : 28, weight: .light)).monospacedDigit()
            Text(unit).font(.system(size: 11)).foregroundStyle(desktopMuted)
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading).hoverTint(10)
    }
    private func panel<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).font(.system(size: 21, design: .serif)).accessibilityAddTraits(.isHeader)
            content()
        }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
            .modifier(DesktopReadingSurface(radius: 18)).hoverLift()
    }
    private func clock(_ timestamp: String, zone: String) -> String {
        guard let date = HealthDay.timestamp(timestamp) else { return "Not recorded" }
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
    private func stageColour(_ type: String) -> Color {
        switch type {
        case "AWAKE": .orange
        case "REM": .cyan
        case "LIGHT": Color(red: 0.43, green: 0.65, blue: 0.96)
        case "DEEP": Color(red: 0.18, green: 0.36, blue: 0.81)
        default: .gray
        }
    }
}
