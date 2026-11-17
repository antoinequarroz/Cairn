import CairnKit
import SwiftUI

/// The reading view of a note: headings, lists, quotes, code and images. Inline styles go through
/// `AttributedString(markdown:)`. Raw HTML is shown as text, never run.
struct MarkdownView: View {
    let source: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(MarkdownBlock.parse(source).enumerated()), id: \.offset) { _, block in
                BlockView(block: block)
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block {
        case let .heading(level, text):
            Text(inline(text)).font(font(level)).padding(.top, level <= 2 ? 8 : 4)
        case let .paragraph(text):
            Text(inline(text))
        case let .bullet(text, indent):
            row(indent) { Text("•").foregroundStyle(.secondary) } content: { Text(inline(text)) }
        case let .numbered(number, text, indent):
            row(indent) { Text("\(number).").foregroundStyle(.secondary).monospacedDigit() } content: { Text(inline(text)) }
        case let .task(done, text, indent):
            row(indent) {
                Image(systemName: done ? "checkmark.square.fill" : "square").foregroundStyle(done ? Color.cairnAccent : .secondary)
            } content: {
                Text(inline(text)).strikethrough(done).foregroundStyle(done ? .secondary : .primary)
            }
        case let .quote(text):
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2).fill(Color.cairnAccent.opacity(0.6)).frame(width: 3)
                Text(inline(text)).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case let .code(language, text):
            CodeBlock(language: language, text: text)
        case .rule:
            Divider()
        case let .image(alt, url):
            NoteImage(alt: alt, url: url)
        }
    }

    private func row(_ indent: Int, @ViewBuilder marker: () -> some View, @ViewBuilder content: () -> some View) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            marker()
            content()
        }
        .padding(.leading, CGFloat(indent) * 18)
    }

    private func font(_ level: Int) -> Font {
        switch level {
        case 1: .title.bold()
        case 2: .title2.bold()
        case 3: .title3.bold()
        default: .headline
        }
    }

    private func inline(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

private struct CodeBlock: View {
    let language: String
    let text: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(copied ? "Copié" : "Copier", systemImage: copied ? "checkmark" : "doc.on.doc", action: copy)
                    .labelStyle(.titleAndIcon)
                    .font(.caption)
                    .buttonStyle(.borderless)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text).font(.system(.callout, design: .monospaced))
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }

    /// Same labels as the web app: shell blocks are "Terminal".
    private var label: String {
        let l = language.lowercased()
        if ["bash", "sh", "shell", "zsh", "console", "terminal"].contains(l) { return "Terminal" }
        return l.isEmpty ? "Code" : l
    }

    private func copy() {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}

/// An image of the note. Files of the server need the session, so they go through the client;
/// an https image from elsewhere loads as is, like on the web.
private struct NoteImage: View {
    @Environment(AppModel.self) private var model
    let alt: String
    let url: String
    @State private var image: Image?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                image.resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 8))
            } else if url.hasPrefix("https://"), let remote = URL(string: url) {
                AsyncImage(url: remote) { phase in
                    if let loaded = phase.image {
                        loaded.resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 8))
                    } else if phase.error != nil {
                        Label(alt.isEmpty ? "Image" : alt, systemImage: "photo").foregroundStyle(.secondary)
                    } else {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 80)
                    }
                }
            } else if failed || !url.hasPrefix("/api/files/") {
                Label(alt.isEmpty ? "Image" : alt, systemImage: "photo").foregroundStyle(.secondary)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .frame(maxWidth: 640, alignment: .leading)
        .task(id: url) { await load() }
    }

    private func load() async {
        guard url.hasPrefix("/api/files/"), let client = model.client else { return }
        do {
            let data = try await client.file(url)
            #if os(iOS)
            if let ui = UIImage(data: data) { image = Image(uiImage: ui) } else { failed = true }
            #else
            if let ns = NSImage(data: data) { image = Image(nsImage: ns) } else { failed = true }
            #endif
        } catch {
            failed = true
        }
    }
}
