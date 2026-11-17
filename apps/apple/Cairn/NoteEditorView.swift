import CairnKit
import SwiftUI

/// One note: the Markdown as typed, or read with its formatting. Saves by itself a moment after the
/// last change, like the web app. Each save says which version it started from: when the note was
/// changed on another device meanwhile, nothing is overwritten and the app asks which one to keep.
struct NoteEditorView: View {
    @Environment(AppModel.self) private var model
    let noteID: String

    @State private var note: Note?
    @State private var title = ""
    @State private var content = ""
    @State private var reading = false
    @State private var saveState = SaveState.saved
    @State private var conflict: Note?
    @State private var loadError: String?
    @State private var saveTask: Task<Void, Never>?

    enum SaveState { case saved, pending, saving, failed }

    var body: some View {
        Group {
            if let note, note.encrypted {
                ContentUnavailableView {
                    Label("Note chiffrée", systemImage: "lock.fill")
                } description: {
                    Text("Ouvre-la sur le web pour l'instant : le déchiffrement arrive dans une prochaine version de l'app.")
                }
            } else if note != nil {
                editor
            } else if let loadError {
                ContentUnavailableView("Impossible d'ouvrir la note", systemImage: "exclamationmark.triangle", description: Text(loadError))
            } else {
                ProgressView()
            }
        }
        .task { await load() }
        .onDisappear { flush() }
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
            TextField("Sans titre", text: $title, axis: .vertical)
                .font(.title.bold())
                .textFieldStyle(.plain)
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 8)
                .onChange(of: title) { scheduleSave() }
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
            apply(n)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            if case CairnError.unauthorized = error { model.report(error) }
        }
    }

    private func apply(_ n: Note) {
        note = n
        title = n.title
        content = n.content
        saveState = .saved
    }

    private var isDirty: Bool { note.map { $0.title != title || $0.content != content } ?? false }

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

    /// Leaving the note: whatever is still waiting is sent now, without this view (it is going
    /// away). If the note changed elsewhere meanwhile, the text is kept in a copy rather than lost.
    private func flush() {
        guard isDirty, let client = model.client, let base = note else { return }
        saveTask?.cancel()
        let (sentTitle, sentContent, model) = (title, content, model)
        Task { @MainActor in
            do {
                model.didSave(try await client.updateNote(base.id, title: sentTitle, content: sentContent, ifUpdatedAt: base.updatedAt))
            } catch CairnError.conflict {
                let name = sentTitle.isEmpty ? "Sans titre" : sentTitle
                if let copy = try? await client.createNote(title: "\(name) (conflit)", content: sentContent, folderId: base.folderId) {
                    model.didSave(copy)
                    model.errorMessage = "« \(name) » a changé sur un autre appareil : ta version est gardée dans une copie."
                }
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
            let saved = try await client.updateNote(base.id, title: sentTitle, content: sentContent, ifUpdatedAt: base.updatedAt)
            note = saved
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
