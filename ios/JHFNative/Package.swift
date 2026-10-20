// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "JHFNative",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "JHFNative", targets: ["JHFNative"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.2"),
        .package(url: "https://github.com/google-ai-edge/LiteRT-LM", exact: "0.18.0"),
        .package(path: "../JHFBackup")
    ],
    targets: [
        .target(name: "JHFNative", dependencies: [
            "JHFBackup",
            .product(name: "Capacitor", package: "capacitor-swift-pm"),
            .product(name: "LiteRTLM", package: "LiteRT-LM")
        ], resources: [.copy("Resources/third_party_licenses.bundle")])
    ]
)
