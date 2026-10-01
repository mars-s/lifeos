import Foundation
import Testing
@testable import SyncCore

@Test func deliveryAcknowledgementUsesServerAcceptedTextFrame() throws {
    let message = try NativeEventProtocol.acknowledgement(revision: 123)
    switch message {
    case .string(let text):
        // Model the server boundary: only text is parsed as a delivery acknowledgment.
        let body = try decoded(Data(text.utf8))
        #expect(body.count == 2)
        #expect(body["version"] as? Int == 1)
        #expect(body["ack"] as? Int == 123)
    case .data:
        Issue.record("Binary acknowledgment frames are ignored by OwnerSync")
    @unknown default:
        Issue.record("Unknown acknowledgment frame type")
    }
}

@Test func initialRevisionAcknowledgementIsValidAndNegativeRevisionIsRejected() throws {
    guard case .string(let text) = try NativeEventProtocol.acknowledgement(revision: 0) else {
        Issue.record("Initial acknowledgment must also use text"); return
    }
    #expect(try decoded(Data(text.utf8))["ack"] as? Int == 0)
    #expect(throws: SyncError.self) { try NativeEventProtocol.acknowledgement(revision: -1) }
}
