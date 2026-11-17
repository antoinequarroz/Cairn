import SwiftUI

@main
struct CairnApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(.cairnAccent)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 720)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Nouvelle note") { Task { await model.createNote() } }
                    .keyboardShortcut("n")
                    .disabled(!model.isSignedIn)
            }
        }
        #endif
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.isSignedIn {
                NotesView()
            } else {
                LoginView()
            }
        }
        .animation(.default, value: model.isSignedIn)
    }
}

extension Color {
    /// Cairn's indigo, the same as the web app (#4f56e8, #7c82ff in dark mode).
    static let cairnAccent = Color("AccentColor")
}
