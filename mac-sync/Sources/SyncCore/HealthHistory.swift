import Foundation

public enum HealthPeriod: Int, CaseIterable, Sendable {
    case week = 7, fortnight = 14, month = 30

    public var title: String { "\(rawValue) days" }
}

/// Calendar-day windows, not a count of available records. Missing days stay missing.
public struct HealthHistory: Sendable {
    public let days: [HealthDay]
    public init(days: [HealthDay]) { self.days = days.sorted { $0.date > $1.date } }

    public func selected(_ date: String?) -> HealthDay? {
        days.first { $0.date == date } ?? days.first
    }

    public func window(ending date: String, period: HealthPeriod, previous: Bool = false) -> [HealthDay] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let anchor = formatter.date(from: date) else { return [] }
        let offset = previous ? -period.rawValue : 0
        guard let end = calendar.date(byAdding: .day, value: offset, to: anchor),
              let start = calendar.date(byAdding: .day, value: 1 - period.rawValue, to: end)
        else { return [] }
        let startKey = formatter.string(from: start), endKey = formatter.string(from: end)
        return days.filter { $0.date >= startKey && $0.date <= endKey }.reversed()
    }

    public static func average(_ days: [HealthDay], value: KeyPath<HealthDay, Double?>) -> Double? {
        let values = days.compactMap { $0[keyPath: value] }.filter(\.isFinite)
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }
}
