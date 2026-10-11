import Foundation

public struct HealthSample: Codable, Sendable {
    public let t: String
    public let v: Double
}

public struct HealthStage: Codable, Sendable, Identifiable {
    public let type: String
    public let startTime: String
    public let endTime: String
    public var id: String { "\(startTime):\(endTime):\(type)" }
    public var start: Date? { HealthDay.timestamp(startTime) }
    public var end: Date? { HealthDay.timestamp(endTime) }
}

public struct HealthSleepSession: Codable, Sendable, Identifiable {
    public let label: String
    public let startTime: String
    public let endTime: String
    public let minutesAsleep: Double?
    public let minutesInPeriod: Double?
    public let stages: [HealthStage]
    public var id: String { "\(startTime):\(endTime)" }
}

public struct HealthDay: Codable, Sendable, Identifiable {
    public let source: String
    public let date: String
    public let timeZone: String
    public let updatedAt: Double
    public let restingHeartRate: Double?
    public let hrv: Double?
    public let spo2: Double?
    public let sleepEfficiency: Double?
    public let sleepMinutes: Double?
    public let steps: Double?
    public let activeMinutes: Double?
    public let respiratoryRate: Double?
    public let skinTempDeviation: Double?
    public let hrvSeries: [HealthSample]?
    public let spo2Series: [HealthSample]?
    public let heartRateSeries: [HealthSample]?
    public let sleepSessions: [HealthSleepSession]?
    public var id: String { "\(source):\(date)" }

    public static func timestamp(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }

    public static func duration(_ minutes: Double?) -> String {
        guard let minutes, minutes.isFinite, minutes >= 0 else { return "Not recorded" }
        let rounded = Int(min(minutes.rounded(), 1_000_000))
        return "\(rounded / 60)h \(rounded % 60)m"
    }
}
