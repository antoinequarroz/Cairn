import AuthenticationServices
import CairnKit
import SwiftUI

/// The AutoFill extension: when a site or app asks for a password, the system shows "Cairn". The
/// extension reads the vault from the copy the app keeps in the App Group (still encrypted), opens
/// it with Face ID / Touch ID or the master password, and hands the chosen login to the system.
/// It never talks to the server.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private lazy var model = AutoFillModel(
        complete: { [weak self] item in
            let credential = ASPasswordCredential(user: item.data.username ?? "", password: item.data.password ?? "")
            self?.extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
        },
        cancel: { [weak self] in
            self?.extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue))
        }
    )

    #if os(macOS)
    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 520))
    }
    #endif

    /// The person tapped "Cairn" (or the key icon): show the logins, those of this site first.
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        model.start(sites: serviceIdentifiers.map(\.identifier), recordID: nil)
        show()
    }

    /// A suggestion above the keyboard was picked. The key needs Face ID or the master password,
    /// so the system is asked to show the interface.
    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userInteractionRequired.rawValue))
    }

    /// Then: unlock, and fill that very login without another tap.
    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        let identity = credentialRequest.credentialIdentity
        model.start(sites: [identity.serviceIdentifier.identifier], recordID: identity.recordIdentifier)
        show()
    }

    private func show() {
        let root = AutoFillView(model: model)
        #if os(iOS)
        let host = UIHostingController(rootView: root)
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        #else
        let host = NSHostingView(rootView: root)
        host.frame = view.bounds
        host.autoresizingMask = [.width, .height]
        view.addSubview(host)
        #endif
    }
}
