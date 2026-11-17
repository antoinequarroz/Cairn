import CairnKit
import SwiftUI

/// Asks for the master password (or Face ID / Touch ID) to open the vault. Used by the vault and
/// by locked notes.
struct VaultUnlockView: View {
    @Environment(AppModel.self) private var model
    var message = "Le coffre est chiffré sur cet appareil. Le serveur ne voit jamais son contenu."
    @State private var password = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var vault: VaultModel { model.vault }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.fill").font(.system(size: 36)).foregroundStyle(Color.cairnAccent)
            Text("Coffre verrouillé").font(.title2.bold())
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if vault.exists == false {
                Text("Crée d'abord le coffre sur le web, dans la page Coffre.").foregroundStyle(.secondary)
            } else {
                SecureField("Mot de passe maître", text: $password)
                    .textContentType(.password)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onSubmit(unlock)
                    .frame(maxWidth: 320)
                if let error { Text(error).foregroundStyle(.red).font(.callout) }
                HStack {
                    Button(action: unlock) {
                        if working { ProgressView().controlSize(.small) } else { Text("Déverrouiller") }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(password.isEmpty || working || vault.meta == nil)
                    if vault.biometricsEnabled {
                        Button {
                            Task { await vault.unlockWithBiometrics() }
                        } label: {
                            Label(VaultKeyStore.biometryName, systemImage: "faceid")
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            // Face ID straight away when it is on; the field otherwise.
            if vault.biometricsEnabled, !vault.isUnlocked, await vault.unlockWithBiometrics() { return }
            focused = true
        }
    }

    private func unlock() {
        guard !password.isEmpty, !working else { return }
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                try await vault.unlock(password: password)
                password = ""
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

/// The content column when "Coffre" is chosen in the sidebar.
struct VaultList: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var creating: VaultItemData.Kind?

    private var vault: VaultModel { model.vault }

    var body: some View {
        @Bindable var vault = vault
        Group {
            if vault.isUnlocked {
                List(selection: $vault.selectedItemID) {
                    if vault.undecryptable > 0 {
                        Label("\(vault.undecryptable) élément(s) illisible(s) avec cette clé", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                    ForEach(VaultItemData.Kind.allCases, id: \.self) { kind in
                        let items = filtered.filter { $0.data.type == kind }
                        if !items.isEmpty {
                            Section(kind.title) {
                                ForEach(items) { item in
                                    VaultRow(item: item).tag(item.id)
                                }
                            }
                        }
                    }
                }
                .searchable(text: $query, prompt: "Rechercher dans le coffre")
                .overlay {
                    if vault.items.isEmpty { ContentUnavailableView("Coffre vide", systemImage: "key") }
                }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            ForEach(VaultItemData.Kind.allCases, id: \.self) { kind in
                                Button(kind.title, systemImage: kind.icon) { creating = kind }
                            }
                        } label: {
                            Label("Ajouter", systemImage: "plus")
                        }
                    }
                    ToolbarItem {
                        Menu {
                            if VaultKeyStore.biometryAvailable {
                                Toggle("Déverrouiller avec \(VaultKeyStore.biometryName)", isOn: Binding(
                                    get: { vault.biometricsEnabled },
                                    set: { on in
                                        do { try vault.setBiometrics(on) } catch { model.report(error) }
                                    }
                                ))
                            }
                            Button("Verrouiller", systemImage: "lock") { vault.lock() }
                        } label: {
                            Label("Options du coffre", systemImage: "ellipsis.circle")
                        }
                    }
                }
                .sheet(item: $creating) { kind in
                    VaultItemEditor(initial: VaultItemData(type: kind), id: nil)
                }
            } else {
                VaultUnlockView()
            }
        }
        .refreshable { await model.reload() }
        #if os(macOS)
        .navigationSplitViewColumnWidth(min: 240, ideal: 300)
        #endif
    }

    private var filtered: [VaultItem] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return vault.items }
        return vault.items.filter { item in
            [item.data.name, item.data.username, item.data.url, item.data.host].compactMap { $0?.lowercased() }.contains { $0.contains(q) }
        }
    }
}

private struct VaultRow: View {
    let item: VaultItem

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.data.name.isEmpty ? "Sans nom" : item.data.name).lineLimit(1)
                if let sub = subtitle { Text(sub).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
        } icon: {
            Image(systemName: item.data.type.icon).foregroundStyle(Color.cairnAccent)
        }
    }

    private var subtitle: String? {
        switch item.data.type {
        case .login: [item.data.username, item.data.domain].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ").nilIfEmpty
        case .ssh: item.data.host?.nilIfEmpty
        case .secret: nil
        }
    }
}

/// The detail column: one item, every field with a copy button, secrets hidden until shown.
struct VaultItemView: View {
    @Environment(AppModel.self) private var model
    let itemID: String
    @State private var editing = false
    @State private var confirmDelete = false

    private var item: VaultItem? { model.vault.items.first { $0.id == itemID } }

    var body: some View {
        if let item {
            Form {
                Section {
                    Field(label: "Nom", value: item.data.name)
                    if item.data.type == .login {
                        Field(label: "Identifiant", value: item.data.username)
                        Field(label: "Mot de passe", value: item.data.password, secret: true)
                        Field(label: "Adresse", value: item.data.url, link: true)
                    }
                    if item.data.type == .ssh {
                        Field(label: "Hôte", value: item.data.host)
                        Field(label: "Utilisateur", value: item.data.username)
                        Field(label: "Clé publique", value: item.data.publicKey, mono: true)
                        Field(label: "Clé privée", value: item.data.privateKey, secret: true, mono: true)
                        Field(label: "Phrase de passe", value: item.data.passphrase, secret: true)
                    }
                }
                if let notes = item.data.notes, !notes.isEmpty {
                    Section("Notes") { Field(label: nil, value: notes, secret: item.data.type == .secret) }
                }
                Section {
                    Text("Modifié \(CairnDate.parse(item.updatedAt).map { $0.formatted(.relative(presentation: .named)) } ?? "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(item.data.name)
            .toolbar {
                ToolbarItem(placement: .primaryAction) { Button("Modifier") { editing = true } }
                ToolbarItem {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Supprimer", systemImage: "trash") }
                }
            }
            .sheet(isPresented: $editing) { VaultItemEditor(initial: item.data, id: item.id) }
            .confirmationDialog("Supprimer « \(item.data.name) » du coffre ?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Supprimer", role: .destructive) {
                    Task {
                        guard let client = model.client else { return }
                        do { try await model.vault.delete(item.id, client: client) } catch { model.report(error) }
                    }
                }
            }
        } else {
            ContentUnavailableView("Aucun élément ouvert", systemImage: "key")
        }
    }
}

/// One field: copy button, and hidden until "Afficher" for the secrets.
private struct Field: View {
    @Environment(AppModel.self) private var model
    let label: String?
    let value: String?
    var secret = false
    var mono = false
    var link = false
    @State private var shown = false
    @State private var copied = false

    var body: some View {
        if let value, !value.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if let label { Text(label).font(.caption).foregroundStyle(.secondary) }
                HStack(alignment: .firstTextBaseline) {
                    Group {
                        if secret && !shown {
                            Text(String(repeating: "•", count: min(value.count, 16)))
                        } else if link, let url = URL(string: value.contains("://") ? value : "https://" + value) {
                            Link(value, destination: url)
                        } else {
                            Text(value).textSelection(.enabled)
                        }
                    }
                    .font(mono ? .system(.callout, design: .monospaced) : .body)
                    .lineLimit(mono ? 4 : nil)
                    Spacer()
                    if secret {
                        Button(shown ? "Masquer" : "Afficher", systemImage: shown ? "eye.slash" : "eye") { shown.toggle(); model.vault.touch() }
                            .labelStyle(.iconOnly).buttonStyle(.borderless)
                    }
                    Button(copied ? "Copié" : "Copier", systemImage: copied ? "checkmark" : "doc.on.doc") { copy(value) }
                        .labelStyle(.iconOnly).buttonStyle(.borderless)
                }
            }
        }
    }

    private func copy(_ text: String) {
        model.vault.touch()
        Clipboard.copy(text, secret: secret)
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}

/// Creating or changing an item. Encrypted on the device before it leaves.
struct VaultItemEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var data: VaultItemData
    let id: String?
    @State private var saving = false
    @State private var error: String?

    init(initial: VaultItemData, id: String?) {
        _data = State(initialValue: initial)
        self.id = id
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Nom", text: $data.name)
                switch data.type {
                case .login:
                    TextField("Identifiant", text: binding(\.username)).textContentType(.username).autocorrectionDisabled()
                    HStack {
                        TextField("Mot de passe", text: binding(\.password)).font(.system(.body, design: .monospaced)).autocorrectionDisabled()
                        Button("Générer", systemImage: "dice") { data.password = generatePassword() }.labelStyle(.iconOnly)
                    }
                    TextField("Adresse (https://…)", text: binding(\.url)).textContentType(.URL).autocorrectionDisabled()
                case .ssh:
                    TextField("Hôte (vps.exemple.ch)", text: binding(\.host)).autocorrectionDisabled()
                    TextField("Utilisateur", text: binding(\.username)).autocorrectionDisabled()
                    TextField("Clé publique", text: binding(\.publicKey), axis: .vertical).font(.system(.caption, design: .monospaced)).lineLimit(2 ... 4)
                    TextField("Clé privée", text: binding(\.privateKey), axis: .vertical).font(.system(.caption, design: .monospaced)).lineLimit(3 ... 8)
                    SecureField("Phrase de passe", text: binding(\.passphrase))
                case .secret:
                    EmptyView()
                }
                Section("Notes") {
                    TextField("Notes", text: binding(\.notes), axis: .vertical).lineLimit(3 ... 12)
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .formStyle(.grouped)
            #if os(iOS)
            .textInputAutocapitalization(.never)
            #endif
            .navigationTitle(id == nil ? "Nouvel élément" : "Modifier")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer", action: save).disabled(saving || data.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 420)
        #endif
    }

    /// An optional field as a text field: empty means absent.
    private func binding(_ path: WritableKeyPath<VaultItemData, String?>) -> Binding<String> {
        Binding(get: { data[keyPath: path] ?? "" }, set: { data[keyPath: path] = $0.isEmpty ? nil : $0 })
    }

    private func save() {
        guard let client = model.client else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                let saved = try await model.vault.save(data, id: id, client: client)
                model.vault.selectedItemID = saved.id
                dismiss()
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

extension VaultItemData.Kind {
    var title: String {
        switch self {
        case .login: "Identifiants"
        case .ssh: "Clés SSH"
        case .secret: "Notes secrètes"
        }
    }

    var icon: String {
        switch self {
        case .login: "person.badge.key"
        case .ssh: "terminal"
        case .secret: "note.text"
        }
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// Copies text. A secret leaves the clipboard after 90 seconds, and on the iPhone it stays off
/// the other devices' clipboard (no Handoff).
enum Clipboard {
    static func copy(_ text: String, secret: Bool) {
        #if os(iOS)
        if secret {
            UIPasteboard.general.setItems([["public.utf8-plain-text": text]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(90)])
        } else {
            UIPasteboard.general.string = text
        }
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        if secret {
            let count = NSPasteboard.general.changeCount
            Task {
                try? await Task.sleep(for: .seconds(90))
                if NSPasteboard.general.changeCount == count { NSPasteboard.general.clearContents() }
            }
        }
        #endif
    }
}
