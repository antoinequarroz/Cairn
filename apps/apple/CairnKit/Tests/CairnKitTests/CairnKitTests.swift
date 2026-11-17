import XCTest
@testable import CairnKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class ModelsTests: XCTestCase {
    func testDecodesTheServerNotes() throws {
        let json = #"{"notes":[{"id":"a1","title":"","encrypted":false,"folderId":null,"updatedAt":"2026-11-17T10:00:00.123Z","excerpt":"Bonjour"}]}"#
        struct R: Decodable { var notes: [NoteSummary] }
        let note = try JSONDecoder().decode(R.self, from: Data(json.utf8)).notes[0]
        XCTAssertEqual(note.displayTitle, "Sans titre")
        XCTAssertNil(note.folderId)
        XCTAssertNotNil(note.updatedDate)
    }

    func testServerURL() {
        XCTAssertEqual(CairnClient.serverURL(from: " cairn.example.ch/ ")?.absoluteString, "https://cairn.example.ch")
        XCTAssertEqual(CairnClient.serverURL(from: "http://localhost:3000")?.absoluteString, "http://localhost:3000")
        XCTAssertNil(CairnClient.serverURL(from: "http://cairn.example.ch"), "plain http only for a local server")
        XCTAssertNil(CairnClient.serverURL(from: ""))
    }

    func testFolderTree() {
        func f(_ id: String, _ parent: String?, _ name: String) -> Folder {
            Folder(id: id, parentId: parent, name: name, instructions: "", createdAt: "", updatedAt: "")
        }
        let tree = FolderNode.tree([f("b", nil, "Boulot"), f("a", nil, "Alfred"), f("c", "b", "VPS"), f("d", "gone", "Orphelin")])
        XCTAssertEqual(tree.map(\.folder.name), ["Alfred", "Boulot", "Orphelin"])
        XCTAssertEqual(tree[1].children?.map(\.folder.name), ["VPS"])
        XCTAssertNil(tree[0].children)
    }
}

final class MarkdownTests: XCTestCase {
    func testBlocks() {
        let md = """
        # Titre
        Un **paragraphe**
        sur deux lignes.

        - un
          - deux
        - [x] fait
        1. premier
        > citation
        ```bash
        ssh vps
        ```
        ---
        ![schéma](/api/files/f1)
        """
        XCTAssertEqual(MarkdownBlock.parse(md), [
            .heading(level: 1, text: "Titre"),
            .paragraph("Un **paragraphe**\nsur deux lignes."),
            .bullet(text: "un", indent: 0),
            .bullet(text: "deux", indent: 1),
            .task(done: true, text: "fait", indent: 0),
            .numbered(number: "1", text: "premier", indent: 0),
            .quote("citation"),
            .code(language: "bash", text: "ssh vps"),
            .rule,
            .image(alt: "schéma", url: "/api/files/f1"),
        ])
    }

    func testUnclosedFenceKeepsTheCode() {
        XCTAssertEqual(MarkdownBlock.parse("```\nnpm i"), [.code(language: "", text: "npm i")])
    }
}

/// Answers requests with canned responses, and records them.
final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, [String: String], String))?
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        let (status, headers, body) = Self.handler!(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        config.httpShouldSetCookies = false
        return URLSession(configuration: config)
    }
}

final class ClientTests: XCTestCase {
    let url = URL(string: "https://cairn.example.ch")!
    let note = #"{"id":"n1","title":"VPS","content":"ssh","encrypted":false,"folderId":null,"createdAt":"2026-11-17T10:00:00.000Z","updatedAt":"2026-11-17T11:00:00.000Z"}"#

    override func setUp() { StubProtocol.requests = [] }

    func testLoginKeepsTheCookieAndSendsIt() async throws {
        StubProtocol.handler = { req in
            if req.url!.path == "/api/auth/login" {
                return (200, ["Set-Cookie": "cairn_session=abc123; Path=/; HttpOnly; Secure; SameSite=lax"], #"{"ok":true}"#)
            }
            return (200, [:], #"{"notes":[]}"#)
        }
        let client = CairnClient(baseURL: url, session: StubProtocol.session())
        let token = try await client.login(password: "secret")
        XCTAssertEqual(token, "abc123")
        _ = try await client.notes()
        XCTAssertEqual(StubProtocol.requests.last?.value(forHTTPHeaderField: "Cookie"), "cairn_session=abc123")
        XCTAssertNil(StubProtocol.requests.first?.value(forHTTPHeaderField: "Cookie"))
    }

    func testLoginAsksForTheCode() async {
        StubProtocol.handler = { _ in (401, [:], #"{"needCode":true}"#) }
        let client = CairnClient(baseURL: url, session: StubProtocol.session())
        do {
            try await client.login(password: "secret")
            XCTFail("should ask for the code")
        } catch {
            XCTAssertEqual(error as? CairnError, .needCode(nil))
        }
    }

    func testWrongPassword() async {
        StubProtocol.handler = { _ in (401, [:], #"{"error":"Mot de passe incorrect"}"#) }
        let client = CairnClient(baseURL: url, session: StubProtocol.session())
        do {
            try await client.login(password: "nope")
            XCTFail("should refuse")
        } catch {
            XCTAssertEqual(error as? CairnError, .wrongPassword("Mot de passe incorrect"))
        }
    }

    func testConflictCarriesTheServerVersion() async throws {
        let note = note
        StubProtocol.handler = { _ in (409, [:], #"{"error":"Note modifiée ailleurs entre-temps","note":\#(note)}"#) }
        let client = CairnClient(baseURL: url, sessionToken: "abc", session: StubProtocol.session())
        do {
            _ = try await client.updateNote("n1", title: "VPS", content: "mine", ifUpdatedAt: "2026-11-17T10:30:00.000Z")
            XCTFail("should be a conflict")
        } catch let CairnError.conflict(server) {
            XCTAssertEqual(server.content, "ssh")
        }
        let body = try XCTUnwrap(StubProtocol.requests.last.flatMap(Self.body))
        XCTAssertEqual(body["ifUpdatedAt"] as? String, "2026-11-17T10:30:00.000Z")
        XCTAssertEqual(StubProtocol.requests.last?.httpMethod, "PATCH")
    }

    func testExpiredSession() async {
        StubProtocol.handler = { _ in (401, [:], #"{"error":"Non autorisé"}"#) }
        let client = CairnClient(baseURL: url, sessionToken: "old", session: StubProtocol.session())
        do {
            _ = try await client.folders()
            XCTFail("should be unauthorized")
        } catch {
            XCTAssertEqual(error as? CairnError, .unauthorized)
        }
    }

    func testFilesStayOnTheServer() async {
        let client = CairnClient(baseURL: url, sessionToken: "abc", session: StubProtocol.session())
        do {
            _ = try await client.file("https://evil.example/x.png")
            XCTFail("should refuse")
        } catch {
            XCTAssertEqual(error as? CairnError, .invalidServer)
        }
    }

    /// URLProtocol gets the body as a stream.
    static func body(_ request: URLRequest) -> [String: Any]? {
        var data = request.httpBody
        if data == nil, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            var out = Data()
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                out.append(buffer, count: n)
            }
            stream.close()
            data = out
        }
        return data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
}

final class HighlightTests: XCTestCase {
    func testMarks() {
        let h = Highlighted("config \u{1}caddy\u{2} du vps")
        XCTAssertEqual(h.plain, "config caddy du vps")
        XCTAssertEqual(h.parts.map(\.match), [false, true, false])
    }
}
