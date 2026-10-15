import Foundation
import XCTest
@testable import UnlimitingTools

/// TOOLS_API_KEY, TOOLS_BASE_URL, TOOLS_TEST_IMAGE 환경변수가 있을 때만 실제 API를 호출한다.
final class ToolsClientTests: XCTestCase {
    func testEncodeForAPIUsesLongSide512() throws {
        let image = try ToolsClient.resize(solid(), width: 2000, height: 1000)
        let data = try ToolsClient.encodeForAPI(image)
        let decoded = try ToolsClient.decodeOriented(data)
        XCTAssertEqual(decoded.width, 512)
        XCTAssertEqual(decoded.height, 256)
    }

    func testLiveProfileCrop() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let key = env["TOOLS_API_KEY"], let path = env["TOOLS_TEST_IMAGE"] else {
            throw XCTSkip("TOOLS_API_KEY / TOOLS_TEST_IMAGE 없음")
        }
        let base = env["TOOLS_BASE_URL"].flatMap(URL.init(string:)) ?? ToolsClient.defaultBaseURL
        let client = ToolsClient(apiKey: key, baseURL: base, appId: env["TOOLS_APP_ID"])
        let result = try await client.profileCrop(data: Data(contentsOf: URL(fileURLWithPath: path)), size: 300)
        XCTAssertEqual(result.image.width, 300)
        XCTAssertEqual(result.image.height, 300)
        print("live:", result.rect.mode, result.rect.crop, result.pixelRect)
        if let out = env["TOOLS_TEST_OUT"] { try ToolsClient.jpeg(result.image, quality: 0.9).write(to: URL(fileURLWithPath: out)) }
    }

    private func solid() -> CGImage {
        let ctx = CGContext(data: nil, width: 4, height: 4, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        return ctx.makeImage()!
    }
}
