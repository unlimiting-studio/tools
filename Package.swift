// swift-tools-version:5.9
// SwiftPM은 리포 루트의 Package.swift만 읽으므로 iOS 클라이언트를 여기서 선언한다.
import PackageDescription

let package = Package(
    name: "UnlimitingTools",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "UnlimitingTools", targets: ["UnlimitingTools"])],
    targets: [
        .target(name: "UnlimitingTools", path: "clients/ios/Sources/UnlimitingTools"),
        .testTarget(name: "UnlimitingToolsTests", dependencies: ["UnlimitingTools"], path: "clients/ios/Tests/UnlimitingToolsTests"),
    ]
)
