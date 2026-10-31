import Foundation

// Today is the public list placement. Evening remains separately unsupported;
// the dictionary does not expose its evening subsection.
public func thingsWhen(activation: JSON, lists: Set<String>, today: String) -> JSON {
    if lists.contains("TMSomedayListSource") { return ["state": "value", "value": "someday"] }
    if lists.contains("TMTodayListSource") { return ["state": "value", "value": "today"] }
    if activation["state"] as? String == "value", let date = activation["value"] as? String {
        return ["state": "value", "value": date == today ? "today" : date]
    }
    if activation["state"] as? String == "absent" { return ["state": "value", "value": "anytime"] }
    return ["state": "unknown"]
}
