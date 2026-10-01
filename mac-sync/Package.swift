// swift-tools-version: 6.3
import PackageDescription

let package = Package(
    name: "LifeOSSync",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "LifeOSSync", targets: ["LifeOSSync"])],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(name: "SyncCore", dependencies: ["CSQLite"]),
        .executableTarget(name: "LifeOSSync", dependencies: ["SyncCore"],
                          swiftSettings: [.defaultIsolation(MainActor.self)]),
        .testTarget(name: "SyncCoreTests", dependencies: ["SyncCore"])
    ],
    swiftLanguageModes: [.v6]
)
