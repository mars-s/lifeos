import SyncCore

enum HealthMetric: String, CaseIterable, Identifiable {
    case heartRate, hrv, oxygen, breathing, temperature, steps, activeMinutes
    var id: String { rawValue }
    var title: String {
        switch self {
        case .heartRate: "Resting heart rate"
        case .hrv: "Heart rate variability"
        case .oxygen: "Blood oxygen"
        case .breathing: "Breathing rate"
        case .temperature: "Temperature deviation"
        case .steps: "Steps"
        case .activeMinutes: "Active minutes"
        }
    }
    var unit: String {
        switch self {
        case .heartRate: "bpm"
        case .hrv: "ms"
        case .oxygen: "%"
        case .breathing: "breaths/min"
        case .temperature: "°C"
        case .steps: "steps"
        case .activeMinutes: "min"
        }
    }
    var value: KeyPath<HealthDay, Double?> {
        switch self {
        case .heartRate: \.restingHeartRate
        case .hrv: \.hrv
        case .oxygen: \.spo2
        case .breathing: \.respiratoryRate
        case .temperature: \.skinTempDeviation
        case .steps: \.steps
        case .activeMinutes: \.activeMinutes
        }
    }
    var explanation: String {
        switch self {
        case .heartRate: "The resting heart rate stored by your source. It is separate from individual heart-rate samples."
        case .hrv: "The variability measurement provided by your source. Methods can differ between devices; compare like-for-like records."
        case .oxygen: "The blood-oxygen measurement stored by your source. No missing measurements are estimated."
        case .breathing: "The recorded number of breaths per minute. The source determines the measurement period."
        case .temperature: "A change from the source's temperature baseline, not an absolute body temperature."
        case .steps: "Recorded daily steps. Missing days are not treated as days with zero steps."
        case .activeMinutes: "Active minutes supplied by your source, not active-zone minutes or a calculated activity score."
        }
    }
}
