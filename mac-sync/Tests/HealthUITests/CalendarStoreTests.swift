import Foundation
import Testing
@testable import LifeOSSync

private enum CalendarFixtureFailure: Error { case unavailable }

@Test @MainActor func calendarPreviewNeverCallsRealReaderAndKeepsStatesDistinct() async {
    let store = DesktopCalendarStore(preview: true, readDay: { _ in
        Issue.record("Preview must not invoke the calendar reader")
        return .accessUnavailable
    })
    await store.reload()
    #expect(store.state == .ready && store.events.count == 1)
    #expect(store.events.first?.calendar == "Illustrative calendar")
    #expect(store.lastRead != nil)
    store.scenario = .empty
    await store.reload()
    #expect(store.state == .ready && store.events.isEmpty)
    store.scenario = .disconnected
    await store.reload()
    #expect(store.state == .disconnected && store.lastRead == nil)
    store.scenario = .failed
    await store.reload()
    #expect(store.state == .failed && store.events.isEmpty && store.lastRead == nil)
    store.scenario = .loading
    await store.reload()
    #expect(store.state == .loading && store.events.isEmpty)
    store.scenario = .recorded
    await store.reload()
    #expect(store.state == .ready && store.events.count == 1)
}

@Test @MainActor func calendarAccessUnavailableIsNotAnEmptyDay() async {
    let store = DesktopCalendarStore(preview: false, readDay: { _ in .accessUnavailable })
    await store.reload()
    #expect(store.state == .disconnected && store.events.isEmpty && store.lastRead == nil)
}

@Test @MainActor func calendarReadFailureNeverClaimsSuccessfulRead() async {
    let store = DesktopCalendarStore(preview: false, readDay: { _ in throw CalendarFixtureFailure.unavailable })
    await store.reload()
    #expect(store.state == .failed && store.events.isEmpty && store.lastRead == nil)
}

@Test @MainActor func calendarPreviewDaySteppingUsesCalendarDays() async throws {
    let store = DesktopCalendarStore(preview: true)
    let first = store.day
    store.stepDay(1)
    #expect(Calendar.current.dateComponents([.day], from: first, to: store.day).day == 1)
    await store.reload()
    let event = try #require(store.events.first)
    #expect(Calendar.current.isDate(event.start, inSameDayAs: store.day))
    store.stepDay(-1)
    #expect(store.day == first)
}

private actor CalendarReadGate {
    private var requests: [CheckedContinuation<CalendarDayRead, Never>?] = []
    private var waiters: [(Int, CheckedContinuation<Void, Never>)] = []
    func read(_ day: Date) async -> CalendarDayRead {
        await withCheckedContinuation { continuation in
            requests.append(continuation)
            for (count, waiter) in waiters where requests.count >= count { waiter.resume() }
            waiters.removeAll { requests.count >= $0.0 }
        }
    }
    func waitForCount(_ count: Int) async {
        if requests.count >= count { return }
        await withCheckedContinuation { waiters.append((count, $0)) }
    }
    func finish(_ index: Int, result: CalendarDayRead) {
        let continuation = requests[index]
        requests[index] = nil
        continuation?.resume(returning: result)
    }
}

@Test @MainActor func olderCalendarReadCannotOverwriteNewerDay() async {
    let gate = CalendarReadGate()
    let store = DesktopCalendarStore(preview: false, readDay: { await gate.read($0) })
    let older = Task { await store.reload() }
    await gate.waitForCount(1)
    store.stepDay(1)
    let newer = Task { await store.reload() }
    await gate.waitForCount(2)
    await gate.finish(1, result: .available([]))
    await newer.value
    #expect(store.state == .ready && store.lastRead != nil)
    await gate.finish(0, result: .accessUnavailable)
    await older.value
    #expect(store.state == .ready && store.events.isEmpty && store.lastRead != nil)
}
