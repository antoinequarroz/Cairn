#if canImport(Security)
import Foundation
import LocalAuthentication
import Security

/// The session token stays in the Keychain, never in UserDefaults. Items go to the app's shared
/// Keychain group (the first of `keychain-access-groups`), so the AutoFill extension reads them too.
/// On a Mac build signed without a team, the shared Keychain is refused: the app falls back to the
/// login Keychain, and only the app (not AutoFill) sees the item.
public enum Keychain {
    private static let service = "ch.antoinequarroz.cairn.session"

    public static func save(_ value: String, account: String) {
        delete(account: account)
        var query = base(account)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(query as CFDictionary, nil) == errSecMissingEntitlement {
            query[kSecUseDataProtectionKeychain as String] = false
            SecItemAdd(query as CFDictionary, nil)
        }
    }

    public static func read(account: String) -> String? {
        for shared in [true, false] {
            var query = base(account, shared: shared)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
                return String(data: data, encoding: .utf8)
            }
        }
        return nil
    }

    public static func delete(account: String) {
        SecItemDelete(base(account, shared: true) as CFDictionary)
        SecItemDelete(base(account, shared: false) as CFDictionary)
    }

    private static func base(_ account: String, shared: Bool = true) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: shared,
        ]
    }
}

/// The vault key, kept in the Keychain behind Face ID / Touch ID when the person turns it on. The
/// item only opens after a biometric check, never leaves the device, and is dropped by the system
/// if Face ID or fingerprints change (`biometryCurrentSet`). Without it, the vault key only ever
/// lives in memory, like on the web.
public enum VaultKeyStore {
    private static let service = "ch.antoinequarroz.cairn.vault-key"
    private static let account = "vault"

    public static var biometryAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    /// "Face ID", "Touch ID" or "Optic ID", for the labels.
    public static var biometryName: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Face ID"
        }
    }

    /// Whether a key is stored, without asking for Face ID.
    public static var isEnabled: Bool {
        let context = LAContext()
        context.interactionNotAllowed = true
        var query = base
        query[kSecUseAuthenticationContext as String] = context
        query[kSecReturnAttributes as String] = true
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    public static func save(_ key: VaultKey) throws {
        disable()
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error) else {
            throw error!.takeRetainedValue() as Error
        }
        var query = base
        query[kSecValueData as String] = key.rawValue
        query[kSecAttrAccessControl as String] = access
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    /// Asks for Face ID / Touch ID and returns the key, or nil when cancelled or turned off.
    /// Blocks while the system sheet is up: call it off the main thread.
    public static func read(reason: String) -> VaultKey? {
        let context = LAContext()
        context.localizedReason = reason
        context.localizedFallbackTitle = ""
        var query = base
        query[kSecUseAuthenticationContext as String] = context
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? VaultKey(rawValue: data)
    }

    public static func disable() {
        SecItemDelete(base as CFDictionary)
    }

    private static var base: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }
}
#endif
