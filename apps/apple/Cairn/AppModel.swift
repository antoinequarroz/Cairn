import CairnKit
import Foundation
import Network
import Observation

/// What the app knows: the server, the session, the notes and the folders. Everything works
/// without network: notes are read from and written to a copy on the device (`OfflineState`), and
/// the changes go to the server in order as soon as it can be reached. When a note changed on
/// another device meanwhile, nothing is overwritten: the version written here becomes a copy.
@MainActor
@Observable
final class AppModel {
    enum Scope: Hashable {
        case all
        case vault
        case folder(String)
    }

    private(set) var client: CairnClient?
    private(set) var serverAddress: String
    private(set) var offline = OfflineState()
    var scope: Scope? = .all
    var selectedNoteID: String?
    var isLoading = false
    private(set) var isSyncing = false
    private(set) var isOnline = true
    /// The last sync could not reach the server.
    private(set) var unreachable = false
    var errorMessage: String?
    let vault = VaultModel()

    var isSignedIn: Bool { client != nil }
    var notes: [NoteSummary] { offline.notes }
    var folders: [Folder] { offline.folders }
    var folderTree: [FolderNode] { FolderNode.tree(folders) }
    var pendingCount: Int { offline.pending.count }

    private static let serverKey = "serverAddress"
    private let monitor = NWPathMonitor()
    private var saveTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var syncAgain = false

    init() {
        serverAddress = UserDefaults.standard.string(forKey: Self.serverKey) ?? ""
        // Back where we left off: the token stays valid until the password changes on the server.
        if let url = CairnClient.serverURL(from: serverAddress), let token = Keychain.read(account: url.absoluteString) {
            client = CairnClient(baseURL: url, sessionToken: token.isEmpty ? nil : token)
            offline = OfflineFile.load(server: url.absoluteString) ?? OfflineState()
        }
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.networkChanged(online) }
        }
        monitor.start(queue: DispatchQueue(label: "cairn.network"))
    }

    private func networkChanged(_ online: Bool) {
        let cameBack = online && !isOnline
        isOnline = online
        if cameBack { scheduleSync(after: .seconds(1)) }
    }

    // MARK: Session

    /// Throws `CairnError.needCode` when the server wants the two-factor code.
    func signIn(server: String, password: String, code: String?) async throws {
        guard let url = CairnClient.serverURL(from: server) else { throw CairnError.invalidServer }
        let candidate = CairnClient(baseURL: url)
        let token = try await candidate.login(password: password, code: code)
        await adopt(candidate, url: url, token: token)
    }

    /// Whether the server at this address offers "Continuer avec mon Compte Postmelo".
    func compteEnabled(server: String) async -> Bool {
        guard let url = CairnClient.serverURL(from: server) else { return false }
        return await CairnClient(baseURL: url).compteEnabled()
    }

    /// End of "Continuer avec mon Compte Postmelo": the handoff the sign-in sheet came back with.
    func finishCompte(server: String, handoff: String, verifier: String, code: String?) async throws {
        guard let url = CairnClient.serverURL(from: server) else { throw CairnError.invalidServer }
        let candidate = CairnClient(baseURL: url)
        let token = try await candidate.compteFinish(handoff: handoff, verifier: verifier, code: code)
        await adopt(candidate, url: url, token: token)
    }

    private func adopt(_ candidate: CairnClient, url: URL, token: String?) async {
        Keychain.save(token ?? "", account: url.absoluteString)
        UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
        if url.absoluteString != serverAddress { offline = OfflineFile.load(server: url.absoluteString) ?? OfflineState() }
        serverAddress = url.absoluteString
        client = candidate
        await reload()
    }

    /// Forgets everything on this device, changes not sent included (the menu warns first).
    func signOut() async {
        if let client { await client.logout() }
        if let url = CairnClient.serverURL(from: serverAddress) {
            Keychain.delete(account: url.absoluteString)
            OfflineFile.delete(server: url.absoluteString)
        }
        client = nil
        vault.forget()
        offline = OfflineState()
        selectedNoteID = nil
        scope = .all
    }

    // MARK: Sync

    /// Sends what is waiting, then fetches the list, the folders and the notes that changed.
    func reload() async {
        isLoading = true
        defer { isLoading = false }
        await sync()
        if let client { try? await vault.load(client) }
    }

    func scheduleSync(after delay: Duration = .milliseconds(600)) {
        syncTask?.cancel()
        syncTask = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await sync()
        }
    }

    func sync() async {
        guard let client else { return }
        if isSyncing { syncAgain = true; return }
        isSyncing = true
        defer {
            isSyncing = false
            if syncAgain { syncAgain = false; scheduleSync() }
        }
        do {
            try await push(client)
            let ids = offline.merge(serverNotes: try await client.notes(), folders: try await client.folders())
            persist()
            for id in ids {
                offline.store(try await client.note(id))
            }
            unreachable = false
            persist()
        } catch let error as CairnError {
            if case .network = error { unreachable = true } else { report(error) }
        } catch {
            unreachable = true
        }
    }

    private func push(_ client: CairnClient) async throws {
        var conflicts: [String] = []
        defer {
            if !conflicts.isEmpty {
                errorMessage = conflicts.count == 1
                    ? "« \(conflicts[0]) » a changé sur un autre appareil : ta version est gardée dans une copie."
                    : "\(conflicts.count) notes ont changé sur un autre appareil : tes versions sont gardées dans des copies."
            }
        }
        while let op = offline.begin() {
            let result: OpResult
            do {
                result = try await Sync.send(op, latest: offline.note(op.noteID), api: client)
            } catch {
                offline.abort()
                throw error
            }
            if case let .conflict(_, copy) = result { conflicts.append(copy.title.replacingOccurrences(of: " (conflit)", with: "")) }
            if let renamed = offline.finish(op, result), selectedNoteID == renamed.old { selectedNoteID = renamed.new }
            persist()
        }
    }

    /// Writes the copy on disk, a moment after the last change.
    private func persist() {
        guard let url = CairnClient.serverURL(from: serverAddress) else { return }
        saveTask?.cancel()
        let state = offline
        saveTask = Task.detached(priority: .utility) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            OfflineFile.save(state, server: url.absoluteString)
        }
    }

    // MARK: Notes

    var visibleNotes: [NoteSummary] {
        switch scope {
        case let .folder(id):
            let inside = descendants(of: id)
            return notes.filter { $0.folderId.map(inside.contains) ?? false }
        default:
            return notes
        }
    }

    func title(of scope: Scope?) -> String {
        if case let .folder(id) = scope { return folders.first { $0.id == id }?.name ?? "Dossier" }
        if scope == .vault { return "Coffre" }
        return "Toutes les notes"
    }

    /// A note to open: the server's latest when it can be reached, the copy on the device otherwise.
    func openNote(_ id: String) async throws -> Note {
        let id = offline.resolve(id)
        if let client, !offline.hasPending(id), !id.hasPrefix("local-") {
            do {
                offline.store(try await client.note(id))
                persist()
            } catch let error as CairnError {
                if case .notFound = error { throw error }
                if case .unauthorized = error { report(error) }
            } catch {}
        }
        guard let note = offline.note(id) else { throw CairnError.network("Cette note n'a pas encore été téléchargée : il faut du réseau pour l'ouvrir.") }
        return note
    }

    /// Saves on the device and sends when possible. `content` as it goes to the server (encrypted
    /// for a locked note).
    func saveNote(_ id: String, title: String, content: String) {
        offline.editLocal(id, title: title, content: content)
        persist()
        scheduleSync()
    }

    func isWaiting(_ id: String) -> Bool { offline.hasPending(id) }

    func createNote() async {
        guard client != nil else { return }
        var folderId: String?
        if case let .folder(id) = scope { folderId = id }
        let note = offline.createLocal(folderId: folderId)
        selectedNoteID = note.id
        persist()
        scheduleSync()
    }

    func delete(_ id: String) async {
        offline.deleteLocal(id)
        if let selected = selectedNoteID, offline.resolve(selected) == offline.resolve(id) { selectedNoteID = nil }
        persist()
        scheduleSync()
    }

    func move(_ id: String, to folderId: String?) async {
        offline.moveLocal(id, to: folderId)
        persist()
        scheduleSync()
    }

    /// Without network, the search runs on the copy on the device.
    func searchOffline(_ query: String) -> [SearchResult] {
        offline.search(query).map { SearchResult(kind: "note", id: $0.id, title: $0.title, snippet: $0.excerpt, encrypted: $0.encrypted, folderId: $0.folderId) }
    }

    func report(_ error: Error) {
        if case CairnError.unauthorized = error {
            // The changes not sent yet stay on the device and leave after the next sign-in.
            client = nil
            vault.lock()
            errorMessage = CairnError.unauthorized.errorDescription
            return
        }
        if case CairnError.network = error { unreachable = true; return }
        errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    /// A folder and every folder inside it: a project shows the notes of its subfolders too.
    private func descendants(of id: String) -> Set<String> {
        var result: Set<String> = [id]
        var frontier = [id]
        while let current = frontier.popLast() {
            for f in folders where f.parentId == current && !result.contains(f.id) {
                result.insert(f.id)
                frontier.append(f.id)
            }
        }
        return result
    }
}
