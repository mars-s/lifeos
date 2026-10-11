import Foundation
import Testing
@testable import LifeOSSync

@MainActor @Test func googleOAuthLoadsPrivateFileAndRejectsSharedPermissions() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let file = folder.appendingPathComponent("credentials.json")
    let fixture = #"{"installed":{"client_id":"example.apps.googleusercontent.com","client_secret":"synthetic-test-secret","project_id":"example"}}"#
    try Data(fixture.utf8).write(to: file)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    let loaded = try GoogleOAuthConfiguration.load(from: file)
    #expect(loaded.clientID == "example.apps.googleusercontent.com")
    #expect(loaded.projectID == "example")
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
    #expect(throws: GoogleOAuthConfiguration.ConfigurationError.self) {
        try GoogleOAuthConfiguration.load(from: file)
    }
}
