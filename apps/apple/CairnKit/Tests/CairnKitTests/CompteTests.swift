import XCTest
@testable import CairnKit

final class CompteTests: XCTestCase {
    func testChallengeIsTheSameSHA256AsTheServer() {
        // node -e 'crypto.createHash("sha256").update("v".repeat(43)).digest("base64url")'
        XCTAssertEqual(CompteSignIn(verifier: String(repeating: "v", count: 43)).challenge, "7w_YNF9DSfIdPf_pRjSq646_kPr-2-o9NAl16JGghdM")
    }

    func testFreshVerifierIsRandomAndFitsTheServerCheck() {
        let a = CompteSignIn(), b = CompteSignIn()
        XCTAssertNotEqual(a.verifier, b.verifier)
        XCTAssertEqual(a.challenge.count, 43)
        XCTAssertNil(a.challenge.range(of: "[^A-Za-z0-9_-]", options: .regularExpression))
    }

    func testReadsTheWayBack() {
        XCTAssertEqual(CompteSignIn.read(URL(string: "cairn://compte?code=abc")!), .handoff("abc"))
        XCTAssertEqual(CompteSignIn.read(URL(string: "cairn://compte?erreur=acces")!), .refused(CompteSignIn.message("acces")))
        XCTAssertEqual(CompteSignIn.read(URL(string: "https://compte?code=abc")!), .refused(CompteSignIn.message("refus")))
    }

    func testStartAddressCarriesTheChallenge() {
        let client = CairnClient(baseURL: URL(string: "https://cairn.exemple.ch")!)
        let url = client.compteStartURL(challenge: "abc")
        XCTAssertEqual(url?.absoluteString, "https://cairn.exemple.ch/api/auth/compte/start?app=abc")
    }
}
