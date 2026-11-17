import CairnKit
import Foundation
import Observation

/// The vault in the app. Items arrive encrypted and are opened here, on the device, with the vault
/// key. Like on the web, the key only lives in memory and the vault locks itself after 10 minutes
/// without use, or when the app goes to the background. With Face ID / Touch ID turned on, the key
/// also sits in the Keychain behind a biometric check (see VaultKeyStore).
@MainActor
@Observable
final class VaultModel {
    private(set) var meta: VaultMeta?
    private(set) var rows: [VaultItemRow] = []
    private(set) var items: [VaultItem] = []
    private(set) var key: VaultKey?
    /// `nil` until the server answered; false when the vault was never created (on the web).
    private(set) var exists: Bool?
    private(set) var undecryptable = 0
    var selectedItemID: String?
    var biometricsEnabled = VaultKeyStore.isEnabled

    var isUnlocked: Bool { key != nil }

    private static let autoLock: Duration = .seconds(10 * 60)
    private var lockTask: Task<Void, Never>?

    // MARK: Loading

    func load(_ client: CairnClient) async throws {
        let (meta, rows) = try await client.vault()
        self.meta = meta
        self.rows = rows
        exists = meta != nil
        if let meta { VaultCache.save(meta: meta, items: rows) }
        decryptAll()
    }

    // MARK: Locking

    func unlock(password: String) async throws {
        guard let meta else { throw VaultError.unsupported("coffre introuvable") }
        // Argon2id takes a moment and 64 MiB: off the main thread.
        let key = try await Task.detached(priority: .userInitiated) {
            try VaultKey.unlock(password: password, meta: meta)
        }.value
        opened(with: key)
    }

    /// Returns false when cancelled, or when Face ID / Touch ID no longer opens the stored key.
    @discardableResult
    func unlockWithBiometrics() async -> Bool {
        guard biometricsEnabled else { return false }
        let reason = "Déverrouiller le coffre de Cairn"
        let key = await Task.detached(priority: .userInitiated) { VaultKeyStore.read(reason: reason) }.value
        guard let key else {
            // The system drops the item when Face ID or fingerprints change: back to the password.
            biometricsEnabled = VaultKeyStore.isEnabled
            return false
        }
        opened(with: key)
        return true
    }

    func setBiometrics(_ on: Bool) throws {
        if on {
            guard let key else { return }
            try VaultKeyStore.save(key)
        } else {
            VaultKeyStore.disable()
        }
        biometricsEnabled = VaultKeyStore.isEnabled
    }

    /// Called just before the key is forgotten, while it still works: an open locked note saves
    /// what was typed.
    var willLock: [String: () -> Void] = [:]

    func lock() {
        for handler in willLock.values { handler() }
        key = nil
        items = []
        selectedItemID = nil
        lockTask?.cancel()
    }

    /// Signing out forgets everything on this device.
    func forget() {
        lock()
        meta = nil
        rows = []
        exists = nil
        VaultKeyStore.disable()
        biometricsEnabled = false
        VaultCache.clear()
        AutoFillIdentities.clear()
    }

    /// Each use of the key pushes the auto-lock back.
    func touch() {
        guard key != nil else { return }
        lockTask?.cancel()
        lockTask = Task { [weak self] in
            try? await Task.sleep(for: Self.autoLock)
            guard !Task.isCancelled else { return }
            self?.lock()
        }
    }

    private func opened(with key: VaultKey) {
        self.key = key
        decryptAll()
        touch()
        AutoFillIdentities.replace(with: items)
    }

    private func decryptAll() {
        guard let key else { items = []; return }
        var failed = 0
        items = rows.compactMap { row in
            do { return try key.decrypt(row) } catch { failed += 1; return nil }
        }
        .sorted { $0.data.name.localizedStandardCompare($1.data.name) == .orderedAscending }
        undecryptable = failed
    }

    // MARK: Items

    func save(_ data: VaultItemData, id: String?, client: CairnClient) async throws -> VaultItem {
        guard let key else { throw VaultError.unsupported("coffre verrouillé") }
        touch()
        let blob = try key.encrypt(data)
        let row: VaultItemRow
        if let id { row = try await client.updateVaultItem(id, blob) } else { row = try await client.addVaultItem(blob) }
        rows.removeAll { $0.id == row.id }
        rows.insert(row, at: 0)
        if let meta { VaultCache.save(meta: meta, items: rows) }
        decryptAll()
        AutoFillIdentities.replace(with: items)
        return VaultItem(id: row.id, updatedAt: row.updatedAt, data: data)
    }

    func delete(_ id: String, client: CairnClient) async throws {
        touch()
        try await client.deleteVaultItem(id)
        rows.removeAll { $0.id == id }
        if let meta { VaultCache.save(meta: meta, items: rows) }
        decryptAll()
        if selectedItemID == id { selectedItemID = nil }
        AutoFillIdentities.replace(with: items)
    }

    // MARK: Locked notes

    func decryptNote(_ blob: String) throws -> String {
        guard let key else { throw VaultError.unsupported("coffre verrouillé") }
        touch()
        return try key.decrypt(blob)
    }

    func encryptNote(_ text: String) throws -> String {
        // Never fall back to saving readable text for a note meant to be encrypted.
        guard let key else { throw CairnError.server(0, "Le coffre s'est verrouillé. Déverrouille-le pour enregistrer.") }
        touch()
        return try key.encrypt(text)
    }
}
