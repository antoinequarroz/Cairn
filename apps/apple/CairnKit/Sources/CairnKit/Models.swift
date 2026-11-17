import Foundation

/// A note in the list: no content, just the start of it (empty for an encrypted note).
public struct NoteSummary: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public var title: String
    public var encrypted: Bool
    public var folderId: String?
    public var updatedAt: String
    public var excerpt: String

    public init(id: String, title: String, encrypted: Bool, folderId: String?, updatedAt: String, excerpt: String) {
        self.id = id
        self.title = title
        self.encrypted = encrypted
        self.folderId = folderId
        self.updatedAt = updatedAt
        self.excerpt = excerpt
    }

    /// What the list shows when the note has no title yet, like the web app.
    public var displayTitle: String { title.trimmingCharacters(in: .whitespaces).isEmpty ? "Sans titre" : title }
    public var updatedDate: Date? { CairnDate.parse(updatedAt) }
}

/// A whole note. When `encrypted` is true, `content` is the end-to-end encrypted blob: only the web
/// app can open it for now.
public struct Note: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public var title: String
    public var content: String
    public var encrypted: Bool
    public var folderId: String?
    public var createdAt: String
    public var updatedAt: String

    public var summary: NoteSummary {
        let flat = content.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return NoteSummary(id: id, title: title, encrypted: encrypted, folderId: folderId, updatedAt: updatedAt, excerpt: encrypted ? "" : String(flat.prefix(160)))
    }
}

/// A folder holds notes and other folders. A folder at the root is a project.
public struct Folder: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public var parentId: String?
    public var name: String
    public var instructions: String
    public var createdAt: String
    public var updatedAt: String
}

/// A search hit from the server's full-text search (notes and AI discussions).
public struct SearchResult: Codable, Identifiable, Hashable, Sendable {
    public let kind: String
    public let id: String
    public var title: String
    public var snippet: String
    public var encrypted: Bool
    public var folderId: String?
}

/// A folder and the folders inside it, for an outline in the sidebar.
public struct FolderNode: Identifiable, Hashable, Sendable {
    public let folder: Folder
    public var children: [FolderNode]?
    public var id: String { folder.id }

    /// Builds the tree from the flat list the API returns, sorted by name. A folder whose parent is
    /// missing goes to the root rather than disappearing.
    public static func tree(_ folders: [Folder]) -> [FolderNode] {
        let ids = Set(folders.map(\.id))
        let byParent = Dictionary(grouping: folders) { f in f.parentId.flatMap { ids.contains($0) ? $0 : nil } ?? "" }
        func build(_ parent: String, depth: Int) -> [FolderNode] {
            guard depth < 32 else { return [] }
            return (byParent[parent] ?? [])
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                .map { f in
                    let kids = build(f.id, depth: depth + 1)
                    return FolderNode(folder: f, children: kids.isEmpty ? nil : kids)
                }
        }
        return build("", depth: 0)
    }
}

/// The server writes dates as ISO 8601 with milliseconds (`new Date().toISOString()`).
public enum CairnDate {
    public static func parse(_ s: String) -> Date? {
        let withMs = ISO8601DateFormatter()
        withMs.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withMs.date(from: s) { return d }
        return ISO8601DateFormatter().date(from: s)
    }
}

/// The server wraps the matched words of a search title or snippet in two control characters
/// (U+0001 … U+0002). Cut there so the app can highlight them.
public struct Highlighted: Hashable, Sendable {
    public struct Part: Hashable, Sendable {
        public let text: String
        public let match: Bool
    }

    public let parts: [Part]
    public var plain: String { parts.map(\.text).joined() }

    public init(_ marked: String) {
        var parts: [Part] = []
        var current = ""
        var inMatch = false
        for ch in marked {
            if ch == "\u{1}" || ch == "\u{2}" {
                if !current.isEmpty { parts.append(Part(text: current, match: inMatch)) }
                current = ""
                inMatch = ch == "\u{1}"
            } else {
                current.append(ch)
            }
        }
        if !current.isEmpty { parts.append(Part(text: current, match: inMatch)) }
        self.parts = parts
    }
}
