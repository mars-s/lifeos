import EventKit
import Foundation

private let markerStart = "[[LIFEOS_WORK_BLOCK]]"
private let markerEnd = "[[/LIFEOS_WORK_BLOCK]]"
private let eventMarkerStart = "[[LIFEOS_EVENT]]"
private let eventMarkerEnd = "[[/LIFEOS_EVENT]]"

private struct GatewayError: Error {
    let code: String
    let message: String
}

private func errorResponse(_ error: Error) -> [String: Any] {
    let gatewayError = error as? GatewayError
    return [
        "ok": false,
        "error": [
            "code": gatewayError?.code ?? "internal_error",
            "message": gatewayError?.message ?? String(describing: error)
        ]
    ]
}

private func writeJSON(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

private func requiredString(_ object: [String: Any], _ key: String) throws -> String {
    guard let value = object[key] as? String, !value.isEmpty else {
        throw GatewayError(code: "invalid_request", message: "Missing non-empty string: \(key)")
    }
    return value
}

private func optionalString(_ object: [String: Any], _ key: String) throws -> String? {
    guard let value = object[key] else { return nil }
    guard let string = value as? String else {
        throw GatewayError(code: "invalid_request", message: "Expected string: \(key)")
    }
    return string
}

private let iso8601: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private func parseDate(_ value: String, name: String) throws -> Date {
    if let date = iso8601.date(from: value) { return date }
    let fallback = ISO8601DateFormatter()
    fallback.formatOptions = [.withInternetDateTime]
    if let date = fallback.date(from: value) { return date }
    throw GatewayError(code: "invalid_request", message: "Invalid ISO8601 date for \(name)")
}

private func formatDate(_ date: Date) -> String {
    iso8601.string(from: date)
}

private func authorizationName(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .fullAccess: return "full_access"
    case .writeOnly: return "write_only"
    @unknown default: return "unknown"
    }
}

private func requireReadAccess(_ store: EKEventStore) throws {
    let status = EKEventStore.authorizationStatus(for: .event)
    let allowed: Bool
    if #available(macOS 14.0, *) {
        allowed = status == .fullAccess
    } else {
        allowed = status == .authorized
    }
    guard allowed else {
        throw GatewayError(code: "calendar_read_access_required", message: "Full EventKit calendar access is required")
    }
}

private func requireWriteAccess(_ store: EKEventStore) throws {
    let status = EKEventStore.authorizationStatus(for: .event)
    let allowed: Bool
    if #available(macOS 14.0, *) {
        allowed = status == .fullAccess || status == .writeOnly
    } else {
        allowed = status == .authorized
    }
    guard allowed else {
        throw GatewayError(code: "calendar_write_access_required", message: "EventKit calendar write access is required")
    }
}

private func plannerURL(linkID: String) -> URL? {
    var components = URLComponents()
    components.scheme = "lifeos"
    components.host = "planned-work-block"
    components.path = "/\(linkID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? linkID)"
    return components.url
}

private func managedBlock(linkID: String, thingsID: String, extraNotes: String?) -> String {
    let thingsLink = "things:///show?id=\(thingsID.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? thingsID)"
    var lines = [markerStart, "link_id: \(linkID)", "things_id: \(thingsID)", "things_url: \(thingsLink)"]
    if let extraNotes, !extraNotes.isEmpty {
        lines.append("context: \(extraNotes)")
    }
    lines.append(markerEnd)
    return lines.joined(separator: "\n")
}

private func managedEvent(linkID: String, extraNotes: String?) -> String {
    var lines = [eventMarkerStart, "link_id: \(linkID)"]
    if let extraNotes, !extraNotes.isEmpty {
        lines.append("context: \(extraNotes)")
    }
    lines.append(eventMarkerEnd)
    return lines.joined(separator: "\n")
}

private func replaceManagedBlock(in notes: String?, with replacement: String) -> String {
    let existing = notes ?? ""
    guard let start = existing.range(of: markerStart), let end = existing.range(of: markerEnd, range: start.upperBound..<existing.endIndex) else {
        return existing.isEmpty ? replacement : "\(existing)\n\n\(replacement)"
    }
    let endAfter = end.upperBound
    let before = String(existing[..<start.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
    let after = String(existing[endAfter...]).trimmingCharacters(in: .whitespacesAndNewlines)
    return [before, replacement, after].filter { !$0.isEmpty }.joined(separator: "\n\n")
}

private func isPlannerOwned(_ event: EKEvent) -> Bool {
    guard let notes = event.notes else { return false }
    return (notes.contains(markerStart) && notes.contains(markerEnd))
        || (notes.contains(eventMarkerStart) && notes.contains(eventMarkerEnd))
}

private func hasManagedValue(_ event: EKEvent, key: String, value: String) -> Bool {
    guard isPlannerOwned(event), let notes = event.notes else { return false }
    return notes.components(separatedBy: .newlines).contains("\(key): \(value)")
}

private func calendarDictionary(_ calendar: EKCalendar) -> [String: Any] {
    [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "source_id": calendar.source.sourceIdentifier,
        "source_title": calendar.source.title,
        "allows_modifications": calendar.allowsContentModifications,
        "read_only": !calendar.allowsContentModifications,
        "type": calendar.type.rawValue
    ]
}

private func eventDictionary(_ event: EKEvent) -> [String: Any] {
    [
        "event_identifier": event.eventIdentifier ?? "",
        "calendar_item_identifier": event.calendarItemIdentifier,
        "calendar_id": event.calendar.calendarIdentifier,
        "calendar_source_id": event.calendar.source.sourceIdentifier,
        "title": event.title ?? "",
        "start": formatDate(event.startDate),
        "end": formatDate(event.endDate),
        "all_day": event.isAllDay,
        "notes": event.notes ?? "",
        "location": event.location ?? "",
        "url": event.url?.absoluteString ?? "",
        "planner_owned": isPlannerOwned(event)
    ]
}

private func writableCalendar(_ store: EKEventStore, id: String) throws -> EKCalendar {
    guard let calendar = store.calendar(withIdentifier: id) else {
        throw GatewayError(code: "calendar_not_found", message: "Calendar not found")
    }
    guard calendar.allowsContentModifications else {
        throw GatewayError(code: "calendar_read_only", message: "Cannot write to a read-only or subscribed calendar")
    }
    return calendar
}

private func knownPlannerEvent(_ store: EKEventStore, identifier: String) throws -> EKEvent {
    guard let event = store.event(withIdentifier: identifier) else {
        throw GatewayError(code: "event_not_found", message: "Event occurrence not found")
    }
    guard isPlannerOwned(event) else {
        throw GatewayError(code: "event_not_planner_owned", message: "LifeOS will only change planner-owned work blocks")
    }
    guard event.calendar.allowsContentModifications else {
        throw GatewayError(code: "calendar_read_only", message: "Cannot modify an event in a read-only calendar")
    }
    return event
}

private func handle(_ request: [String: Any], store: EKEventStore) throws -> [String: Any] {
    let operation = try requiredString(request, "operation")

    switch operation {
    case "authorization_status":
        return ["status": authorizationName(EKEventStore.authorizationStatus(for: .event))]

    case "request_authorization":
        var granted = false
        var requestError: Error?
        let semaphore = DispatchSemaphore(value: 0)
        if #available(macOS 14.0, *) {
            store.requestFullAccessToEvents { success, error in
                granted = success
                requestError = error
                semaphore.signal()
            }
        } else {
            store.requestAccess(to: .event) { success, error in
                granted = success
                requestError = error
                semaphore.signal()
            }
        }
        semaphore.wait()
        if let requestError {
            throw GatewayError(code: "authorization_failed", message: requestError.localizedDescription)
        }
        return ["granted": granted, "status": authorizationName(EKEventStore.authorizationStatus(for: .event))]

    case "list_calendars":
        try requireReadAccess(store)
        return ["calendars": store.calendars(for: .event).map(calendarDictionary)]

    case "create_planner_calendar":
        try requireWriteAccess(store)
        let title = try requiredString(request, "title")
        let existing = store.calendars(for: .event).filter { $0.title == title }
        if existing.count > 1 {
            throw GatewayError(code: "duplicate_calendar_title", message: "Multiple calendars already use this title")
        }
        if let calendar = existing.first {
            guard calendar.allowsContentModifications else {
                throw GatewayError(code: "calendar_read_only", message: "The existing planner calendar is read-only")
            }
            return ["calendar": calendarDictionary(calendar)]
        }
        let source: EKSource
        if let requestedSourceID = try optionalString(request, "source_id") {
            guard let requestedSource = store.sources.first(where: { $0.sourceIdentifier == requestedSourceID }) else {
                throw GatewayError(code: "source_not_found", message: "Calendar source not found")
            }
            source = requestedSource
        } else if let defaultSource = store.defaultCalendarForNewEvents?.source {
            source = defaultSource
        } else {
            throw GatewayError(code: "calendar_source_unavailable", message: "No default Calendar source is available")
        }
        let calendar = EKCalendar(for: .event, eventStore: store)
        calendar.title = title
        calendar.source = source
        try store.saveCalendar(calendar, commit: true)
        return ["calendar": calendarDictionary(calendar)]

    case "list_event_occurrences":
        try requireReadAccess(store)
        let start = try parseDate(try requiredString(request, "start"), name: "start")
        let end = try parseDate(try requiredString(request, "end"), name: "end")
        guard start < end else {
            throw GatewayError(code: "invalid_request", message: "start must precede end")
        }
        let requestedIDs = request["calendar_ids"] as? [String]
        let calendars: [EKCalendar]
        if let requestedIDs {
            calendars = try requestedIDs.map { id in
                guard let calendar = store.calendar(withIdentifier: id) else {
                    throw GatewayError(code: "calendar_not_found", message: "Calendar not found: \(id)")
                }
                return calendar
            }
        } else {
            calendars = store.calendars(for: .event)
        }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }
        return ["events": events.map(eventDictionary)]

    case "create_linked_work_block":
        try requireWriteAccess(store)
        let calendar = try writableCalendar(store, id: try requiredString(request, "calendar_id"))
        let linkID = try requiredString(request, "link_id")
        let thingsID = try requiredString(request, "things_id")
        let start = try parseDate(try requiredString(request, "start"), name: "start")
        let end = try parseDate(try requiredString(request, "end"), name: "end")
        guard start < end else { throw GatewayError(code: "invalid_request", message: "start must precede end") }
        let existingPredicate = store.predicateForEvents(withStart: start, end: end, calendars: [calendar])
        let existing = store.events(matching: existingPredicate).filter {
            hasManagedValue($0, key: "link_id", value: linkID)
        }
        if existing.count > 1 {
            throw GatewayError(code: "duplicate_link_id", message: "Multiple work blocks use this LifeOS link ID")
        }
        if let event = existing.first {
            guard hasManagedValue(event, key: "things_id", value: thingsID) else {
                throw GatewayError(code: "link_id_conflict", message: "LifeOS link ID belongs to another Things item")
            }
            return ["event": eventDictionary(event)]
        }
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = try requiredString(request, "title")
        event.startDate = start
        event.endDate = end
        event.notes = managedBlock(linkID: linkID, thingsID: thingsID, extraNotes: try optionalString(request, "notes"))
        event.location = try optionalString(request, "location")
        event.url = plannerURL(linkID: linkID)
        try store.save(event, span: .thisEvent, commit: true)
        return ["event": eventDictionary(event)]

    case "create_calendar_event":
        try requireWriteAccess(store)
        let calendar = try writableCalendar(store, id: try requiredString(request, "calendar_id"))
        let linkID = try requiredString(request, "link_id")
        let start = try parseDate(try requiredString(request, "start"), name: "start")
        let end = try parseDate(try requiredString(request, "end"), name: "end")
        guard start < end else { throw GatewayError(code: "invalid_request", message: "start must precede end") }
        let existingPredicate = store.predicateForEvents(withStart: start, end: end, calendars: [calendar])
        let existing = store.events(matching: existingPredicate).filter {
            hasManagedValue($0, key: "link_id", value: linkID)
        }
        if existing.count > 1 {
            throw GatewayError(code: "duplicate_link_id", message: "Multiple events use this LifeOS link ID")
        }
        if let event = existing.first {
            if event.url != nil {
                event.url = nil
                try store.save(event, span: .thisEvent, commit: true)
            }
            return ["event": eventDictionary(event)]
        }
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = try requiredString(request, "title")
        event.startDate = start
        event.endDate = end
        event.notes = managedEvent(linkID: linkID, extraNotes: try optionalString(request, "notes"))
        event.location = try optionalString(request, "location")
        event.url = nil
        try store.save(event, span: .thisEvent, commit: true)
        return ["event": eventDictionary(event)]

    case "update_linked_work_block":
        try requireWriteAccess(store)
        let event = try knownPlannerEvent(store, identifier: try requiredString(request, "event_identifier"))
        if let title = try optionalString(request, "title") { event.title = title }
        if let start = try optionalString(request, "start") { event.startDate = try parseDate(start, name: "start") }
        if let end = try optionalString(request, "end") { event.endDate = try parseDate(end, name: "end") }
        if let location = try optionalString(request, "location") { event.location = location }
        guard event.startDate < event.endDate else { throw GatewayError(code: "invalid_request", message: "start must precede end") }
        let linkID = try requiredString(request, "link_id")
        let thingsID = try requiredString(request, "things_id")
        event.notes = replaceManagedBlock(in: event.notes, with: managedBlock(linkID: linkID, thingsID: thingsID, extraNotes: try optionalString(request, "notes")))
        event.url = plannerURL(linkID: linkID)
        try store.save(event, span: .thisEvent, commit: true)
        return ["event": eventDictionary(event)]

    case "delete_linked_work_block":
        try requireWriteAccess(store)
        let event = try knownPlannerEvent(store, identifier: try requiredString(request, "event_identifier"))
        let deletedIdentifier = event.eventIdentifier ?? ""
        try store.remove(event, span: .thisEvent, commit: true)
        return ["deleted_event_identifier": deletedIdentifier]

    default:
        throw GatewayError(code: "unsupported_operation", message: "Unsupported operation: \(operation)")
    }
}

do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard !input.isEmpty,
          let value = try JSONSerialization.jsonObject(with: input) as? [String: Any] else {
        throw GatewayError(code: "invalid_request", message: "Expected one JSON object on standard input")
    }
    let result = try handle(value, store: EKEventStore())
    writeJSON(["ok": true, "result": result])
} catch {
    writeJSON(errorResponse(error))
}
