import SwiftUI

private struct CalendarInspection: Identifiable {
    let event: DesktopCalendarEvent
    let readAt: Date?
    let synthetic: Bool
    var id: String { event.id }
}

private struct CalendarLoad: Hashable {
    let day: Date
    let scenario: DesktopCalendarStore.Scenario
}

struct DesktopCalendarView: View {
    @ObservedObject var store: DesktopCalendarStore
    @State private var inspection: CalendarInspection?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label(store.preview ? "Illustrative calendar · No external reads" : "Apple Calendar · Read-only",
                  systemImage: "calendar")
                .foregroundStyle(desktopAccent).padding(10).modifier(DesktopReadingSurface(radius: 10))
            Text("Space for the day ahead.").font(.system(size: 29, design: .serif))
            DatePicker("Day", selection: $store.day, displayedComponents: .date)
                .accessibilityLabel("Calendar day")
            HStack(spacing: 16) {
                KeyboardActionButton("Previous day") { store.stepDay(-1) }
                KeyboardActionButton("Today") { store.day = Calendar.current.startOfDay(for: .now) }
                KeyboardActionButton("Next day") { store.stepDay(1) }
                Spacer(minLength: 0)
                KeyboardActionButton(store.state == .loading ? "Loading…" : "Refresh") {
                    Task { await store.reload() }
                }.disabled(store.state == .loading)
            }.font(.system(size: 12))
            if store.preview {
                Picker("Preview data", selection: $store.scenario) {
                    ForEach(DesktopCalendarStore.Scenario.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }.keyboardChoice(DesktopCalendarStore.Scenario.allCases, selection: $store.scenario)
                if store.scenario == .loading {
                    KeyboardActionButton("Finish preview load") { store.scenario = .recorded }
                }
            }
            switch store.state {
            case .idle, .loading:
                ProgressView("Reading this day…")
            case .disconnected:
                Text("Calendar read access is unavailable.").font(.system(size: 19, design: .serif))
                Text(store.preview ? "Illustrative disconnected state. No permissions were checked or requested." :
                     "This app needs existing full Calendar access to read events. It will not ask for permission or change your settings. Write-only access cannot read events.")
                    .foregroundStyle(desktopMuted)
                KeyboardActionButton("Check existing access again") { Task { await store.reload() } }
            case .failed:
                Text("This day could not be read.").font(.system(size: 19, design: .serif))
                Text("No events were changed. Try loading the day again.").foregroundStyle(desktopMuted)
                KeyboardActionButton("Retry calendar read") {
                    if store.preview { store.scenario = .recorded }
                    else { Task { await store.reload() } }
                }
            case .ready:
                if store.events.isEmpty {
                    Text("No events recorded for this day.").font(.system(size: 19, design: .serif))
                    Text("An empty calendar is not proof that all of your tasks are scheduled.").foregroundStyle(desktopMuted)
                }
                ForEach(store.events) { event in
                    KeyboardActionButton {
                        inspection = CalendarInspection(event: event, readAt: store.lastRead, synthetic: store.preview)
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(event.allDay ? "All day" : "\(event.start.formatted(date: .omitted, time: .shortened)) to \(event.end.formatted(date: .omitted, time: .shortened))")
                                .font(.system(size: 12)).foregroundStyle(desktopAccent)
                            Text(event.title).font(.system(size: 19, design: .serif))
                            Text(event.calendar).font(.system(size: 12)).foregroundStyle(desktopMuted)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                            .padding(20).modifier(DesktopReadingSurface(radius: 16))
                    }.accessibilityLabel("Inspect calendar event \(event.title)")
                }
            }
            if let read = store.lastRead {
                Text("\(store.preview ? "Demo loaded" : "Last read") \(read.formatted()) · Refresh on demand")
                    .font(.system(size: 11)).foregroundStyle(desktopMuted)
            }
            Text("Task dates are separate from calendar events. This screen never creates, edits or deletes events.")
                .font(.system(size: 12)).foregroundStyle(desktopMuted)
        }
        .task(id: CalendarLoad(day: store.day, scenario: store.scenario)) { await store.reload() }
        .sheet(item: $inspection) { selected in
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Event details").font(.system(size: 19, design: .serif))
                    Spacer()
                    KeyboardActionButton("Done") { inspection = nil }.keyboardShortcut(.cancelAction)
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(selected.event.title).font(.system(size: 24, design: .serif))
                        Text("\(selected.event.start.formatted()) to \(selected.event.end.formatted())")
                        Text("Calendar: \(selected.event.calendar)")
                        if selected.event.allDay { Text("All-day event") }
                        if let location = selected.event.location { Text(location) }
                        Text(selected.event.notes ?? "No notes supplied.").textSelection(.enabled)
                        Text(selected.synthetic ? "Source: illustrative preview, not saved to Calendar." : "Source: Apple Calendar via existing EventKit access.")
                            .foregroundStyle(desktopAccent)
                        Text(selected.readAt.map { "Read at \($0.formatted())" } ?? "Read time unavailable")
                            .foregroundStyle(desktopMuted)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding(24).frame(width: 470, height: 440).preferredColorScheme(.dark)
                .closeSheetShortcut()
        }
    }
}
