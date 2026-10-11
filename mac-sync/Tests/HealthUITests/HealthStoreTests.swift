import Foundation
import Testing
import SwiftUI
@testable import LifeOSSync

@MainActor @Test func previewAccessibilityOverridesAreOptIn() {
    var environment = EnvironmentValues()
    #expect(!environment.lifeOSPreviewReduceMotion)
    #expect(!environment.lifeOSPreviewReduceTransparency)
    #expect(environment.lifeOSReduceMotion == environment.accessibilityReduceMotion)
    #expect(environment.lifeOSReduceTransparency == environment.accessibilityReduceTransparency)
    environment.lifeOSPreviewReduceMotion = true
    environment.lifeOSPreviewReduceTransparency = true
    #expect(environment.lifeOSReduceMotion)
    #expect(environment.lifeOSReduceTransparency)
}

@MainActor @Test func previewTransitionsAndRetryNeverNeedCredentials() async {
    let store = ConvexHealthStore(preview: true)
    #expect(store.days.count == 14)
    await store.reload()
    #expect(store.connected)
    #expect(!store.loading)
    store.previewState = .empty
    await store.reload(clear: true)
    #expect(store.days.isEmpty)
    #expect(store.connected)
    store.previewState = .failure
    await store.reload(clear: true)
    #expect(!store.connected)
    #expect(store.status.contains("failed"))
    store.previewState = .offline
    await store.reload(clear: true)
    #expect(!store.connected)
    #expect(store.days.count == 14)
    store.previewState = .recorded
    await store.reload(clear: true)
    #expect(store.connected)
    #expect(store.days.allSatisfy { $0.source == "synthetic" })
    // Both operations must be no-ops in an isolated preview.
    store.disconnect()
    await store.importConfiguration(URL(fileURLWithPath: "/nonexistent-preview-config"))
    #expect(store.connected)
    #expect(store.days.count == 14)
}

@MainActor @Test func obsoletePreviewLoadCannotReplaceNewerState() async throws {
    let store = ConvexHealthStore(preview: true)
    store.previewState = .loading
    let obsolete = Task { await store.reload(clear: true) }
    try await Task.sleep(for: .milliseconds(30))
    #expect(store.loading)
    store.previewState = .empty
    await store.reload(clear: true)
    obsolete.cancel()
    await obsolete.value
    #expect(!store.loading)
    #expect(store.days.isEmpty)
    #expect(store.connected)
}

@MainActor @Test func previewLoadingCanBeInspectedThenFinishedWithoutATimer() async {
    let store = ConvexHealthStore(preview: true)
    store.previewState = .loading
    await store.reload(clear: true)
    #expect(store.loading)
    #expect(!store.connected)
    #expect(store.days.isEmpty)
    store.previewState = .recorded
    await store.reload(clear: true)
    #expect(!store.loading)
    #expect(store.connected)
    #expect(store.days.count == 14)
    #expect(store.days.allSatisfy { $0.source == "synthetic" })
}
