import CairnKit
import SwiftUI

/// One note: the Markdown as typed, or read with its formatting. Saves by itself a moment after the
/// last change, like the web app. Each save says which version it started from: when the note was
/// changed on another device meanwhile, nothing is overwritten and the app asks which one to keep.
///
/// A locked note (cadenas) is opened with the vault key, on the device, and encrypted again before
/// each save. Its title stays readable, as on the web.
struct NoteEditorView: View {
    @Environment(AppModel.self) private var model
    let noteID: String

    /// The server's version (for a locked note, `content` is the encrypted blob).
    @State private var note: Note?
    /// The readable title and text of that version: what the fields are compared to.
    @State private var baseTitle = ""
    @State private var baseContent = ""
    @State private var title = ""
    @State private var content = ""
    @State private var opened = false
    @State private var reading = false
    @State private var saveState = SaveState.saved
    @State private var conflict: Note?
    @State private var loadError: String?
    @State private var saveTask: Task<Void, Never>?
    @State private var handlerID = UUID().uuidString

    enum SaveState { case saved, pending, saving, failed }

    var body: some View {
        Group {
            if opened {
                editor
            } else if let note, note.encrypted {
                VaultUnlockView(message: "« \(note.title.isEmpty ? "Sans titre" : note.title) » est chiffrée de bout en bout avec la clé du coffre.")
            } else if let loadError {
                ContentUnavailableView("Impossible d'ouvrir la note", systemImage: "exclamationmark.triangle", description: Text(loadError))
            } else {
                ProgressView()
            }
        }
        .task { await load() }
        .onChange(of: model.vault.isUnlocked) { _, unlocked in
            if unlocked, let note, note.encrypted, !opened { apply(note) }
            // Locked again: the readable text leaves the screen (it was saved just before).
            if !unlocked, note?.encrypted == true { opened = false }
        }
        .onAppear {
            model.vault.willLock[handlerID] = { flush() }
        }
        .onDisappear {
            flush()
            model.vault.willLock[handlerID] = nil
        }
        .alert("Modifiée ailleurs", isPresented: Binding(get: { conflict != nil }, set: { if !$0 { conflict = nil } })) {
            Button("Garder ma version") { keepMine() }
            Button("Prendre celle du serveur") { takeServer() }
            Button("Annuler", role: .cancel) {}
        } message: {
            Text("Cette note a changé sur un autre appareil depuis que tu l'as ouverte. Quelle version garder ?")
        }
    }

    private var editor: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                if note?.encrypted == true {
                    Image(systemName: "lock.fill").foregroundStyle(Color.cairnAccent).help("Note chiffrée de bout en bout")
                }
                TextField("Sans titre", text: $title, axis: .vertical)
                    .font(.title.bold())
                    .textFieldStyle(.plain)
                    .onChange(of: title) { scheduleSave() }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 8)
            Divider()
            if reading {
                ScrollView {
                    MarkdownView(source: content)
                        .padding(20)
                        .frame(maxWidth: 760, alignment: .leading)
                        .frame(maxWidth: .infinity)
                }
            } else {
                TextEditor(text: $content)
                    .font(.system(.body, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 8)
                    .autocorrectionDisabled()
                    .onChange(of: content) { scheduleSave() }
            }
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .status) { saveLabel }
            ToolbarItem(placement: .primaryAction) {
                Picker("Mode", selection: $reading) {
                    Label("Écrire", systemImage: "pencil").tag(false)
                    Label("Lire", systemImage: "eye").tag(true)
                }
                .pickerStyle(.segmented)
                .help("Basculer entre le Markdown et la lecture")
            }
        }
    }

    @ViewBuilder private var saveLabel: some View {
        switch saveState {
        case .saved: Text("Enregistré").foregroundStyle(.secondary).font(.caption)
        case .pending, .saving: Text("Enregistrement…").foregroundStyle(.secondary).font(.caption)
        case .failed:
            Button("Réessayer") { Task { await save(force: false) } }.font(.caption).foregroundStyle(.red)
        }
    }

    // MARK: Loading and saving

    private func load() async {
        guard let client = model.client else { return }
        do {
            let n = try await client.note(noteID)
            note = n
            apply(n)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            if case CairnError.unauthorized = error { model.report(error) }
        }
    }

    /// Shows a version of the note, decrypted when it is locked and the vault is open.
    private func apply(_ n: Note) {
        note = n
        var text = n.content
        if n.encrypted {
            guard model.vault.isUnlocked else { opened = false; return }
            do {
                text = try model.vault.decryptNote(n.content)
            } catch {
                opened = false
                loadError = "Cette note n'a pas pu être déchiffrée avec ce coffre."
                return
            }
        }
        baseTitle = n.title
        baseContent = text
        title = n.title
        content = text
        opened = true
        saveState = .saved
    }

    private var isDirty: Bool { opened && (title != baseTitle || content != baseContent) }

    /// What goes to the server: the text, or for a locked note its encrypted form.
    private func stored(_ text: String) throws -> String {
        note?.encrypted == true ? try model.vault.encryptNote(text) : text
    }

    private func scheduleSave() {
        guard isDirty else { return }
        saveState = .pending
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            await save(force: false)
        }
    }

    /// Leaving the note, or the vault about to lock: whatever is still waiting is sent now, without
    /// this view (it may be going away). If the note changed elsewhere meanwhile, the text is kept
    /// in a copy rather than lost, encrypted too when the note was.
    private func flush() {
        guard isDirty, let client = model.client, let base = note else { return }
        saveTask?.cancel()
        let (sentTitle, sentContent, model) = (title, content, model)
        let blob: String
        do { blob = try stored(sentContent) } catch { model.report(error); return }
        baseTitle = sentTitle
        baseContent = sentContent
        Task { @MainActor in
            do {
                model.didSave(try await client.updateNote(base.id, title: sentTitle, content: blob, ifUpdatedAt: base.updatedAt))
            } catch CairnError.conflict {
                let name = sentTitle.isEmpty ? "Sans titre" : sentTitle
                // A copy of a locked note is created empty, then gets the encrypted text: nothing readable is sent.
                guard var copy = try? await client.createNote(title: "\(name) (conflit)", content: base.encrypted ? "" : sentContent, folderId: base.folderId) else { return }
                if base.encrypted, let locked = try? await client.lockNote(copy.id, title: copy.title, blob: blob) { copy = locked }
                model.didSave(copy)
                model.errorMessage = "« \(name) » a changé sur un autre appareil : ta version est gardée dans une copie."
            } catch {
                model.report(error)
            }
        }
    }

    /// `force`: save even with no change (after "Garder ma version", on top of the server's version).
    private func save(force: Bool) async {
        guard let client = model.client, let base = note, isDirty || force else { return }
        saveState = .saving
        let sentTitle = title
        let sentContent = content
        do {
            let saved = try await client.updateNote(base.id, title: sentTitle, content: try stored(sentContent), ifUpdatedAt: base.updatedAt)
            note = saved
            baseTitle = sentTitle
            baseContent = sentContent
            model.didSave(saved)
            // Typed again while it was saving: the next save starts from this version.
            if title != sentTitle || content != sentContent { scheduleSave() } else { saveState = .saved }
        } catch let CairnError.conflict(server) {
            saveState = .failed
            conflict = server
        } catch {
            saveState = .failed
            model.report(error)
        }
    }

    private func keepMine() {
        guard let server = conflict else { return }
        conflict = nil
        note = server
        Task { await save(force: true) }
    }

    private func takeServer() {
        guard let server = conflict else { return }
        conflict = nil
        apply(server)
        model.didSave(server)
    }
}
