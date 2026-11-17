import AuthenticationServices
import CairnKit
import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    /// The server offers "Continuer avec mon Compte Postmelo".
    @State private var compteOffered = false
    /// Back from the Compte Postmelo, Cairn's own code still to give.
    @State private var compte: (handoff: String, verifier: String)?
    @State private var server = ""
    @State private var password = ""
    @State private var code = ""
    @State private var needsCode = false
    @State private var working = false
    @State private var error: String?
    @FocusState private var codeFocused: Bool

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                CairnLogo().frame(width: 64, height: 64)
                Text("Cairn").font(.largeTitle.bold())
                Text("Tes notes et ton coffre, chez toi.").foregroundStyle(.secondary)
            }

            VStack(spacing: 12) {
                TextField("Adresse du serveur", text: $server, prompt: Text("cairn.postmelo.ch"))
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                if compte == nil {
                    SecureField("Mot de passe de Cairn", text: $password)
                        .textContentType(.password)
                        .onSubmit(submit)
                }
                if needsCode {
                    TextField("Code à 6 chiffres ou code de secours", text: $code)
                        .textContentType(.oneTimeCode)
                        .autocorrectionDisabled()
                        .focused($codeFocused)
                        .onSubmit(submit)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                }
            }
            .textFieldStyle(.roundedBorder)

            if let error {
                Text(error).foregroundStyle(.red).font(.callout).multilineTextAlignment(.center)
            }

            Button(action: submit) {
                Group {
                    if working { ProgressView().controlSize(.small) } else { Text("Se connecter") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(working || server.isEmpty || (compte == nil && password.isEmpty) || (needsCode && code.isEmpty))
            .keyboardShortcut(.defaultAction)

            if compte != nil {
                Button("Annuler") { reset() }.buttonStyle(.borderless)
            } else if compteOffered {
                VStack(spacing: 12) {
                    HStack {
                        VStack { Divider() }
                        Text("ou").font(.caption).foregroundStyle(.secondary)
                        VStack { Divider() }
                    }
                    Button(action: signInWithCompte) {
                        Label("Continuer avec mon Compte Postmelo", systemImage: "person.crop.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .disabled(working || server.isEmpty)
                }
            }
        }
        .padding(32)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            if server.isEmpty { server = model.serverAddress.replacingOccurrences(of: "https://", with: "") }
            error = model.errorMessage
        }
        .task(id: server) {
            // Asks the server once the address stops changing.
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            let offered = await model.compteEnabled(server: server)
            if !Task.isCancelled { compteOffered = offered }
        }
    }

    private func reset() {
        compte = nil
        needsCode = false
        code = ""
        error = nil
    }

    /// Opens the Compte Postmelo in the system's sign-in sheet, then trades what comes back for a session.
    private func signInWithCompte() {
        guard !working, let url = CairnClient.serverURL(from: server) else { return }
        let signIn = CompteSignIn()
        guard let start = CairnClient(baseURL: url).compteStartURL(challenge: signIn.challenge) else { return }
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                let back = try await webAuthenticationSession.authenticate(using: start, callbackURLScheme: CompteSignIn.callbackScheme, preferredBrowserSession: .shared)
                switch CompteSignIn.read(back) {
                case let .refused(message):
                    error = message
                case let .handoff(handoff):
                    do {
                        try await model.finishCompte(server: server, handoff: handoff, verifier: signIn.verifier, code: nil)
                        model.errorMessage = nil
                    } catch CairnError.needCode {
                        // The account has no second factor of its own: Cairn's code, as on the web.
                        compte = (handoff, signIn.verifier)
                        needsCode = true
                        codeFocused = true
                    }
                }
            } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
                // Closed by the person: nothing to say.
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func submit() {
        guard !working, !server.isEmpty, compte != nil || !password.isEmpty else { return }
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                if let compte {
                    try await model.finishCompte(server: server, handoff: compte.handoff, verifier: compte.verifier, code: code)
                } else {
                    try await model.signIn(server: server, password: password, code: needsCode ? code : nil)
                }
                model.errorMessage = nil
            } catch let CairnError.needCode(message) {
                needsCode = true
                codeFocused = true
                error = message
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

/// The three stones of the web app's icon (src/app/icon.svg), drawn in SwiftUI.
struct CairnLogo: View {
    var body: some View {
        GeometryReader { geo in
            let k = geo.size.width / 28
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 8 * k).fill(Color(red: 24 / 255, green: 23 / 255, blue: 21 / 255))
                stone(5.5, 17.6, 17, 4.9, k).fill(Color(red: 239 / 255, green: 237 / 255, blue: 232 / 255).opacity(0.55))
                stone(8, 11.9, 12, 4.6, k).fill(Color(red: 239 / 255, green: 237 / 255, blue: 232 / 255).opacity(0.8))
                stone(10.6, 6.2, 6.8, 4.6, k).fill(Color(red: 107 / 255, green: 114 / 255, blue: 1))
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }

    private func stone(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ k: CGFloat) -> some Shape {
        Capsule().path(in: CGRect(x: x * k, y: y * k, width: w * k, height: h * k))
    }
}
