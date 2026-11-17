import CairnKit
import SwiftUI

/// Folders, then the notes of the chosen folder, then the note. On the iPhone the three columns
/// become screens pushed one after the other.
struct NotesView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var results: [SearchResult]?
    @State private var columns = NavigationSplitViewVisibility.all

    var body: some View {
        @Bindable var model = model
        NavigationSplitView(columnVisibility: $columns) {
            FolderSidebar()
        } content: {
            NoteList(query: $query, results: results)
                .navigationTitle(model.title(of: model.scope))
                .searchable(text: $query, prompt: "Rechercher dans les notes")
                .task(id: query) { await search() }
        } detail: {
            if let id = model.selectedNoteID {
                NoteEditorView(noteID: id).id(id)
            } else {
                ContentUnavailableView("Aucune note ouverte", systemImage: "doc.text", description: Text("Choisis une note ou crées-en une."))
            }
        }
        .task { await model.reload() }
        .alert("Cairn", isPresented: Binding(get: { model.errorMessage != nil && model.isSignedIn }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    /// The server's full-text search, a moment after the last key.
    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, let client = model.client else { results = nil; return }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        var folderId: String?
        if case let .folder(id) = model.scope { folderId = id }
        do {
            let found = try await client.search(q, folderId: folderId)
            results = found.filter { $0.kind == "note" }
        } catch {
            if !Task.isCancelled { model.report(error) }
        }
    }
}

private struct FolderSidebar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        List(selection: $model.scope) {
            Label("Toutes les notes", systemImage: "tray.full").tag(AppModel.Scope.all)
            if !model.folderTree.isEmpty {
                Section("Dossiers") {
                    OutlineGroup(model.folderTree, children: \.children) { node in
                        Label(node.folder.name, systemImage: node.folder.parentId == nil ? "folder.fill" : "folder")
                            .tag(AppModel.Scope.folder(node.id))
                    }
                }
            }
        }
        .navigationTitle("Cairn")
        #if os(macOS)
        .navigationSplitViewColumnWidth(min: 180, ideal: 220)
        #endif
        .toolbar {
            ToolbarItem {
                Menu {
                    Text(model.serverAddress)
                    Button("Actualiser") { Task { await model.reload() } }
                    Button("Se déconnecter", role: .destructive) { Task { await model.signOut() } }
                } label: {
                    Label("Compte", systemImage: "person.crop.circle")
                }
            }
        }
    }
}

private struct NoteList: View {
    @Environment(AppModel.self) private var model
    @Binding var query: String
    let results: [SearchResult]?

    var body: some View {
        @Bindable var model = model
        List(selection: $model.selectedNoteID) {
            if let results {
                if results.isEmpty {
                    Text("Aucun résultat").foregroundStyle(.secondary)
                }
                ForEach(results) { r in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(highlight(r.title.isEmpty ? "Sans titre" : r.title)).font(.headline).lineLimit(1)
                        if !r.snippet.isEmpty {
                            Text(highlight(r.snippet)).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    .tag(r.id)
                }
            } else {
                ForEach(model.visibleNotes) { note in
                    NoteRow(note: note)
                        .tag(note.id)
                        .contextMenu { rowMenu(note) }
                        .swipeActions {
                            Button(role: .destructive) { Task { await model.delete(note.id) } } label: {
                                Label("Supprimer", systemImage: "trash")
                            }
                        }
                }
            }
        }
        .overlay {
            if results == nil, model.visibleNotes.isEmpty, !model.isLoading {
                ContentUnavailableView("Pas encore de note", systemImage: "square.and.pencil")
            }
        }
        .refreshable { await model.reload() }
        #if os(macOS)
        .navigationSplitViewColumnWidth(min: 240, ideal: 300)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await model.createNote() } } label: {
                    Label("Nouvelle note", systemImage: "square.and.pencil")
                }
            }
        }
    }

    /// The matched words in bold and in the accent colour.
    private func highlight(_ marked: String) -> AttributedString {
        Highlighted(marked).parts.reduce(into: AttributedString()) { out, part in
            var piece = AttributedString(part.text)
            if part.match {
                piece.inlinePresentationIntent = .stronglyEmphasized
                piece.foregroundColor = Color.cairnAccent
            }
            out += piece
        }
    }

    @ViewBuilder private func rowMenu(_ note: NoteSummary) -> some View {
        Menu("Déplacer vers") {
            Button("Racine") { Task { await model.move(note.id, to: nil) } }
            ForEach(model.folders.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }) { f in
                Button(f.name) { Task { await model.move(note.id, to: f.id) } }
            }
        }
        Button("Supprimer", role: .destructive) { Task { await model.delete(note.id) } }
    }
}

private struct NoteRow: View {
    let note: NoteSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if note.encrypted { Image(systemName: "lock.fill").foregroundStyle(.secondary).font(.caption) }
                Text(note.displayTitle).font(.headline).lineLimit(1)
            }
            if !note.excerpt.isEmpty {
                Text(note.excerpt).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            if let date = note.updatedDate {
                Text(date, format: .relative(presentation: .named)).font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }
}
