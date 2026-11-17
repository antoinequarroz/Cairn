// swift-tools-version: 5.9
import PackageDescription

// Everything that does not draw: the API client, the models, the Keychain and the Markdown parser.
// Shared by the Mac and iPhone app, and testable on its own with `swift test`.
let package = Package(
    name: "CairnKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CairnKit", targets: ["CairnKit"])],
    targets: [
        .target(name: "CairnKit"),
        .testTarget(name: "CairnKitTests", dependencies: ["CairnKit"]),
    ]
)
