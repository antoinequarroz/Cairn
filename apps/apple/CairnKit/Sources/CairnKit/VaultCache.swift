import Foundation
#if canImport(AuthenticationServices)
import AuthenticationServices
#endif

/// What the AutoFill extension needs to work without the network: the vault as the server sends it,
/// still encrypted, in the App Group shared by the app and the extension. Nothing readable is written.
public enum VaultCache {
    public static let appGroup = "group.ch.antoinequarroz.cairn"

    public struct Snapshot: Codable, Sendable {
        public var meta: VaultMeta
        public var items: [VaultItemRow]
        public var savedAt: Date
    }

    static var fileURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("vault.json")
    }

    public static func save(meta: VaultMeta, items: [VaultItemRow]) {
        guard let url = fileURL, let data = try? JSONEncoder().encode(Snapshot(meta: meta, items: items, savedAt: Date())) else { return }
        #if os(iOS)
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try? data.write(to: url, options: .atomic)
        #endif
    }

    public static func load() -> Snapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    public static func clear() {
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
    }
}

#if canImport(AuthenticationServices)
/// The list the system shows above the keyboard: for each login with an address, its domain and
/// username (never the password). Replaced as a whole after each unlock of the vault.
public enum AutoFillIdentities {
    public static func replace(with items: [VaultItem]) {
        let identities = items.compactMap { item -> ASPasswordCredentialIdentity? in
            guard item.data.type == .login, let domain = item.data.domain, let user = item.data.username, !user.isEmpty else { return nil }
            return ASPasswordCredentialIdentity(serviceIdentifier: ASCredentialServiceIdentifier(identifier: domain, type: .domain), user: user, recordIdentifier: item.id)
        }
        let store = ASCredentialIdentityStore.shared
        store.getState { state in
            guard state.isEnabled else { return }
            store.replaceCredentialIdentities(with: identities) { _, _ in }
        }
    }

    public static func clear() {
        ASCredentialIdentityStore.shared.removeAllCredentialIdentities { _, _ in }
    }
}
#endif

/// Which logins fit a site asking for a password: same domain, or a parent domain
/// ("accounts.google.com" finds the login saved for "google.com").
public func logins(_ items: [VaultItem], matching identifiers: [String]) -> [VaultItem] {
    let hosts = identifiers.compactMap { id -> String? in
        let full = id.contains("://") ? id : "https://" + id
        return URL(string: full)?.host?.lowercased()
    }
    guard !hosts.isEmpty else { return [] }
    return items.filter { item in
        guard item.data.type == .login, let domain = item.data.domain else { return false }
        let bare = domain.hasPrefix("www.") ? String(domain.dropFirst(4)) : domain
        return hosts.contains { $0 == bare || $0.hasSuffix("." + bare) || $0 == domain }
    }
}
