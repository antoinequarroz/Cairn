import CryptoKit
import Foundation

/// One "Continuer avec mon Compte Postmelo" from the app (server side: src/server/compte-app.ts).
/// The verifier stays in the app; the server only sees its SHA-256 until the handoff is traded,
/// so another app that grabbed the cairn:// link could not use it.
public struct CompteSignIn: Sendable {
    public static let callbackScheme = "cairn"

    public let verifier: String
    public var challenge: String { Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }

    public init(verifier: String? = nil) {
        self.verifier = verifier ?? {
            var bytes = [UInt8](repeating: 0, count: 32)
            _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
            return Self.base64url(Data(bytes))
        }()
    }

    public enum Back: Equatable, Sendable {
        case handoff(String)
        case refused(String)
    }

    /// Reads cairn://compte?code=… or cairn://compte?erreur=…
    public static func read(_ url: URL) -> Back {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        guard url.scheme == callbackScheme, url.host == "compte" else { return .refused(message("refus")) }
        if let code = value("code"), !code.isEmpty { return .handoff(code) }
        return .refused(message(value("erreur") ?? "refus"))
    }

    /// The same messages as the web's sign-in page.
    static func message(_ keyword: String) -> String {
        switch keyword {
        case "acces": "Cairn n'est ouvert qu'aux administrateurs du Compte Postmelo."
        case "panne": "Le Compte Postmelo ne répond pas. Réessaie, ou entre le mot de passe."
        case "off": "Ce serveur n'a pas la connexion par Compte Postmelo. Entre le mot de passe de Cairn."
        default: "Le Compte Postmelo n'a pas ouvert l'accès. Réessaie, ou entre le mot de passe."
        }
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
