import CryptoKit
import Foundation
import Sodium

/// Public parameters of the vault, as the server stores them. Nothing here opens the vault without
/// the master password.
public struct VaultMeta: Codable, Hashable, Sendable {
    public struct KDF: Codable, Hashable, Sendable {
        public var name: String
        public var salt: String
        public var memoryKiB: Int
        public var iterations: Int
        public var parallelism: Int
    }

    public var v: Int
    public var kdf: KDF
    /// The vault key, encrypted with the key derived from the master password.
    public var wrappedKey: String
}

/// An item as the server stores it: one encrypted blob.
public struct VaultItemRow: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public var data: String
    public var updatedAt: String
}

/// What is inside an item's blob. Same fields as the web app (src/lib/types.ts). Fields this app
/// does not know (added later on the web) are kept as they are when the item is saved again.
public struct VaultItemData: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable, CaseIterable, Identifiable {
        case login, ssh, secret
        public var id: String { rawValue }
    }

    public var type: Kind
    public var name: String
    public var username: String?
    public var password: String?
    public var url: String?
    public var host: String?
    public var privateKey: String?
    public var publicKey: String?
    public var passphrase: String?
    public var notes: String?
    var extra: [String: JSONValue] = [:]

    public init(type: Kind, name: String = "") {
        self.type = type
        self.name = name
    }

    /// The domain of the login's address ("github.com"), for AutoFill.
    public var domain: String? {
        guard let url, !url.isEmpty else { return nil }
        let full = url.contains("://") ? url : "https://" + url
        return URL(string: full)?.host?.lowercased()
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ s: String) { stringValue = s }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    private static let known = ["type", "name", "username", "password", "url", "host", "privateKey", "publicKey", "passphrase", "notes"]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        // An unknown type (added later on the web) reads as a secret note rather than failing.
        type = (try? c.decode(Kind.self, forKey: Key("type"))) ?? .secret
        name = (try? c.decodeIfPresent(String.self, forKey: Key("name"))) ?? ""
        func str(_ k: String) -> String? { try? c.decodeIfPresent(String.self, forKey: Key(k)) }
        username = str("username")
        password = str("password")
        url = str("url")
        host = str("host")
        privateKey = str("privateKey")
        publicKey = str("publicKey")
        passphrase = str("passphrase")
        notes = str("notes")
        for key in c.allKeys where !Self.known.contains(key.stringValue) {
            extra[key.stringValue] = try c.decode(JSONValue.self, forKey: key)
        }
        if let raw = try? c.decode(String.self, forKey: Key("type")), Kind(rawValue: raw) == nil {
            extra["type"] = .string(raw)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        for (k, v) in extra where k != "type" { try c.encode(v, forKey: Key(k)) }
        if case let .string(raw)? = extra["type"] { try c.encode(raw, forKey: Key("type")) } else { try c.encode(type, forKey: Key("type")) }
        try c.encode(name, forKey: Key("name"))
        let fields: [(String, String?)] = [("username", username), ("password", password), ("url", url), ("host", host), ("privateKey", privateKey), ("publicKey", publicKey), ("passphrase", passphrase), ("notes", notes)]
        for (k, v) in fields { if let v { try c.encode(v, forKey: Key(k)) } }
    }
}

/// Any JSON value, to carry fields through untouched.
enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), null
    case array([JSONValue]), object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case let .string(s): try c.encode(s)
        case let .number(n): try c.encode(n)
        case let .bool(b): try c.encode(b)
        case .null: try c.encodeNil()
        case let .array(a): try c.encode(a)
        case let .object(o): try c.encode(o)
        }
    }
}

/// A decrypted item.
public struct VaultItem: Identifiable, Hashable, Sendable {
    public let id: String
    public var updatedAt: String
    public var data: VaultItemData

    public init(id: String, updatedAt: String, data: VaultItemData) {
        self.id = id
        self.updatedAt = updatedAt
        self.data = data
    }
}

public enum VaultError: LocalizedError, Equatable {
    case wrongPassword
    case unsupported(String)
    case corrupt

    public var errorDescription: String? {
        switch self {
        case .wrongPassword: "Mot de passe maître incorrect"
        case let .unsupported(what): "Coffre non pris en charge par l'app : \(what)"
        case .corrupt: "Donnée chiffrée illisible"
        }
    }
}

/// The unlocked vault key. Same scheme as the browser (src/lib/crypto.ts):
///
///     master password --Argon2id--> key-encryption key --AES-GCM--> vault key --AES-GCM--> items, locked notes
///
/// Blobs are "v1.<iv>.<ciphertext+tag>", base64. The key lives in memory only, unless the person
/// turns on Face ID / Touch ID (see `VaultKeyStore`).
public struct VaultKey: Sendable {
    let key: SymmetricKey

    public init(rawValue: Data) throws {
        guard rawValue.count == 32 else { throw VaultError.corrupt }
        key = SymmetricKey(data: rawValue)
    }

    public var rawValue: Data { key.withUnsafeBytes { Data($0) } }

    /// Derives the key-encryption key and unwraps the vault key. Slow on purpose (Argon2id, 64 MiB):
    /// call it off the main thread.
    public static func unlock(password: String, meta: VaultMeta) throws -> VaultKey {
        let kek = try deriveKEK(password: password, kdf: meta.kdf)
        let raw: Data
        do { raw = try open(kek, meta.wrappedKey) } catch { throw VaultError.wrongPassword }
        return try VaultKey(rawValue: raw)
    }

    static func deriveKEK(password: String, kdf: VaultMeta.KDF) throws -> SymmetricKey {
        guard kdf.name == "argon2id" else { throw VaultError.unsupported(kdf.name) }
        // libsodium's Argon2id always runs on one lane; the web app creates vaults with one.
        guard kdf.parallelism == 1 else { throw VaultError.unsupported("parallélisme \(kdf.parallelism)") }
        guard let salt = Data(base64Encoded: kdf.salt), salt.count == 16 else { throw VaultError.corrupt }
        // NFKC, like password.normalize("NFKC") in the browser.
        let normalized = password.precomposedStringWithCompatibilityMapping
        guard let raw = Sodium().pwHash.hash(
            outputLength: 32,
            passwd: Array(normalized.utf8),
            salt: Array(salt),
            opsLimit: kdf.iterations,
            memLimit: kdf.memoryKiB * 1024,
            alg: .Argon2ID13
        ) else { throw VaultError.unsupported("paramètres Argon2id") }
        return SymmetricKey(data: raw)
    }

    // MARK: Blobs

    public func encrypt(_ text: String) throws -> String { try Self.seal(key, Data(text.utf8)) }

    public func decrypt(_ blob: String) throws -> String {
        guard let text = String(data: try Self.open(key, blob), encoding: .utf8) else { throw VaultError.corrupt }
        return text
    }

    public func encrypt(_ item: VaultItemData) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try Self.seal(key, try encoder.encode(item))
    }

    public func decrypt(_ row: VaultItemRow) throws -> VaultItem {
        let data = try Self.open(key, row.data)
        do {
            return VaultItem(id: row.id, updatedAt: row.updatedAt, data: try JSONDecoder().decode(VaultItemData.self, from: data))
        } catch {
            throw VaultError.corrupt
        }
    }

    static func seal(_ key: SymmetricKey, _ plain: Data) throws -> String {
        let box = try AES.GCM.seal(plain, using: key, nonce: AES.GCM.Nonce())
        let nonce = box.nonce.withUnsafeBytes { Data($0) }
        // WebCrypto appends the 16-byte tag to the ciphertext.
        return "v1.\(nonce.base64EncodedString()).\((box.ciphertext + box.tag).base64EncodedString())"
    }

    static func open(_ key: SymmetricKey, _ blob: String) throws -> Data {
        let parts = blob.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "v1",
              let iv = Data(base64Encoded: String(parts[1])), iv.count == 12,
              let ct = Data(base64Encoded: String(parts[2])), ct.count >= 16
        else { throw VaultError.corrupt }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ct.dropLast(16), tag: ct.suffix(16))
        return try AES.GCM.open(box, using: key)
    }
}

/// A random password from an unambiguous alphabet (no 0/O, 1/l/I), like the web app's generator.
public func generatePassword(length: Int = 24) -> String {
    let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_+=?")
    var rng = SystemRandomNumberGenerator()
    return String((0 ..< max(8, length)).map { _ in alphabet[Int(rng.next(upperBound: UInt32(alphabet.count)))] })
}
