import Foundation

public enum NativeEventProtocol {
    public static func acknowledgement(revision: Int, version: Int = 1) throws -> URLSessionWebSocketTask.Message {
        guard revision >= 0, [1, 3].contains(version) else { throw SyncError.invalid }
        // OwnerSync accepts JSON text frames. Binary JSON is a different wire message.
        let data = try encoded(["version": version, "ack": revision])
        return .string(String(decoding: data, as: UTF8.self))
    }
}
