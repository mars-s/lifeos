import Foundation

struct GoogleOAuthConfiguration: Decodable {
    let clientID: String
    let clientSecret: String
    let projectID: String

    private enum CodingKeys: String, CodingKey {
        case clientID = "client_id"
        case clientSecret = "client_secret"
        case projectID = "project_id"
    }

    private struct Download: Decodable {
        let installed: GoogleOAuthConfiguration
    }

    enum ConfigurationError: Error {
        case invalidCredentials, insecurePermissions
    }

    static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/LifeOS/credentials/google-health-desktop.json")
    }

    static func load(from url: URL = defaultURL) throws -> Self {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let permissions = attributes[.posixPermissions] as? NSNumber,
              permissions.intValue & 0o077 == 0 else {
            throw ConfigurationError.insecurePermissions
        }
        let configuration = try JSONDecoder().decode(Download.self, from: Data(contentsOf: url)).installed
        guard configuration.clientID.hasSuffix(".apps.googleusercontent.com"),
              !configuration.clientSecret.isEmpty, !configuration.projectID.isEmpty else {
            throw ConfigurationError.invalidCredentials
        }
        return configuration
    }
}
