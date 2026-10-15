// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "JHFBackup",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "JHFBackup", targets: ["JHFBackup"])],
    dependencies: [.package(url: "https://github.com/weichsel/ZIPFoundation.git", exact: "0.9.20")],
    targets: [
        .target(name: "JHFBackup", dependencies: ["ZIPFoundation"]),
        .testTarget(name: "JHFBackupTests", dependencies: ["JHFBackup", "ZIPFoundation"])
    ]
)
