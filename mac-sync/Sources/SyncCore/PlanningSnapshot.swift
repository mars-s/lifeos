import Foundation

/// A read-only view of the committed Things replica. Unknown fields stay unknown.
public struct PlanningTask: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String?
    public let notes: String?
    public let status: String?
    public let activationDate: String?
    public let deadline: String?
    public let project: String?
    public let area: String?
    public let modified: String?
    public let inToday: Bool?
    public var isOpen: Bool { status == "open" }
}

public struct PlanningSnapshot: Equatable, Sendable {
    public let revision: Int
    public let tasks: [PlanningTask]
    public let synthetic: Bool

    public static func decode(items: [JSON], revision: Int) throws -> Self {
        guard items.count <= 10_000, revision >= 0 else { throw SyncError.invalid }
        var names: [String: String] = [:]
        for item in items {
            guard let id = item["id"] as? String, let fields = item["fields"] as? JSON else { throw SyncError.invalid }
            if item["deleted"] as? Int == 0, let title: String = value("title", in: fields) { names[id] = title }
        }
        var tasks: [PlanningTask] = []
        for item in items where item["kind"] as? String == "todo" && item["deleted"] as? Int == 0 {
            guard let id = item["id"] as? String, let fields = item["fields"] as? JSON else { throw SyncError.invalid }
            let trashed: Bool? = value("in_trash_list", in: fields)
            if trashed == true { continue }
            let membership: [JSON]? = value("list_memberships", in: fields)
            let projectID: String? = value("project_id", in: fields)
            let areaID: String? = value("area_id", in: fields)
            tasks.append(PlanningTask(
                id: id, title: value("title", in: fields), notes: value("notes", in: fields),
                status: value("status", in: fields), activationDate: value("activation_date", in: fields),
                deadline: value("deadline", in: fields), project: projectID.flatMap { names[$0] },
                area: areaID.flatMap { names[$0] }, modified: value("modification_date", in: fields),
                inToday: membership.map { $0.contains { $0["list_id"] as? String == "TMTodayListSource" } }
            ))
        }
        return Self(revision: revision, tasks: tasks.sorted(by: ordered), synthetic: false)
    }

    private static func value<T>(_ key: String, in fields: JSON) -> T? {
        guard let cell = fields[key] as? JSON, cell["state"] as? String == "value" else { return nil }
        return cell["value"] as? T
    }

    private static func ordered(_ left: PlanningTask, _ right: PlanningTask) -> Bool {
        let comparison = (left.title ?? "").localizedStandardCompare(right.title ?? "")
        return comparison == .orderedSame ? left.id < right.id : comparison == .orderedAscending
    }

    public static var preview: Self {
        Self(revision: 0, tasks: [
            PlanningTask(id: "preview-priorities", title: "Shape today's priorities",
                         notes: "Illustrative task. Pick one thing that would make today feel worthwhile.",
                         status: "open", activationDate: nil, deadline: nil, project: "LifeOS design study",
                         area: "Personal", modified: nil, inToday: true),
            PlanningTask(id: "preview-walk", title: "Make room for a quiet walk",
                         notes: "Illustrative task, not a calendar reservation or health recommendation.",
                         status: "open", activationDate: nil, deadline: nil, project: nil,
                         area: "Personal", modified: nil, inToday: false)
        ].sorted(by: ordered), synthetic: true)
    }
}
