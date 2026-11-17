import CairnKit
import SwiftUI

/// One note: the Markdown as typed, or read with its formatting. Saves by itself a moment after the
/// last change, on the device first, then on the server as soon as it can be reached (see
/// AppModel). When the note changed on another device meanwhile, nothing is overwritten: the
/// version written here becomes a copy.
///
/// A locked note (cadenas) is opened with the vault key, on the device, and encrypted again before
/// each save: the copy on the device and the changes waiting to be sent stay encrypted. Its title
/// stays readable, as on the web.
struct NoteEditorView: View {
    @Environment(AppModel.self) private var model
    let noteID: String

    /// The version opened (for a locked note, `content` is the encrypted blob).
    @State private var note: Note?
    /// The readable title and text last saved: what the fields are compared to.
    @State private var baseTitle = ""
    @State private var baseContent = ""
    @State private var title = ""
    @State private var content = ""
    @State private var opened = false
    @State private var reading = false
    @State private var dirty = false
    @State private var loadError: String?
    @State private var saveTask: Task<Void, Never>?
    @State private var handlerID = UUID().uuidString

    var body: some View {
        Group {
            if opened {
                editor
            } else if let note, note.encrypted, loadError == nil {
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
        if dirty || (model.isWaiting(noteID) && model.isSyncing) {
            Text("Enregistrement…").foregroundStyle(.secondary).font(.caption)
        } else if model.isWaiting(noteID) {
            Label("Enregistré sur l'appareil, envoi dès que possible", systemImage: "icloud.slash")
                .labelStyle(.titleAndIcon).foregroundStyle(.secondary).font(.caption)
        } else {
            Text("Enregistré").foregroundStyle(.secondary).font(.caption)
        }
    }

    // MARK: Loading and saving

    private func load() async {
        do {
            let n = try await model.openNote(noteID)
            note = n
            apply(n)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
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
        dirty = false
        opened = true
    }

    private var isDirty: Bool { opened && (title != baseTitle || content != baseContent) }

    private func scheduleSave() {
        guard isDirty else { return }
        dirty = true
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            flush()
        }
    }

    /// Saves now: on leaving the note, when the vault is about to lock, or after a pause in typing.
    private func flush() {
        saveTask?.cancel()
        guard isDirty else { dirty = false; return }
        do {
            // Never save readable text for a note meant to be encrypted.
            let stored = note?.encrypted == true ? try model.vault.encryptNote(content) : content
            model.saveNote(noteID, title: title, content: stored)
            baseTitle = title
            baseContent = content
            dirty = false
        } catch {
            model.report(error)
        }
    }
}
