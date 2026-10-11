import Foundation
import Testing
@testable import SyncCore

@Test func healthRecordKeepsMissingMeasurementsMissing() throws {
    let json = Data(#"{"source":"google-health","date":"2026-10-06","timeZone":"Australia/Melbourne","updatedAt":1,"steps":123}"#.utf8)
    let day = try JSONDecoder().decode(HealthDay.self, from: json)
    #expect(day.steps == 123)
    #expect(day.hrv == nil)
    #expect(day.sleepSessions == nil)
    #expect(day.sleepEfficiency == nil)
}

@Test func healthTimestampSupportsFractionalAndWholeSeconds() {
    #expect(HealthDay.timestamp("2026-10-05T20:00:00.123Z") != nil)
    #expect(HealthDay.timestamp("2026-10-05T20:00:00Z") != nil)
    #expect(HealthDay.timestamp("bad") == nil)
}

@Test func healthDurationDoesNotInventZeroForMissingData() {
    #expect(HealthDay.duration(nil) == "Not recorded")
    #expect(HealthDay.duration(-1) == "Not recorded")
    #expect(HealthDay.duration(462) == "7h 42m")
}
