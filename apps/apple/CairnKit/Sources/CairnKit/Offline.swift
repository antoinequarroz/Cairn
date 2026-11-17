import CryptoKit
import Foundation

/// A change made on the device, waiting to reach the server. Sent in order, one at a time.
public struct PendingOp: Codable, Hashable, Sendable, Identifiable {
    public enum Kind: Codable, Hashable, Sendable {
        /// A note created on the device. Its id is local ("local-…") until the server gives one.
        case create(id: String, title: String, content: String, folderId: String?)
        /// `base`: the server's `updatedAt` of the version this edit started from. `content` is what
        /// goes to the server: for a locked note, the encrypted blob.
        case update(id: String, title: String, content: String, base: String)
        case move(id: String, folderId: String?)
        case delete(id: String)
    }

    public let id: UUID
    public var kind: Kind

    init(_ kind: Kind) {
        id = UUID()
        self.kind = kind
    }

    public var noteID: String {
        switch kind {
        case let .create(id, _, _, _), let .update(id, _, _, _), let .move(id, _), let .delete(id): id
        }
    }
}

/// What the server said about a change.
public enum OpResult: Sendable {
    case created(Note)
    case updated(Note)
    case moved(Note)
    case deleted
    /// The note changed elsewhere (or was deleted there): the server's version stays, and the
    /// version written on this device was saved as a new note, `copy`.
    case conflict(server: Note?, copy: Note)
}

/// Everything the app keeps on the device to work without network: the notes list, the notes
/// themselves, the folders, and the changes not sent yet. Locked notes are kept as the server has
/// them, encrypted.
public struct OfflineState: Codable, Sendable {
    public var notes: [NoteSummary] = []
    public var cache: [String: Note] = [:]
    public var folders: [Folder] = []
    public var pending: [PendingOp] = []
    public var lastSync: Date?
    /// A local id that got its server id, for the editors still holding the old one.
    public var aliases: [String: String] = [:]
    /// The change being sent: never merged with newer ones while it travels.
    public var inFlight: UUID?

    public init() {}

    public func resolve(_ id: String) -> String { aliases[id] ?? id }
    public func hasPending(_ id: String) -> Bool { pending.contains { $0.noteID == resolve(id) } }
    public func note(_ id: String) -> Note? { cache[resolve(id)] }

    // MARK: Changes made on the device

    public mutating func createLocal(folderId: String?, now: Date = Date()) -> Note {
        let t = Self.iso(now)
        let note = Note(id: "local-\(UUID().uuidString.lowercased())", title: "", content: "", encrypted: false, folderId: folderId, createdAt: t, updatedAt: t)
        cache[note.id] = note
        notes.insert(note.summary, at: 0)
        pending.append(PendingOp(.create(id: note.id, title: "", content: "", folderId: folderId)))
        return note
    }

    /// `content` as it goes to the server (encrypted for a locked note).
    public mutating func editLocal(_ rawID: String, title: String, content: String, now: Date = Date()) {
        let id = resolve(rawID)
        guard var note = cache[id] else { return }
        note.title = title
        note.content = content
        cache[id] = note
        var summary = note.summary
        summary.updatedAt = Self.iso(now)
        replaceSummary(summary, moveToTop: true)

        if let i = mergeable(id), case let .create(_, _, _, folder) = pending[i].kind {
            pending[i].kind = .create(id: id, title: title, content: content, folderId: folder)
        } else if let i = mergeable(id, update: true), case let .update(_, _, _, base) = pending[i].kind {
            pending[i].kind = .update(id: id, title: title, content: content, base: base)
        } else {
            // Still being created on the server: the base comes when it answers (see finish).
            let creating = pending.contains { if case .create = $0.kind { return $0.noteID == id } else { return false } }
            pending.append(PendingOp(.update(id: id, title: title, content: content, base: creating ? "" : note.updatedAt)))
        }
    }

    public mutating func moveLocal(_ rawID: String, to folderId: String?) {
        let id = resolve(rawID)
        guard var note = cache[id] ?? notes.first(where: { $0.id == id }).map({ Note(id: $0.id, title: $0.title, content: "", encrypted: $0.encrypted, folderId: $0.folderId, createdAt: $0.updatedAt, updatedAt: $0.updatedAt) }) else { return }
        note.folderId = folderId
        if cache[id] != nil { cache[id] = note }
        if let i = notes.firstIndex(where: { $0.id == id }) { notes[i].folderId = folderId }
        if let i = mergeable(id), case let .create(_, title, content, _) = pending[i].kind {
            pending[i].kind = .create(id: id, title: title, content: content, folderId: folderId)
        } else if let i = pending.lastIndex(where: { op in
            if case .move = op.kind { return op.noteID == id && op.id != inFlight }
            return false
        }) {
            pending[i].kind = .move(id: id, folderId: folderId)
        } else {
            pending.append(PendingOp(.move(id: id, folderId: folderId)))
        }
    }

    public mutating func deleteLocal(_ rawID: String) {
        let id = resolve(rawID)
        cache[id] = nil
        notes.removeAll { $0.id == id }
        let neverSent = pending.contains { op in
            if case .create = op.kind { return op.noteID == id && op.id != inFlight }
            return false
        }
        pending.removeAll { $0.noteID == id && $0.id != inFlight }
        if !neverSent { pending.append(PendingOp(.delete(id: id))) }
    }

    // MARK: Sending

    /// The next change to send, marked as travelling.
    public mutating func begin() -> PendingOp? {
        guard let op = pending.first else { return nil }
        inFlight = op.id
        return op
    }

    /// The change did not reach the server (no network): it stays first in line.
    public mutating func abort() { inFlight = nil }

    /// The server answered. Returns the new id when a local note got its server id.
    @discardableResult
    public mutating func finish(_ op: PendingOp, _ result: OpResult) -> (old: String, new: String)? {
        inFlight = nil
        pending.removeAll { $0.id == op.id }
        let id = op.noteID
        switch result {
        case let .created(server):
            rename(id, to: server.id)
            rebase(server.id, from: "", to: server.updatedAt)
            absorb(server)
            return (id, server.id)
        case let .updated(server):
            if case let .update(_, _, _, base) = op.kind { rebase(id, from: base, to: server.updatedAt) }
            absorb(server)
        case let .moved(server):
            absorb(server)
        case .deleted:
            break
        case let .conflict(server, copy):
            // The newer edits of this note went into the copy: they are not sent on top of the other version.
            pending.removeAll { op in
                if case .update = op.kind { return op.noteID == id }
                return false
            }
            if let server {
                cache[id] = server
                replaceSummary(server.summary, moveToTop: false)
            } else {
                cache[id] = nil
                notes.removeAll { $0.id == id }
            }
            cache[copy.id] = copy
            notes.insert(copy.summary, at: 0)
        }
        return nil
    }

    // MARK: From the server

    /// The server's list replaces ours, except the notes with changes not sent yet. Returns the ids
    /// whose content should be downloaded again.
    public mutating func merge(serverNotes: [NoteSummary], folders: [Folder], now: Date = Date()) -> [String] {
        self.folders = folders
        let local = Dictionary(notes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let deleting = Set(pending.compactMap { op -> String? in if case .delete = op.kind { return op.noteID } else { return nil } })
        var merged: [NoteSummary] = []
        var seen = Set<String>()
        for s in serverNotes where !deleting.contains(s.id) {
            seen.insert(s.id)
            merged.append(hasPending(s.id) ? (local[s.id] ?? s) : s)
        }
        // Created here and not sent yet.
        for s in notes where !seen.contains(s.id) && hasPending(s.id) && !deleting.contains(s.id) { merged.append(s) }
        notes = merged.sorted { $0.updatedAt > $1.updatedAt }
        // Deleted elsewhere: forgotten here too, unless changed here.
        for id in cache.keys where !seen.contains(id) && !hasPending(id) { cache[id] = nil }
        lastSync = now
        return serverNotes.filter { !hasPending($0.id) && cache[$0.id]?.updatedAt != $0.updatedAt }.map(\.id)
    }

    /// A note downloaded from the server. Ignored while it has changes not sent yet.
    public mutating func store(_ note: Note) {
        guard !hasPending(note.id) else { return }
        cache[note.id] = note
        replaceSummary(note.summary, moveToTop: false)
    }

    /// Search without network: titles, and the text of the notes that are not locked.
    public func search(_ query: String) -> [NoteSummary] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        guard !words.isEmpty else { return [] }
        return notes.filter { s in
            let text = (s.title + " " + ((cache[s.id].flatMap { $0.encrypted ? nil : $0.content }) ?? s.excerpt)).lowercased()
            return words.allSatisfy { text.folding(options: .diacriticInsensitive, locale: nil).contains($0.folding(options: .diacriticInsensitive, locale: nil)) }
        }
    }

    // MARK: Plumbing

    /// The newest change of this note that may still absorb another one (not travelling).
    private func mergeable(_ id: String, update: Bool = false) -> Int? {
        guard let i = pending.lastIndex(where: { $0.noteID == id }), pending[i].id != inFlight else { return nil }
        switch pending[i].kind {
        case .create: return update ? nil : i
        case .update: return update ? i : nil
        default: return nil
        }
    }

    private mutating func rename(_ old: String, to new: String) {
        aliases[old] = new
        for (k, v) in aliases where v == old { aliases[k] = new }
        if let n = cache.removeValue(forKey: old) {
            cache[new] = Note(id: new, title: n.title, content: n.content, encrypted: n.encrypted, folderId: n.folderId, createdAt: n.createdAt, updatedAt: n.updatedAt)
        }
        if let i = notes.firstIndex(where: { $0.id == old }) {
            let s = notes[i]
            notes[i] = NoteSummary(id: new, title: s.title, encrypted: s.encrypted, folderId: s.folderId, updatedAt: s.updatedAt, excerpt: s.excerpt)
        }
        for i in pending.indices {
            switch pending[i].kind {
            case let .update(id, t, c, b) where id == old: pending[i].kind = .update(id: new, title: t, content: c, base: b)
            case let .move(id, f) where id == old: pending[i].kind = .move(id: new, folderId: f)
            case let .delete(id) where id == old: pending[i].kind = .delete(id: new)
            default: break
            }
        }
    }

    /// The edits queued after one that just reached the server now start from its new version.
    private mutating func rebase(_ id: String, from old: String, to new: String) {
        for i in pending.indices {
            if case let .update(pid, t, c, base) = pending[i].kind, pid == id, base == old {
                pending[i].kind = .update(id: id, title: t, content: c, base: new)
            }
        }
    }

    /// Takes the server's version, but keeps the text typed meanwhile if more is waiting.
    private mutating func absorb(_ server: Note) {
        if hasPending(server.id), var local = cache[server.id] {
            local.updatedAt = server.updatedAt
            local.folderId = server.folderId
            cache[server.id] = local
        } else {
            cache[server.id] = server
            replaceSummary(server.summary, moveToTop: false)
        }
    }

    private mutating func replaceSummary(_ s: NoteSummary, moveToTop: Bool) {
        if let i = notes.firstIndex(where: { $0.id == s.id }) {
            if moveToTop {
                notes.remove(at: i)
                notes.insert(s, at: 0)
            } else {
                notes[i] = s
            }
        } else {
            notes.insert(s, at: 0)
        }
    }

    static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }
}

/// What the sync needs from the server. `CairnClient` provides it; tests use a stand-in.
public protocol NotesAPI: Sendable {
    func notes() async throws -> [NoteSummary]
    func note(_ id: String) async throws -> Note
    func folders() async throws -> [Folder]
    func createNote(title: String, content: String, folderId: String?) async throws -> Note
    func updateNote(_ id: String, title: String, content: String, ifUpdatedAt: String?) async throws -> Note
    func lockNote(_ id: String, title: String, blob: String) async throws -> Note
    func moveNote(_ id: String, to folderId: String?) async throws -> Note
    func deleteNote(_ id: String) async throws
}

extension CairnClient: NotesAPI {}

public enum Sync {
    /// Sends one change. Network errors are thrown (the change stays in line); answers from the
    /// server, including a conflict, come back as a result. `latest` is the newest version of the
    /// note on the device, used for the copy when there is a conflict.
    public static func send(_ op: PendingOp, latest: Note?, api: some NotesAPI) async throws -> OpResult {
        switch op.kind {
        case let .create(_, title, content, folderId):
            return .created(try await api.createNote(title: title, content: content, folderId: folderId))
        case let .update(id, title, content, base):
            do {
                return .updated(try await api.updateNote(id, title: title, content: content, ifUpdatedAt: base.isEmpty ? nil : base))
            } catch let CairnError.conflict(server) {
                return .conflict(server: server, copy: try await copy(of: latest, title: title, content: content, encrypted: server.encrypted, folderId: server.folderId, api: api))
            } catch CairnError.notFound {
                return .conflict(server: nil, copy: try await copy(of: latest, title: title, content: content, encrypted: latest?.encrypted ?? false, folderId: latest?.folderId, api: api))
            }
        case let .move(id, folderId):
            do { return .moved(try await api.moveNote(id, to: folderId)) } catch CairnError.notFound { return .deleted }
        case let .delete(id):
            do { try await api.deleteNote(id) } catch CairnError.notFound {}
            return .deleted
        }
    }

    /// The version written here, kept as a new note "… (conflit)". A locked note's copy is created
    /// empty and then gets the encrypted text: nothing readable is sent.
    private static func copy(of latest: Note?, title: String, content: String, encrypted: Bool, folderId: String?, api: some NotesAPI) async throws -> Note {
        let t = latest?.title ?? title
        let c = latest?.content ?? content
        let name = "\(t.isEmpty ? "Sans titre" : t) (conflit)"
        if encrypted {
            let empty = try await api.createNote(title: name, content: "", folderId: folderId)
            return try await api.lockNote(empty.id, title: name, blob: c)
        }
        return try await api.createNote(title: name, content: c, folderId: folderId)
    }
}

/// The offline copy on disk, one file per server, in the app's own container. On the iPhone the
/// file is encrypted by the system while the phone is locked after a restart.
public enum OfflineFile {
    static func url(server: String) -> URL? {
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("Cairn", isDirectory: true) else { return nil }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let digest = SHA256.hash(data: Data(server.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        return dir.appendingPathComponent("offline-\(digest).json")
    }

    public static func load(server: String) -> OfflineState? {
        guard let url = url(server: server), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(OfflineState.self, from: data)
    }

    public static func save(_ state: OfflineState, server: String) {
        guard let url = url(server: server) else { return }
        var copy = state
        copy.inFlight = nil
        guard let data = try? JSONEncoder().encode(copy) else { return }
        #if os(iOS)
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try? data.write(to: url, options: .atomic)
        #endif
    }

    public static func delete(server: String) {
        if let url = url(server: server) { try? FileManager.default.removeItem(at: url) }
    }
}
