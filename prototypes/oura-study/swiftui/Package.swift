// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LifeOSStudy",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "LifeOSStudy", targets: ["LifeOSStudy"])],
    targets: [.executableTarget(name: "LifeOSStudy")],
    swiftLanguageModes: [.v5]
)
