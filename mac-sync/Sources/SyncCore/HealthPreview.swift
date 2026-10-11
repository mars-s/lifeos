import Foundation

public enum HealthPreviewState: String, CaseIterable, Sendable {
    case recorded = "Recorded", empty = "Empty", offline = "Offline"
    case loading = "Loading", failure = "Error"
}

/// In-memory illustrative records only. Never imported into the health backend.
public enum HealthPreview {
    public static func days() throws -> [HealthDay] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Australia/Melbourne")!
        let anchor = calendar.date(from: DateComponents(year: 2026, month: 10, day: 11))!
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_AU")
        formatter.dateFormat = "yyyy-MM-dd"
        return try (0..<14).map { index in
            let date = calendar.date(byAdding: .day, value: -index, to: anchor)!
            let dateKey = formatter.string(from: date)
            let start = calendar.date(bySettingHour: 0, minute: 0, second: 0, of: date)!
            let stamp = ISO8601DateFormatter()
            let segments: [(String, Int)] = [("LIGHT", 68), ("DEEP", 88), ("LIGHT", 120),
                                             ("REM", 102), ("AWAKE", 30), ("LIGHT", 84)]
            var cursor = start
            let stages: [[String: Any]] = segments.map { type, minutes in
                let end = cursor.addingTimeInterval(Double(minutes) * 60)
                defer { cursor = end }
                return ["type": type, "startTime": stamp.string(from: cursor), "endTime": stamp.string(from: end)]
            }
            var record: [String: Any] = [
                "source": "synthetic", "date": dateKey, "timeZone": "Australia/Melbourne",
                "updatedAt": anchor.timeIntervalSince1970 * 1000,
                "sleepMinutes": 420 + Double(index % 4) * 14,
                "restingHeartRate": 55 + Double(index % 3), "hrv": 42 + Double(index % 5) * 3,
                "steps": 4200 + index * 340, "activeMinutes": 28 + index * 2,
            ]
            // Leave some signals and days absent to exercise honest missing-data states.
            if index % 3 != 0 { record["spo2"] = 97; record["respiratoryRate"] = 14 }
            if index == 0 {
                record["sleepMinutes"] = 462; record["sleepEfficiency"] = 93.9
                record["sleepSessions"] = [["label": "Illustrative main sleep", "startTime": stamp.string(from: start),
                                             "endTime": stamp.string(from: cursor), "minutesAsleep": 462,
                                             "minutesInPeriod": 492, "stages": stages]]
                record["heartRateSeries"] = (0..<12).map { sample in
                    ["t": stamp.string(from: start.addingTimeInterval(Double(sample) * 1800)), "v": 52 + sample % 5] as [String: Any]
                }
            }
            if index == 1 {
                let napStart = start.addingTimeInterval(14 * 3600)
                let napEnd = napStart.addingTimeInterval(30 * 60)
                record["sleepMinutes"] = 492
                record["sleepSessions"] = [
                    ["label": "Illustrative main sleep", "startTime": stamp.string(from: start),
                     "endTime": stamp.string(from: cursor), "minutesAsleep": 462,
                     "minutesInPeriod": 492, "stages": stages],
                    ["label": "Illustrative nap", "startTime": stamp.string(from: napStart),
                     "endTime": stamp.string(from: napEnd), "minutesAsleep": 30,
                     "minutesInPeriod": 30, "stages": [
                        ["type": "LIGHT", "startTime": stamp.string(from: napStart),
                         "endTime": stamp.string(from: napEnd)]
                     ]]
                ]
            }
            return try JSONDecoder().decode(HealthDay.self, from: JSONSerialization.data(withJSONObject: record))
        }
    }
}
