// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LifeOSCalendarHelper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "lifeos-calendar-helper", targets: ["LifeOSCalendarHelper"])
    ],
    targets: [
        .executableTarget(
            name: "LifeOSCalendarHelper",
            linkerSettings: [.linkedFramework("EventKit")]
        )
    ]
)
