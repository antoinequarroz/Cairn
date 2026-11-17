import Foundation

/// A Markdown note cut into blocks, for the reading view. Inline styles (bold, italic, links, code)
/// are left in the text: SwiftUI's `AttributedString(markdown:)` handles those, but not blocks.
public enum MarkdownBlock: Hashable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bullet(text: String, indent: Int)
    case numbered(number: String, text: String, indent: Int)
    case task(done: Bool, text: String, indent: Int)
    case quote(String)
    case code(language: String, text: String)
    case rule
    case image(alt: String, url: String)

    public static func parse(_ source: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var quote: [String] = []
        var fence: (marker: String, language: String, lines: [String])?

        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))); paragraph = [] }
            if !quote.isEmpty { blocks.append(.quote(quote.joined(separator: "\n"))); quote = [] }
        }

        for raw in source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            if var f = fence {
                if raw.trimmingCharacters(in: .whitespaces).hasPrefix(f.marker) {
                    blocks.append(.code(language: f.language, text: f.lines.joined(separator: "\n")))
                    fence = nil
                } else {
                    f.lines.append(raw)
                    fence = f
                }
                continue
            }
            let line = raw.trimmingCharacters(in: .whitespaces)
            let indent = (raw.prefix { $0 == " " || $0 == "\t" }.reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }) / 2

            if line.hasPrefix("```") || line.hasPrefix("~~~") {
                flush()
                let marker = String(line.prefix(3))
                fence = (marker, String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces), [])
                continue
            }
            if line.isEmpty { flush(); continue }
            if line.hasPrefix(">") {
                if !paragraph.isEmpty { flush() }
                quote.append(String(line.dropFirst()).trimmingCharacters(in: .whitespaces))
                continue
            }
            if !quote.isEmpty { flush() }

            if let h = heading(line) { flush(); blocks.append(h); continue }
            if ["---", "***", "___"].contains(line.replacingOccurrences(of: " ", with: "")) { flush(); blocks.append(.rule); continue }
            if let img = image(line) { flush(); blocks.append(img); continue }
            if let item = listItem(line, indent: indent) { flush(); blocks.append(item); continue }
            paragraph.append(line)
        }
        if let f = fence { blocks.append(.code(language: f.language, text: f.lines.joined(separator: "\n"))) }
        flush()
        return blocks
    }

    private static func heading(_ line: String) -> MarkdownBlock? {
        let hashes = line.prefix { $0 == "#" }.count
        guard (1 ... 6).contains(hashes), line.dropFirst(hashes).first == " " else { return nil }
        return .heading(level: hashes, text: line.dropFirst(hashes + 1).trimmingCharacters(in: .whitespaces))
    }

    private static func image(_ line: String) -> MarkdownBlock? {
        guard line.hasPrefix("!["), line.hasSuffix(")"), let close = line.range(of: "](") else { return nil }
        let alt = String(line[line.index(line.startIndex, offsetBy: 2) ..< close.lowerBound])
        let url = String(line[close.upperBound ..< line.index(before: line.endIndex)]).split(separator: " ").first.map(String.init) ?? ""
        return url.isEmpty ? nil : .image(alt: alt, url: url)
    }

    private static func listItem(_ line: String, indent: Int) -> MarkdownBlock? {
        for marker in ["- ", "* ", "+ "] where line.hasPrefix(marker) {
            let rest = String(line.dropFirst(2))
            if rest.hasPrefix("[ ] ") { return .task(done: false, text: String(rest.dropFirst(4)), indent: indent) }
            if rest.lowercased().hasPrefix("[x] ") { return .task(done: true, text: String(rest.dropFirst(4)), indent: indent) }
            return .bullet(text: rest, indent: indent)
        }
        let digits = line.prefix { $0.isNumber }
        if !digits.isEmpty, digits.count < 10 {
            let after = line.dropFirst(digits.count)
            if after.hasPrefix(". ") || after.hasPrefix(") ") {
                return .numbered(number: String(digits), text: String(after.dropFirst(2)), indent: indent)
            }
        }
        return nil
    }
}
