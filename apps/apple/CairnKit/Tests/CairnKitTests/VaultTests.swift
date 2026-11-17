import XCTest
@testable import CairnKit

/// Made by the web app's own code (src/lib/crypto.ts, hash-wasm + WebCrypto) with the password
/// "Caillou-montagne-42 é": the app must open exactly what the browser wrote.
enum WebVault {
    static let password = "Caillou-montagne-42 é"
    static let meta = #"{"v": 1, "kdf": {"name": "argon2id", "salt": "stJ0S7J/n0K2GNcrGHlG3g==", "memoryKiB": 65536, "iterations": 3, "parallelism": 1}, "wrappedKey": "v1.5KGlFQzIaHzbuobU.1pZqcfWCX44yvMiPN1UKxVqThO/eE3ktK/lB5+PnB1D3BXU6KighMP1L74L/rX9I"}"#
    static let item = "v1.9NQlDSgMCdbvJbeQ.u3T0Vd49BipAs+O2coBnTRvSKQ5xLgav1jGDz+tHxQOwy56+V4Ajlffo1AhgcBDNZaR8UPZSLzhcESNFsp8ix5glrbrfIVPKnj5rQrPHSTd3zpOQUTXAw3fBBQsVhtzkrt5E6iVznf7fh6psD8svWfdgIc3oeuXR3E7abapdTA=="
    static let lockedNote = "v1.c0PfYAKvINeHff/U.Rjv7REg28afcU4iYV1h5YeD2rrMqr8v3eDZMZ5ThUYMyE05m3HKoIxw3mA=="
}

final class VaultTests: XCTestCase {
    func meta() throws -> VaultMeta { try JSONDecoder().decode(VaultMeta.self, from: Data(WebVault.meta.utf8)) }

    func testOpensWhatTheBrowserWrote() throws {
        let key = try VaultKey.unlock(password: WebVault.password, meta: try meta())
        let item = try key.decrypt(VaultItemRow(id: "i1", data: WebVault.item, updatedAt: ""))
        XCTAssertEqual(item.data.type, .login)
        XCTAssertEqual(item.data.username, "antoine")
        XCTAssertEqual(item.data.password, "s3cr3t!")
        XCTAssertEqual(item.data.domain, "cairn.antoinequarroz.ch")
        XCTAssertEqual(try key.decrypt(WebVault.lockedNote), "# Clé\nssh antoine-vps 🔑")
    }

    func testSamePasswordWrittenDifferently() throws {
        // "é" as e + combining accent: NFKC makes it the same password, as in the browser.
        XCTAssertNoThrow(try VaultKey.unlock(password: "Caillou-montagne-42 e\u{301}", meta: try meta()))
    }

    func testWrongPassword() throws {
        XCTAssertThrowsError(try VaultKey.unlock(password: "caillou", meta: try meta())) {
            XCTAssertEqual($0 as? VaultError, .wrongPassword)
        }
    }

    func testRoundTripKeepsUnknownFields() throws {
        let key = try VaultKey(rawValue: Data(repeating: 7, count: 32))
        let json = #"{"type":"login","name":"GitHub","username":"aq","totp":"JBSWY3DP","tags":["dev"]}"#
        let blob = try key.encrypt(json)
        var item = try key.decrypt(VaultItemRow(id: "x", data: blob, updatedAt: ""))
        item.data.password = "neuf"
        let again = try key.decrypt(VaultItemRow(id: "x", data: try key.encrypt(item.data), updatedAt: ""))
        XCTAssertEqual(again.data.password, "neuf")
        let raw = try JSONSerialization.jsonObject(with: Data(try key.decrypt(try key.encrypt(item.data)).utf8)) as? [String: Any]
        XCTAssertEqual(raw?["totp"] as? String, "JBSWY3DP")
        XCTAssertEqual(raw?["tags"] as? [String], ["dev"])
    }

    func testTamperedBlobIsRefused() throws {
        let key = try VaultKey(rawValue: Data(repeating: 1, count: 32))
        var blob = Array(try key.encrypt("secret"))
        // A character of the nonce: AES-GCM must refuse the blob.
        blob[5] = blob[5] == "A" ? "B" : "A"
        XCTAssertThrowsError(try key.decrypt(String(blob)))
    }

    func testLoginsForASite() {
        func login(_ id: String, _ url: String) -> VaultItem {
            var d = VaultItemData(type: .login, name: id)
            d.url = url
            d.username = "aq"
            return VaultItem(id: id, updatedAt: "", data: d)
        }
        let items = [login("g", "https://www.google.com/"), login("gh", "github.com"), login("evil", "notgoogle.com")]
        XCTAssertEqual(logins(items, matching: ["https://accounts.google.com/signin"]).map(\.id), ["g"])
        XCTAssertEqual(logins(items, matching: ["github.com"]).map(\.id), ["gh"])
    }

    func testGeneratedPassword() {
        let p = generatePassword()
        XCTAssertEqual(p.count, 24)
        XCTAssertFalse(p.contains("0") || p.contains("O") || p.contains("l"))
    }
}
