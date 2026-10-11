import Foundation
import Testing
@testable import SyncCore

private func healthDay(_ date: String, sleep: Double? = nil) throws -> HealthDay {
    var json: [String: Any] = ["source": "synthetic", "date": date,
                               "timeZone": "Australia/Melbourne", "updatedAt": 1]
    if let sleep { json["sleepMinutes"] = sleep }
    return try JSONDecoder().decode(HealthDay.self, from: JSONSerialization.data(withJSONObject: json))
}

@Test func historyUsesCalendarWindowsAndNeverPadsMissingDays() throws {
    let history = HealthHistory(days: try [healthDay("2026-10-11", sleep: 420),
                                          healthDay("2026-10-05"), healthDay("2026-10-04", sleep: 360),
                                          healthDay("2026-10-12", sleep: 500)])
    let current = history.window(ending: "2026-10-11", period: .week)
    #expect(current.map(\.date) == ["2026-10-05", "2026-10-11"])
    #expect(HealthHistory.average(current, value: \.sleepMinutes) == 420)
    let previous = history.window(ending: "2026-10-11", period: .week, previous: true)
    #expect(previous.map(\.date) == ["2026-10-04"])
    #expect(HealthHistory.average(previous, value: \.sleepMinutes) == 360)
}

@Test func historySelectionSurvivesMissingSelectionAndEmptyRecords() throws {
    let history = HealthHistory(days: try [healthDay("2026-10-01"), healthDay("2026-10-11")])
    #expect(history.selected("2026-10-01")?.date == "2026-10-01")
    #expect(history.selected("removed")?.date == "2026-10-11")
    #expect(HealthHistory(days: []).selected(nil) == nil)
    #expect(HealthHistory.average([], value: \.sleepMinutes) == nil)
    #expect(history.window(ending: "invalid", period: .week).isEmpty)
}

@Test func previewRecordsAreSyntheticAndKeepUnavailableSignalsAbsent() throws {
    let days = try HealthPreview.days()
    #expect(days.count == 14)
    #expect(days.allSatisfy { $0.source == "synthetic" })
    #expect(days.first?.sleepMinutes == 462)
    #expect(days.first?.spo2 == nil)
    #expect(days.first?.skinTempDeviation == nil)
    #expect(days.first?.sleepSessions?.first?.stages.count == 6)
    #expect(days.first?.heartRateSeries?.count == 12)
    #expect(days.dropFirst(2).allSatisfy { $0.sleepSessions == nil })
    let sessions = try #require(days[1].sleepSessions)
    #expect(sessions.count == 2)
    #expect(Set(sessions.map(\.id)).count == 2)
    #expect(sessions.reduce(0) { $0 + ($1.minutesAsleep ?? 0) } == days[1].sleepMinutes)
}
