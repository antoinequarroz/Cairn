import CairnKit
import Foundation
import Observation

/// What the app knows: the server, the session, the notes and the folders. The notes list is the
/// server's (no offline copy yet): it is reloaded at launch, on pull to refresh and after each change.
@MainActor
@Observable
final class AppModel {
    enum Scope: Hashable {
        case all
        case folder(String)
    }

    private(set) var client: CairnClient?
    private(set) var serverAddress: String
    var notes: [NoteSummary] = []
    var folders: [Folder] = []
    var scope: Scope? = .all
    var selectedNoteID: String?
    var isLoading = false
    var errorMessage: String?

    var isSignedIn: Bool { client != nil }
    var folderTree: [FolderNode] { FolderNode.tree(folders) }

    private static let serverKey = "serverAddress"

    init() {
        serverAddress = UserDefaults.standard.string(forKey: Self.serverKey) ?? ""
        // Back where we left off: the token stays valid until the password changes on the server.
        if let url = CairnClient.serverURL(from: serverAddress), let token = Keychain.read(account: url.absoluteString) {
            client = CairnClient(baseURL: url, sessionToken: token.isEmpty ? nil : token)
        }
    }

    // MARK: Session

    /// Throws `CairnError.needCode` when the server wants the two-factor code.
    func signIn(server: String, password: String, code: String?) async throws {
        guard let url = CairnClient.serverURL(from: server) else { throw CairnError.invalidServer }
        let candidate = CairnClient(baseURL: url)
        let token = try await candidate.login(password: password, code: code)
        Keychain.save(token ?? "", account: url.absoluteString)
        UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
        serverAddress = url.absoluteString
        client = candidate
        await reload()
    }

    func signOut() async {
        if let client { await client.logout() }
        if let url = CairnClient.serverURL(from: serverAddress) { Keychain.delete(account: url.absoluteString) }
        client = nil
        notes = []
        folders = []
        selectedNoteID = nil
        scope = .all
    }

    // MARK: Notes

    func reload() async {
        guard let client else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let n = client.notes()
            async let f = client.folders()
            (notes, folders) = try await (n, f)
        } catch {
            report(error)
        }
    }

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
        return "Toutes les notes"
    }

    func createNote() async {
        guard let client else { return }
        var folderId: String?
        if case let .folder(id) = scope { folderId = id }
        do {
            let note = try await client.createNote(folderId: folderId)
            notes.insert(note.summary, at: 0)
            selectedNoteID = note.id
        } catch {
            report(error)
        }
    }

    func delete(_ id: String) async {
        guard let client else { return }
        do {
            try await client.deleteNote(id)
            notes.removeAll { $0.id == id }
            if selectedNoteID == id { selectedNoteID = nil }
        } catch {
            report(error)
        }
    }

    func move(_ id: String, to folderId: String?) async {
        guard let client else { return }
        do {
            let note = try await client.moveNote(id, to: folderId)
            replace(note.summary)
        } catch {
            report(error)
        }
    }

    /// Called by the editor after each save, so the list shows the new title and date.
    func didSave(_ note: Note) {
        if notes.contains(where: { $0.id == note.id }) {
            replace(note.summary)
            notes.sort { $0.updatedAt > $1.updatedAt }
        } else {
            notes.insert(note.summary, at: 0)
        }
    }

    func report(_ error: Error) {
        if case CairnError.unauthorized = error {
            client = nil
            errorMessage = CairnError.unauthorized.errorDescription
            return
        }
        errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    private func replace(_ summary: NoteSummary) {
        if let i = notes.firstIndex(where: { $0.id == summary.id }) { notes[i] = summary }
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
