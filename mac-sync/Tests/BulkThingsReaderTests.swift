import Foundation
import Carbon
import SyncCore

// Standalone tests compile the actual reader against an inert writer stub.
// No test can mutate Things.
@MainActor final class PublicThings {
    init(appPath: String) {}
    func apply(_ payload: JSON) async throws -> JSON { throw SyncError.automation }
}

@main struct BulkReaderTests {
    @MainActor static func main() throws {
        func code(_ value: String) -> UInt32 { value.utf8.reduce(0) { ($0 << 8) | UInt32($1) } }
        func array(_ entries: [NSAppleEventDescriptor]) -> NSAppleEventDescriptor {
            let result = NSAppleEventDescriptor.list()
            for (index, entry) in entries.enumerated() { result.insert(entry, at: index + 1) }
            return result
        }
        func string(_ value: String) -> NSAppleEventDescriptor { NSAppleEventDescriptor(string: value) }
        func typed(_ record: NSAppleEventDescriptor, _ type: String) -> NSAppleEventDescriptor {
            var descriptor = AEDesc()
            precondition(AEDuplicateDesc(record.aeDesc, &descriptor) == noErr)
            descriptor.descriptorType = code(type)
            return NSAppleEventDescriptor(aeDescNoCopy: &descriptor)
        }
        func object(_ id: String, kind: String = "tslt", extra: [String: NSAppleEventDescriptor] = [:]) -> NSAppleEventDescriptor {
            let record = NSAppleEventDescriptor.record()
            for (key, value) in ["ID  ": string(id), "pnam": string(""), "note": string("")].merging(extra, uniquingKeysWith: { _, new in new }) {
                record.setDescriptor(value, forKeyword: code(key))
            }
            return typed(record, kind)
        }
        func reference(_ id: String) -> NSAppleEventDescriptor {
            let record = NSAppleEventDescriptor.record()
            record.setDescriptor(string(id), forKeyword: code("seld"))
            record.setDescriptor(NSAppleEventDescriptor(enumCode: code("ID  ")), forKeyword: code("form"))
            return typed(record, "obj ")
        }
        func fixture(objects: [NSAppleEventDescriptor], tagVectors: [NSAppleEventDescriptor]? = nil, duplicateList: Bool = false, omitList: Bool = false, child: NSAppleEventDescriptor? = nil) -> NSAppleEventDescriptor {
            let tags = tagVectors ?? objects.map { _ in array([]) }
            let area = object("area", kind: "tsaa")
            let groups = array([
                array([string("todo"), array(objects), array(tags)]),
                array([string("project"), array([]), array([])]),
                array([string("area"), array([area]), array([array([])])]),
                array([string("tag"), array([object("tag", kind: "tstg", extra:["ptag":reference("parent")])]), array([])])
            ])
            var lists = BulkThingsInventory.builtins.map { id in array([string(id), array(id == "TMInboxListSource" ? objects : []), array(id == "TMInboxListSource" ? tags : [])]) }
            if duplicateList { lists.append(lists[0]) }
            if omitList { lists.removeLast() }
            let children = child.map { [array([string("area"), string("area"), array([$0]), array([array([])])])] } ?? []
            return array([groups, array(lists), array(children)])
        }
        func require(_ condition: Bool, _ message: String) throws {
            guard condition else { throw NSError(domain: message, code: 1) }
        }
        func rejects(_ input: NSAppleEventDescriptor, _ message: String) throws {
            do { _ = try BulkThingsInventory.canonical(input) } catch { return }
            throw NSError(domain: message, code: 1)
        }
        if CommandLine.arguments.count == 4 {
            let start = Date()
            let result = try BulkThingsInventory.read(scriptURL: URL(fileURLWithPath: CommandLine.arguments[1]), appPath: CommandLine.arguments[2])
            try encoded(result).write(to: URL(fileURLWithPath: CommandLine.arguments[3]), options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: CommandLine.arguments[3])
            print("bulk_complete_seconds=\(Date().timeIntervalSince(start)) records=\((result["items"] as! [JSON]).count)")
            return
        }
        let missing = NSAppleEventDescriptor(typeCode: code("msng"))
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let todo = object("todo", extra: ["tsaa": reference("area"), "tspt":missing, "dued":NSAppleEventDescriptor(date:date), "cred":NSAppleEventDescriptor(date:date), "cmpd":missing, "tdst":NSAppleEventDescriptor(enumCode:code("tdio"))])
        let snapshot = try BulkThingsInventory.canonical(fixture(objects:[todo], tagVectors:[array([string("tag")])], child:object("child")))
        let rows = snapshot["items"] as! [JSON]
        let fields = rows.first { $0["id"] as? String == "todo" }!["fields"] as! JSON
        func cell(_ name: String) -> JSON { fields[name] as! JSON }
        try require(cell("title")["value"] as? String == "", "empty title must remain a value")
        try require(cell("notes")["value"] as? String == "", "empty notes must remain a value")
        try require(cell("status")["value"] as? String == "open", "status conversion")
        try require(cell("area_id")["value"] as? String == "area", "stable reference conversion")
        try require(cell("project_id")["state"] as? String == "absent", "missing reference")
        try require(cell("modification_date")["state"] as? String == "unknown", "unavailable property")
        try require(cell("creation_date")["value"] as? String == "2023-11-14T22:13:20.000Z", "instant date conversion")
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier:.gregorian)
        formatter.locale = Locale(identifier:"en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        try require(cell("deadline")["value"] as? String == formatter.string(from:date), "civil date conversion")
        try require(cell("completion_date")["state"] as? String == "absent", "missing date")
        try require(cell("checklist")["state"] as? String == "unsupported", "unsupported property")
        try require(cell("tags")["value"] as? [String] == ["tag"], "tag ordering")
        try require((cell("list_memberships")["value"] as? [JSON])?.first?["index"] as? Int == 0, "list ordering")
        let childFields = rows.first { $0["id"] as? String == "child" }!["fields"] as! JSON
        try require((childFields["collection_index"] as? JSON)?["value"] as? Int == 0, "child fallback index")
        let tagFields = rows.first { $0["id"] as? String == "tag" }!["fields"] as! JSON
        try require((tagFields["parent_tag_id"] as? JSON)?["value"] as? String == "parent", "parent tag reference")
        try rejects(fixture(objects:[todo,todo]), "duplicate record must fail")
        try rejects(fixture(objects:[todo], duplicateList:true), "duplicate list must fail")
        try rejects(fixture(objects:[todo], omitList:true), "missing builtin list must fail")
        try rejects(fixture(objects:[todo], tagVectors:[]), "incomplete tag coverage must fail")
        try rejects(fixture(objects:[object("bad",kind:"xxxx")]), "unknown class must fail")
        try rejects(fixture(objects:[todo], child:object("todo",kind:"tspt")), "stable ID class collision must fail")
        try rejects(fixture(objects:(0...10000).map { object("item\($0)") }), "record budget must fail")
        try rejects(fixture(objects:[object("oversize", extra:["note":string(String(repeating:"x",count:3 * 1024 * 1024))])]), "byte budget must fail")
        let denied = FileManager.default.temporaryDirectory.appendingPathComponent("bulk-denied-\(UUID().uuidString).applescript")
        defer { try? FileManager.default.removeItem(at:denied) }
        try Data("on run argv\nerror \"denied\" number -1743\nend run\n".utf8).write(to:denied)
        do {
            _ = try BulkThingsInventory.read(scriptURL:denied, appPath:"unused")
            throw NSError(domain:"automation denial must fail closed",code:1)
        } catch SyncError.automation {}
        print("PASS bulk reader synthetic cells, references, coverage, ordering, duplicates and budgets")
    }
}
