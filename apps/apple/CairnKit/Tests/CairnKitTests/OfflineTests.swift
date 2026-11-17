import XCTest
@testable import CairnKit

/// A server in memory, to test the sync without network.
final class FakeServer: NotesAPI, @unchecked Sendable {
    var notes: [String: Note] = [:]
    var offline = false
    var clock = 0
    var calls: [String] = []

    private func stamp() -> String { clock += 1; return String(format: "2026-11-17T12:00:%02d.000Z", clock) }
    private func online() throws { if offline { throw CairnError.network("hors ligne") } }

    func add(_ id: String, _ title: String, _ content: String, encrypted: Bool = false) -> Note {
        let t = stamp()
        let n = Note(id: id, title: title, content: content, encrypted: encrypted, folderId: nil, createdAt: t, updatedAt: t)
        notes[id] = n
        return n
    }

    func notes() async throws -> [NoteSummary] { try online(); return notes.values.map(\.summary) }
    func note(_ id: String) async throws -> Note { try online(); guard let n = notes[id] else { throw CairnError.notFound }; return n }
    func folders() async throws -> [Folder] { try online(); return [] }
    func createNote(title: String, content: String, folderId: String?) async throws -> Note {
        try online(); calls.append("create \(title)")
        var n = add("s\(notes.count + 1)", title, content)
        n.folderId = folderId
        notes[n.id] = n
        return n
    }
    func updateNote(_ id: String, title: String, content: String, ifUpdatedAt: String?) async throws -> Note {
        try online(); calls.append("update \(id)")
        guard var n = notes[id] else { throw CairnError.notFound }
        if let ifUpdatedAt, ifUpdatedAt != n.updatedAt { throw CairnError.conflict(n) }
        n.title = title; n.content = content; n.updatedAt = stamp()
        notes[id] = n
        return n
    }
    func lockNote(_ id: String, title: String, blob: String) async throws -> Note {
        try online(); calls.append("lock \(id)")
        var n = notes[id]!
        n.title = title; n.content = blob; n.encrypted = true; n.updatedAt = stamp()
        notes[id] = n
        return n
    }
    func moveNote(_ id: String, to folderId: String?) async throws -> Note {
        try online(); guard var n = notes[id] else { throw CairnError.notFound }
        n.folderId = folderId; notes[id] = n; return n
    }
    func deleteNote(_ id: String) async throws {
        try online(); calls.append("delete \(id)")
        guard notes.removeValue(forKey: id) != nil else { throw CairnError.notFound }
    }
}

final class OfflineTests: XCTestCase {
    /// What the app does: send the changes one by one until done or offline.
    func push(_ state: inout OfflineState, _ api: FakeServer) async {
        while let op = state.begin() {
            do {
                let result = try await Sync.send(op, latest: state.note(op.noteID), api: api)
                state.finish(op, result)
            } catch {
                state.abort()
                return
            }
        }
    }

    func pull(_ state: inout OfflineState, _ api: FakeServer) async throws {
        let ids = state.merge(serverNotes: try await api.notes(), folders: try await api.folders())
        for id in ids { state.store(try await api.note(id)) }
    }

    func testWritesOfflineThenSends() async throws {
        let api = FakeServer()
        _ = api.add("a", "VPS", "ssh")
        var state = OfflineState()
        try await pull(&state, api)
        XCTAssertEqual(state.note("a")?.content, "ssh")

        api.offline = true
        state.editLocal("a", title: "VPS", content: "ssh antoine-vps")
        state.editLocal("a", title: "VPS", content: "ssh antoine-vps -p 22")
        let local = state.createLocal(folderId: nil)
        state.editLocal(local.id, title: "Idée", content: "train")
        XCTAssertEqual(state.pending.count, 2, "edits of a note are merged into one change")
        await push(&state, api)
        XCTAssertEqual(state.pending.count, 2, "nothing lost while offline")

        api.offline = false
        await push(&state, api)
        XCTAssertTrue(state.pending.isEmpty)
        XCTAssertEqual(api.notes["a"]?.content, "ssh antoine-vps -p 22")
        let created = try XCTUnwrap(api.notes.values.first { $0.title == "Idée" })
        XCTAssertEqual(created.content, "train")
        XCTAssertEqual(state.resolve(local.id), created.id, "the local id now points to the server's")
        XCTAssertFalse(state.notes.contains { $0.id.hasPrefix("local-") })
    }

    func testEditWhileCreatingKeepsBoth() async throws {
        let api = FakeServer()
        var state = OfflineState()
        let local = state.createLocal(folderId: nil)
        let op = try XCTUnwrap(state.begin())
        // Typed while the creation travels: a separate change, sent after, from the new version.
        state.editLocal(local.id, title: "Plus tard", content: "texte")
        let result = try await Sync.send(op, latest: state.note(op.noteID), api: api)
        state.finish(op, result)
        await push(&state, api)
        XCTAssertEqual(api.notes.values.first?.content, "texte")
        XCTAssertEqual(api.calls.filter { $0.hasPrefix("update") }.count, 1)
        XCTAssertTrue(state.pending.isEmpty)
    }

    func testConflictKeepsBothVersions() async throws {
        let api = FakeServer()
        _ = api.add("a", "Courses", "pain")
        var state = OfflineState()
        try await pull(&state, api)
        state.editLocal("a", title: "Courses", content: "pain, lait")
        // Meanwhile on the web:
        _ = try await api.updateNote("a", title: "Courses", content: "pain, œufs", ifUpdatedAt: nil)
        await push(&state, api)
        XCTAssertEqual(api.notes["a"]?.content, "pain, œufs", "the other version is not overwritten")
        let copy = try XCTUnwrap(api.notes.values.first { $0.title == "Courses (conflit)" })
        XCTAssertEqual(copy.content, "pain, lait")
        XCTAssertEqual(state.note("a")?.content, "pain, œufs")
        XCTAssertNotNil(state.notes.first { $0.id == copy.id })
    }

    func testConflictOnLockedNoteSendsNothingReadable() async throws {
        let api = FakeServer()
        _ = api.add("a", "Secret", "v1.old", encrypted: true)
        var state = OfflineState()
        try await pull(&state, api)
        state.editLocal("a", title: "Secret", content: "v1.mine")
        _ = try await api.updateNote("a", title: "Secret", content: "v1.theirs", ifUpdatedAt: nil)
        await push(&state, api)
        let copy = try XCTUnwrap(api.notes.values.first { $0.title == "Secret (conflit)" })
        XCTAssertTrue(copy.encrypted)
        XCTAssertEqual(copy.content, "v1.mine")
    }

    func testDeleteOfUnsentNoteSendsNothing() async {
        let api = FakeServer()
        var state = OfflineState()
        let local = state.createLocal(folderId: nil)
        state.editLocal(local.id, title: "Brouillon", content: "x")
        state.deleteLocal(local.id)
        XCTAssertTrue(state.pending.isEmpty)
        await push(&state, api)
        XCTAssertTrue(api.calls.isEmpty)
    }

    func testPullKeepsLocalChangesAndDropsDeletedNotes() async throws {
        let api = FakeServer()
        _ = api.add("a", "Garde", "1")
        _ = api.add("b", "Supprimée ailleurs", "2")
        var state = OfflineState()
        try await pull(&state, api)
        state.editLocal("a", title: "Garde", content: "modifiée ici")
        api.notes["b"] = nil
        _ = try await api.updateNote("a", title: "Garde", content: "modifiée là-bas", ifUpdatedAt: nil)
        try await pull(&state, api)
        XCTAssertEqual(state.note("a")?.content, "modifiée ici", "not replaced while a change waits")
        XCTAssertNil(state.note("b"))
        XCTAssertEqual(state.notes.map(\.id), ["a"])
    }

    func testOfflineSearch() async throws {
        let api = FakeServer()
        _ = api.add("a", "Serveur", "Config de Caddy pour le VPS")
        _ = api.add("b", "Coffre", "v1.xxx", encrypted: true)
        var state = OfflineState()
        try await pull(&state, api)
        XCTAssertEqual(state.search("caddy").map(\.id), ["a"])
        XCTAssertEqual(state.search("serveur vps").map(\.id), ["a"])
        XCTAssertTrue(state.search("xxx").isEmpty, "locked notes are only found by title")
    }

    func testStateSurvivesDisk() throws {
        var state = OfflineState()
        _ = state.createLocal(folderId: "f")
        let data = try JSONEncoder().encode(state)
        let back = try JSONDecoder().decode(OfflineState.self, from: data)
        XCTAssertEqual(back.pending, state.pending)
    }
}
