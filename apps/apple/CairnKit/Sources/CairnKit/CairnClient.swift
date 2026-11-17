import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum CairnError: LocalizedError, Equatable {
    case invalidServer
    /// The session is no longer valid (password changed on the server): sign in again.
    case unauthorized
    /// Two-factor authentication is on: send the password again with a code.
    case needCode(String?)
    case wrongPassword(String)
    /// The note changed on another device since this edit started. Carries the server's version.
    case conflict(Note)
    case notFound
    case server(Int, String)
    case network(String)
    case decoding

    public var errorDescription: String? {
        switch self {
        case .invalidServer: "Adresse du serveur invalide"
        case .unauthorized: "Session expirée, reconnecte-toi"
        case let .needCode(message): message ?? "Code de double authentification requis"
        case let .wrongPassword(message): message
        case .conflict: "Cette note a été modifiée ailleurs entre-temps"
        case .notFound: "Introuvable"
        case let .server(status, message): message.isEmpty ? "Erreur du serveur (\(status))" : message
        case let .network(message): message
        case .decoding: "Réponse du serveur illisible"
        }
    }
}

/// Talks to a Cairn server, the same API as the web app. Signs in like a browser does (password,
/// then the 2FA code when it is on) and keeps the session cookie's value, which the app stores in
/// the Keychain. The API token (`API_TOKEN`) is for scripts and never goes in the app.
public actor CairnClient {
    public static let sessionCookie = "cairn_session"

    public let baseURL: URL
    public private(set) var sessionToken: String?
    private let session: URLSession

    public init(baseURL: URL, sessionToken: String? = nil, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.sessionToken = sessionToken
        self.session = session ?? {
            let config = URLSessionConfiguration.ephemeral
            // The cookie is sent by hand: nothing kept in a shared cookie store.
            config.httpCookieAcceptPolicy = .never
            config.httpShouldSetCookies = false
            config.timeoutIntervalForRequest = 30
            return URLSession(configuration: config)
        }()
    }

    /// "cairn.example.ch" → https://cairn.example.ch. Plain http is accepted only for a local server.
    public static func serverURL(from input: String) -> URL? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        if s.isEmpty { return nil }
        if !s.contains("://") { s = "https://" + s }
        guard let url = URL(string: s), let scheme = url.scheme?.lowercased(), let host = url.host, !host.isEmpty else { return nil }
        if scheme == "https" { return url }
        let local = host == "localhost" || host == "127.0.0.1" || host.hasSuffix(".local")
        return scheme == "http" && local ? url : nil
    }

    // MARK: Session

    /// Signs in and returns the session token to keep. Throws `.needCode` when the server wants the
    /// 2FA code: call again with the same password and the code.
    @discardableResult
    public func login(password: String, code: String? = nil) async throws -> String? {
        var payload: [String: String?] = ["password": password]
        if let code, !code.isEmpty { payload["code"] = code }
        let (data, response) = try await send("POST", "/api/auth/login", json: payload, authenticated: false)
        let reply = (try? JSONDecoder().decode(LoginReply.self, from: data)) ?? LoginReply()
        if response.statusCode == 401 {
            if reply.needCode == true { throw CairnError.needCode(code == nil ? nil : reply.error) }
            throw CairnError.wrongPassword(reply.error ?? "Mot de passe incorrect")
        }
        try check(response, data)
        // A server without a password answers ok without a cookie: nothing to send then.
        sessionToken = Self.cookieValue(response, url: baseURL)
        return sessionToken
    }

    public func logout() async {
        _ = try? await send("POST", "/api/auth/logout")
        sessionToken = nil
    }

    // MARK: Notes

    public func notes() async throws -> [NoteSummary] {
        try await get("/api/notes", as: NotesReply.self).notes
    }

    public func note(_ id: String) async throws -> Note {
        try await get("/api/notes/\(Self.escape(id))", as: NoteReply.self).note
    }

    public func createNote(title: String = "", content: String = "", folderId: String? = nil) async throws -> Note {
        var payload: [String: String?] = ["title": title, "content": content]
        if let folderId { payload["folderId"] = folderId }
        let (data, response) = try await send("POST", "/api/notes", json: payload)
        try check(response, data)
        return try decode(NoteReply.self, data).note
    }

    /// Saves the title and the content. With `ifUpdatedAt`, refuses to overwrite a newer version
    /// written elsewhere and throws `.conflict` with it.
    public func updateNote(_ id: String, title: String, content: String, ifUpdatedAt: String?) async throws -> Note {
        var payload: [String: String?] = ["title": title, "content": content]
        if let ifUpdatedAt { payload["ifUpdatedAt"] = ifUpdatedAt }
        let (data, response) = try await send("PATCH", "/api/notes/\(Self.escape(id))", json: payload)
        if response.statusCode == 409, let reply = try? JSONDecoder().decode(NoteReply.self, from: data) {
            throw CairnError.conflict(reply.note)
        }
        try check(response, data)
        return try decode(NoteReply.self, data).note
    }

    /// Puts an encrypted text in a note and marks it locked (cadenas). The text is encrypted on
    /// the device before: the server only ever gets the blob.
    public func lockNote(_ id: String, title: String, blob: String) async throws -> Note {
        struct Payload: Encodable { var title: String; var content: String; var encrypted = true }
        let (data, response) = try await send("PATCH", "/api/notes/\(Self.escape(id))", json: Payload(title: title, content: blob))
        try check(response, data)
        return try decode(NoteReply.self, data).note
    }

    /// Moves a note to a folder (`nil`: the root).
    public func moveNote(_ id: String, to folderId: String?) async throws -> Note {
        let payload: [String: String?] = ["folderId": folderId]
        let (data, response) = try await send("PATCH", "/api/notes/\(Self.escape(id))", json: payload)
        try check(response, data)
        return try decode(NoteReply.self, data).note
    }

    public func deleteNote(_ id: String) async throws {
        let (data, response) = try await send("DELETE", "/api/notes/\(Self.escape(id))")
        try check(response, data)
    }

    // MARK: Folders and search

    public func folders() async throws -> [Folder] {
        try await get("/api/folders", as: FoldersReply.self).folders
    }

    public func search(_ query: String, folderId: String? = nil, limit: Int = 30) async throws -> [SearchResult] {
        var c = URLComponents()
        c.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: String(limit))]
        if let folderId { c.queryItems?.append(URLQueryItem(name: "folder", value: folderId)) }
        return try await get("/api/search?\(c.percentEncodedQuery ?? "")", as: SearchReply.self).results
    }

    /// A file of the server (an image in a note: `/api/files/<id>`), with the session. Only paths of
    /// this server: the session cookie never goes to another site.
    public func file(_ path: String) async throws -> Data {
        guard path.hasPrefix("/api/files/") else { throw CairnError.invalidServer }
        let (data, response) = try await send("GET", path)
        try check(response, data)
        return data
    }

    // MARK: Vault (always encrypted: the server never sees what is inside)

    /// The vault's public parameters (`nil` when it was never created on the web) and its items.
    public func vault() async throws -> (meta: VaultMeta?, items: [VaultItemRow]) {
        let reply = try await get("/api/vault", as: VaultReply.self)
        return (reply.meta, reply.items)
    }

    public func addVaultItem(_ blob: String) async throws -> VaultItemRow {
        let (data, response) = try await send("POST", "/api/vault/items", json: ["data": blob] as [String: String])
        try check(response, data)
        return try decode(VaultItemReply.self, data).item
    }

    public func updateVaultItem(_ id: String, _ blob: String) async throws -> VaultItemRow {
        let (data, response) = try await send("PUT", "/api/vault/items/\(Self.escape(id))", json: ["data": blob] as [String: String])
        try check(response, data)
        return try decode(VaultItemReply.self, data).item
    }

    public func deleteVaultItem(_ id: String) async throws {
        let (data, response) = try await send("DELETE", "/api/vault/items/\(Self.escape(id))")
        try check(response, data)
    }

    // MARK: Plumbing

    private func get<T: Decodable>(_ path: String, as: T.Type) async throws -> T {
        let (data, response) = try await send("GET", path)
        try check(response, data)
        return try decode(T.self, data)
    }

    private func send(_ method: String, _ path: String, json: (any Encodable)? = nil, authenticated: Bool = true) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else { throw CairnError.invalidServer }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(json)
        }
        if authenticated, let sessionToken {
            request.setValue("\(Self.sessionCookie)=\(sessionToken)", forHTTPHeaderField: "Cookie")
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw CairnError.network("Réponse inattendue") }
            return (data, http)
        } catch let error as CairnError {
            throw error
        } catch {
            throw CairnError.network(error.localizedDescription)
        }
    }

    private func check(_ response: HTTPURLResponse, _ data: Data) throws {
        switch response.statusCode {
        case 200 ..< 300: return
        case 401: throw CairnError.unauthorized
        case 404: throw CairnError.notFound
        default:
            let message = (try? JSONDecoder().decode(ErrorReply.self, from: data))?.error ?? ""
            throw CairnError.server(response.statusCode, message)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(type, from: data) } catch { throw CairnError.decoding }
    }

    static func cookieValue(_ response: HTTPURLResponse, url: URL) -> String? {
        var fields: [String: String] = [:]
        for (k, v) in response.allHeaderFields { if let k = k as? String, let v = v as? String { fields[k] = v } }
        return HTTPCookie.cookies(withResponseHeaderFields: fields, for: url).first { $0.name == sessionCookie }?.value
    }

    static func escape(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
    }
}

private struct LoginReply: Decodable { var ok: Bool?; var needCode: Bool?; var error: String? }
private struct ErrorReply: Decodable { var error: String }
private struct NotesReply: Decodable { var notes: [NoteSummary] }
private struct NoteReply: Decodable { var note: Note }
private struct FoldersReply: Decodable { var folders: [Folder] }
private struct SearchReply: Decodable { var results: [SearchResult] }
private struct VaultReply: Decodable { var meta: VaultMeta?; var items: [VaultItemRow] }
private struct VaultItemReply: Decodable { var item: VaultItemRow }
