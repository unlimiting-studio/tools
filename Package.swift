// swift-tools-version:5.9
// SwiftPM은 리포 루트의 Package.swift만 읽으므로 iOS 클라이언트를 여기서 선언한다.
import PackageDescription

let package = Package(
    name: "UnlimitingTools",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "UnlimitingTools", targets: ["UnlimitingTools"]),
        // 크롭 화면(iOS 전용). API만 쓰는 앱에는 TOCropViewController가 링크되지 않도록 따로 둔다.
        .library(name: "UnlimitingToolsUI", targets: ["UnlimitingToolsUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/TimOliver/TOCropViewController.git", from: "3.2.0"),
    ],
    targets: [
        .target(name: "UnlimitingTools", path: "clients/ios/Sources/UnlimitingTools"),
        .target(
            name: "UnlimitingToolsUI",
            dependencies: [
                "UnlimitingTools",
                .product(name: "TOCropViewController", package: "TOCropViewController", condition: .when(platforms: [.iOS])),
            ],
            path: "clients/ios/Sources/UnlimitingToolsUI"
        ),
        .testTarget(name: "UnlimitingToolsTests", dependencies: ["UnlimitingTools"], path: "clients/ios/Tests/UnlimitingToolsTests"),
    ]
)
