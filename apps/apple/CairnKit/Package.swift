// swift-tools-version: 5.9
import PackageDescription

// Everything that does not draw: the API client, the models, the vault crypto, the Keychain and
// the Markdown parser. Shared by the app and its AutoFill extension, testable with `swift test`.
//
// libsodium (through swift-sodium) is only there for Argon2id, which CryptoKit lacks: the master
// password must give the same key as hash-wasm in the browser. Pinned to a commit on purpose.
let package = Package(
    name: "CairnKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CairnKit", targets: ["CairnKit"])],
    dependencies: [
        .package(url: "https://github.com/jedisct1/swift-sodium.git", revision: "fbe072d70df9dbe43adbc4f6ae5787ee59fd376e"),
    ],
    targets: [
        .target(name: "CairnKit", dependencies: [.product(name: "Sodium", package: "swift-sodium")]),
        .testTarget(name: "CairnKitTests", dependencies: ["CairnKit"]),
    ]
)
