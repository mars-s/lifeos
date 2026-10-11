import SwiftUI
import SyncCore

private enum TaskScope: String, CaseIterable {
    case today = "Today", open = "Open", all = "All stored"
}

private struct TaskInspection: Identifiable {
    let task: PlanningTask
    let revision: Int
    let synthetic: Bool
    var id: String { task.id }
}

struct PlanningNextTasks: View {
    let snapshot: PlanningSnapshot?
    let error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(snapshot?.synthetic == true ? "Illustrative Today list" : "Things Today list")
                .font(.system(size: 17, weight: .medium))
            if let error { Text(error).foregroundStyle(desktopMuted) }
            if let snapshot {
                let today = snapshot.tasks.filter { $0.inToday == true && $0.isOpen }
                if today.isEmpty {
                    Text("No open tasks recorded in the Today list.").foregroundStyle(desktopMuted)
                }
                ForEach(today.prefix(3)) { task in
                    Label(task.title ?? "Title unavailable", systemImage: "circle")
                        .font(.system(size: 14)).fixedSize(horizontal: false, vertical: true)
                }
                Text(snapshot.synthetic ? "Demo tasks only. Nothing saved to Things." : "Read-only stored copy. Task order is alphabetical.")
                    .font(.system(size: 11)).foregroundStyle(desktopMuted)
                if snapshot.tasks.contains(where: { $0.status == nil || $0.inToday == nil }) {
                    Text("Some tasks have unknown status or Today membership. View all stored tasks to inspect them.")
                        .font(.system(size: 11)).foregroundStyle(desktopMuted)
                }
            } else {
                Text("Waiting for the sync owner's stored tasks. Your Things list has not been read by this window.")
                    .font(.system(size: 14)).foregroundStyle(desktopMuted)
            }
        }
    }
}

/// Uses the same committed task projection in the live shell and isolated preview.
struct DesktopPlanningView: View {
    let snapshot: PlanningSnapshot?
    let error: String?
    let lastSync: Date?
    @State private var scope = TaskScope.today
    @State private var search = ""
    @State private var inspected: TaskInspection?

    private var tasks: [PlanningTask] {
        (snapshot?.tasks ?? []).filter { task in
            let included = switch scope {
            case .today: task.inToday == true && task.isOpen
            case .open: task.isOpen
            case .all: true
            }
            return included && (search.isEmpty || [task.title, task.notes, task.project, task.area]
                .compactMap { $0 }.contains { $0.localizedStandardContains(search) })
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label(snapshot?.synthetic == true ? "Illustrative tasks · No Things connection" : "Stored Things tasks · Read-only",
                  systemImage: "tray.full")
                .font(.system(size: 12)).foregroundStyle(desktopAccent)
                .padding(10).modifier(DesktopReadingSurface(radius: 10))
            Text("Choose what deserves your attention.")
                .font(.system(size: 29, design: .serif))
            if let error { Text(error).foregroundStyle(.orange) }
            if let snapshot {
                Text(snapshot.synthetic ? "Demo tasks, not your real list." : "Replica revision \(snapshot.revision). Changes arrive through the existing sync owner.")
                    .font(.system(size: 12)).foregroundStyle(desktopMuted)
                if !snapshot.synthetic {
                    Text(lastSync.map { "Sync owner's last confirmed sync: \($0.formatted())" } ?? "No confirmed sync time available.")
                        .font(.system(size: 12)).foregroundStyle(desktopMuted)
                }
                Picker("Task scope", selection: $scope) {
                    ForEach(TaskScope.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.segmented).labelsHidden()
                    .accessibilityLabel("Task scope")
                    .keyboardChoice(TaskScope.allCases, selection: $scope)
                TextField("Search tasks, notes, projects or areas", text: $search)
                    .textFieldStyle(.roundedBorder).accessibilityLabel("Search stored tasks")
                Text("\(tasks.count) matching \(tasks.count == 1 ? "task" : "tasks")")
                    .font(.system(size: 12)).foregroundStyle(desktopMuted)
                if tasks.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(search.isEmpty ? "Nothing in this view." : "No matching tasks.")
                            .font(.system(size: 18, weight: .medium))
                        Text("Try All stored, or clear the search. Unknown status and Today membership are shown in All stored, not guessed.")
                            .foregroundStyle(desktopMuted)
                        KeyboardActionButton("Show all stored tasks") { search = ""; scope = .all }
                            .foregroundStyle(desktopAccent)
                    }.padding(20).modifier(DesktopReadingSurface(radius: 16))
                }
                LazyVStack(spacing: 10) {
                    ForEach(tasks) { task in
                        KeyboardActionButton {
                            inspected = TaskInspection(task: task, revision: snapshot.revision, synthetic: snapshot.synthetic)
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: task.status == "completed" ? "checkmark.circle" : "circle")
                                    .foregroundStyle(desktopAccent).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(task.title ?? "Title unavailable").font(.system(size: 16, weight: .medium))
                                    Text([task.project, task.area].compactMap { $0 }.joined(separator: " · "))
                                        .font(.system(size: 12)).foregroundStyle(desktopMuted)
                                    Text(task.status.map { "Status: \($0)" } ?? "Status unavailable")
                                        .font(.system(size: 11)).foregroundStyle(desktopMuted)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.right").accessibilityHidden(true)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                                .padding(18).modifier(DesktopReadingSurface(radius: 14))
                        }.accessibilityLabel("Inspect \(task.title ?? "task with unavailable title")")
                    }
                }
                Text("Task dates are not calendar events. This view does not reschedule, complete or change tasks.")
                    .font(.system(size: 12)).foregroundStyle(desktopMuted)
            } else {
                Text("Stored task data is not available yet. The existing sync owner supplies it after a complete replica sync.")
                    .foregroundStyle(desktopMuted)
                Text("Continue using Things for now. This window does not trigger inventory reads or start another sync process.")
                    .font(.system(size: 12)).foregroundStyle(desktopMuted)
            }
        }.sheet(item: $inspected) { inspection in
            let task = inspection.task
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Task details").font(.system(size: 19, design: .serif))
                    Spacer()
                    KeyboardActionButton("Done") { inspected = nil }.keyboardShortcut(.cancelAction)
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(task.title ?? "Title unavailable").font(.system(size: 24, design: .serif))
                        Text(task.notes ?? "Notes unavailable.").textSelection(.enabled)
                        detail("Status", task.status)
                        detail("Project", task.project)
                        detail("Area", task.area)
                        detail("Activation date", task.activationDate)
                        detail("Deadline", task.deadline)
                        detail("Last task update", task.modified)
                        detail("Today membership", task.inToday.map { $0 ? "In Things Today" : "Not in Things Today" })
                        Text(inspection.synthetic ? "Source: illustrative preview. Not saved to Things." : "Source: committed Things replica, revision \(inspection.revision).")
                            .font(.system(size: 12)).foregroundStyle(desktopAccent)
                        Text("Unavailable fields have not been supplied by the stored copy. Dates do not include a calendar time or duration.")
                            .font(.system(size: 12)).foregroundStyle(desktopMuted)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding(24).frame(width: 470, height: 480)
                .preferredColorScheme(.dark)
                .closeSheetShortcut()
        }
    }

    private func detail(_ label: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 11)).foregroundStyle(desktopMuted)
            Text(value ?? "Unavailable in stored copy").font(.system(size: 14)).textSelection(.enabled)
        }
    }
}
