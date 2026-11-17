import CairnKit
import SwiftUI

@MainActor
@Observable
final class AutoFillModel {
    private(set) var snapshot = VaultCache.load()
    private(set) var items: [VaultItem] = []
    private(set) var unlocked = false
    private(set) var sites: [String] = []
    private var recordID: String?
    let complete: (VaultItem) -> Void
    let cancel: () -> Void

    init(complete: @escaping (VaultItem) -> Void, cancel: @escaping () -> Void) {
        self.complete = complete
        self.cancel = cancel
    }

    var biometrics: Bool { VaultKeyStore.isEnabled }

    /// Logins with a password, those of the site first.
    var matches: [VaultItem] { logins(usable, matching: sites) }
    var others: [VaultItem] {
        let ids = Set(matches.map(\.id))
        return usable.filter { !ids.contains($0.id) }
    }

    private var usable: [VaultItem] {
        items.filter { $0.data.type == .login && !($0.data.password ?? "").isEmpty }
            .sorted { $0.data.name.localizedStandardCompare($1.data.name) == .orderedAscending }
    }

    func start(sites: [String], recordID: String?) {
        self.sites = sites
        self.recordID = recordID
        snapshot = VaultCache.load()
    }

    func unlockWithBiometrics() async {
        let key = await Task.detached(priority: .userInitiated) { VaultKeyStore.read(reason: "Remplir avec Cairn") }.value
        if let key { opened(key) }
    }

    func unlock(password: String) async throws {
        guard let meta = snapshot?.meta else { return }
        let key = try await Task.detached(priority: .userInitiated) { try VaultKey.unlock(password: password, meta: meta) }.value
        opened(key)
    }

    private func opened(_ key: VaultKey) {
        items = (snapshot?.items ?? []).compactMap { try? key.decrypt($0) }
        unlocked = true
        // Picked from the suggestions above the keyboard: fill it straight away.
        if let recordID, let item = items.first(where: { $0.id == recordID }) { complete(item) }
    }
}

struct AutoFillView: View {
    let model: AutoFillModel
    @State private var password = ""
    @State private var error: String?
    @State private var working = false
    @State private var query = ""

    var body: some View {
        NavigationStack {
            Group {
                if model.snapshot == nil {
                    ContentUnavailableView("Ouvre Cairn d'abord", systemImage: "lock", description: Text("Connecte-toi dans l'app Cairn et ouvre le coffre une fois : le remplissage automatique s'en sert ensuite, même sans réseau."))
                } else if !model.unlocked {
                    unlockForm
                } else {
                    list
                }
            }
            .navigationTitle("Cairn")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { model.cancel() } }
            }
        }
        .task {
            if model.snapshot != nil, model.biometrics, !model.unlocked { await model.unlockWithBiometrics() }
        }
    }

    private var unlockForm: some View {
        VStack(spacing: 14) {
            Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(Color.accentColor)
            Text("Mot de passe maître du coffre").font(.headline)
            SecureField("Mot de passe maître", text: $password)
                .textFieldStyle(.roundedBorder)
                .onSubmit(unlock)
                .frame(maxWidth: 320)
            if let error { Text(error).foregroundStyle(.red).font(.callout) }
            HStack {
                Button(action: unlock) {
                    if working { ProgressView().controlSize(.small) } else { Text("Déverrouiller") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(password.isEmpty || working)
                if model.biometrics {
                    Button(VaultKeyStore.biometryName, systemImage: "faceid") { Task { await model.unlockWithBiometrics() } }
                        .buttonStyle(.bordered)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var list: some View {
        List {
            let q = query.lowercased()
            let keep = { (item: VaultItem) in
                q.isEmpty || [item.data.name, item.data.username, item.data.url].compactMap { $0?.lowercased() }.contains { $0.contains(q) }
            }
            let matches = model.matches.filter(keep)
            let others = model.others.filter(keep)
            if !matches.isEmpty {
                Section("Pour ce site") { ForEach(matches) { row($0) } }
            }
            if !others.isEmpty {
                Section(matches.isEmpty ? "Identifiants" : "Autres identifiants") { ForEach(others) { row($0) } }
            }
            if matches.isEmpty && others.isEmpty {
                Text("Aucun identifiant").foregroundStyle(.secondary)
            }
        }
        .searchable(text: $query, prompt: "Rechercher")
    }

    private func row(_ item: VaultItem) -> some View {
        Button { model.complete(item) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.data.name.isEmpty ? "Sans nom" : item.data.name).foregroundStyle(.primary)
                Text([item.data.username, item.data.domain].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func unlock() {
        guard !password.isEmpty, !working else { return }
        working = true
        error = nil
        Task {
            defer { working = false }
            do { try await model.unlock(password: password) } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
