import Foundation

public enum NativeEventProtocol {
    public static func acknowledgement(revision: Int) throws -> URLSessionWebSocketTask.Message {
        guard revision >= 0 else { throw SyncError.invalid }
        // OwnerSync accepts JSON text frames. Binary JSON is a different wire message.
        let data = try encoded(["version": 1, "ack": revision])
        return .string(String(decoding: data, as: UTF8.self))
    }
}
