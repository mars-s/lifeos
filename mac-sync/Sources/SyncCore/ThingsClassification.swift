import Foundation

public func thingsClassifications(_ data: Data) throws -> [String: String] {
    guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String]], rows.count <= 50000 else { throw SyncError.automation }
    // Compiled AppleScript can print raw dictionary codes instead of term names.
    let kinds = ["to do": "todo", "selected to do": "todo", "project": "project",
                 "«class tstk»": "todo", "«class tslt»": "todo", "«class tspt»": "project"]
    var result: [String: String] = [:]
    for row in rows {
        guard row.count == 2, let kind = kinds[row[1]], !row[0].isEmpty,
              result[row[0]] == nil || result[row[0]] == kind else { throw SyncError.automation }
        result[row[0]] = kind
    }
    return result
}
