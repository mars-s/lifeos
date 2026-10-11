import Foundation
import EventKit

struct DesktopCalendarEvent: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let start: Date
    let end: Date
    let allDay: Bool
    let calendar: String
    let location: String?
    let notes: String?
}

enum CalendarDayRead: Sendable {
    case available([DesktopCalendarEvent])
    case accessUnavailable
}

private enum ExistingCalendarReader {
    enum Failure: Error { case invalidDay, invalidEvent, tooManyEvents }

    @concurrent static func read(_ day: Date) async throws -> CalendarDayRead {
        try Task.checkCancellation()
        // Never request access. A denied, restricted or write-only grant cannot read events.
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return .accessUnavailable }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: day)
        guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { throw Failure.invalidDay }
        let store = EKEventStore()
        let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
        guard events.count <= 5000 else { throw Failure.tooManyEvents }
        let records = try events.enumerated().map { index, event in
            guard let start = event.startDate, let end = event.endDate,
                  let calendar = event.calendar else { throw Failure.invalidEvent }
            return DesktopCalendarEvent(id: "\(event.eventIdentifier ?? "local")-\(start.timeIntervalSince1970)-\(index)",
                title: event.title ?? "Untitled event", start: start, end: end,
                allDay: event.isAllDay, calendar: calendar.title,
                location: event.location, notes: event.notes)
        }
        try Task.checkCancellation()
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return .accessUnavailable }
        return .available(records.sorted { $0.start < $1.start })
    }
}

final class DesktopCalendarStore: ObservableObject {
    enum State: Equatable { case idle, loading, ready, disconnected, failed }
    enum Scenario: String, CaseIterable { case recorded = "Recorded", empty = "Empty", disconnected = "Disconnected", loading = "Loading", failed = "Error" }
    let preview: Bool
    @Published var day = Calendar.current.startOfDay(for: Date.now)
    @Published var scenario = Scenario.recorded
    @Published private(set) var state = State.idle
    @Published private(set) var events: [DesktopCalendarEvent] = []
    @Published private(set) var lastRead: Date?
    private var generation = 0
    private let readDay: @Sendable (Date) async throws -> CalendarDayRead

    init(preview: Bool, readDay: (@Sendable (Date) async throws -> CalendarDayRead)? = nil) {
        self.preview = preview
        self.readDay = readDay ?? { try await ExistingCalendarReader.read($0) }
    }

    func stepDay(_ offset: Int) {
        if let next = Calendar.current.date(byAdding: .day, value: offset, to: day) { day = next }
    }

    func reload() async {
        generation += 1
        let request = generation, requestedDay = day
        state = .loading; events = []; lastRead = nil
        if preview {
            switch scenario {
            case .loading: return
            case .disconnected: state = .disconnected
            case .failed: state = .failed
            case .empty: state = .ready; lastRead = .now
            case .recorded:
                let calendar = Calendar.current
                if let start = calendar.date(bySettingHour: 10, minute: 0, second: 0, of: requestedDay) {
                    events = [DesktopCalendarEvent(id: "preview-focus", title: "A quiet hour",
                        start: start, end: start.addingTimeInterval(3600), allDay: false,
                        calendar: "Illustrative calendar", location: nil,
                        notes: "Demo event only. No calendar reservation has been made.")]
                }
                state = .ready; lastRead = .now
            }
            return
        }
        do {
            let result = try await readDay(requestedDay)
            guard request == generation, requestedDay == day, !Task.isCancelled else { return }
            switch result {
            case .available(let records): events = records; state = .ready; lastRead = .now
            case .accessUnavailable: state = .disconnected
            }
        } catch {
            guard request == generation, requestedDay == day, !Task.isCancelled else { return }
            state = .failed
        }
    }
}
