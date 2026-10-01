import Foundation
import Testing
@testable import SyncCore

@Test func compiledThingsDictionaryCodesAndRepeatedLists() throws {
    let rows = [["task", "«class tslt»"], ["task", "«class tstk»"], ["project", "«class tspt»"],
                ["project", "project"], ["other", "to do"]]
    let data = try JSONSerialization.data(withJSONObject: rows)
    #expect(try thingsClassifications(data) == ["task": "todo", "project": "project", "other": "todo"])
}

@Test func invalidThingsClassesAndConflictingKindsAreRejected() throws {
    for rows in [[["task", "«class unknown»"]], [["task", "to do"], ["task", "project"]]] {
        let data = try JSONSerialization.data(withJSONObject: rows)
        #expect(throws: SyncError.self) { try thingsClassifications(data) }
    }
}
