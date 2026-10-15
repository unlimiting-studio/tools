// unlimiting-studio tools iOS/macOS 클라이언트.
// 이미지를 줄여서 API에 보내고, 받은 크롭 영역으로 원본을 기기에서 자른다.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct CropRect: Codable, Sendable, Equatable {
    /// 이미지 크기에 대한 비율(0~1). 픽셀 기준으로 정사각형이다.
    public let left: Double
    public let top: Double
    public let width: Double
    public let height: Double
}

public struct ProfileCropRect: Codable, Sendable {
    /// face: 사람·동물 얼굴 기준, subject: 얼굴이 없어 주요 피사체 기준
    public enum Mode: String, Codable, Sendable { case face, subject }
    public let mode: Mode
    public let crop: CropRect
    public let faceProbability: Double
    public let confidence: Double
}

public struct ProfileCropResult: @unchecked Sendable {
    public let rect: ProfileCropRect
    /// 잘라낸 정사각형 이미지 (EXIF 회전 적용됨)
    public let image: CGImage
    /// 원본 픽셀 기준 크롭 영역
    public let pixelRect: CGRect
}

public struct ToolsError: Error, LocalizedError, Sendable {
    public let status: Int
    public let message: String
    public var errorDescription: String? { message }
}

public final class ToolsClient: Sendable {
    public static let defaultBaseURL = URL(string: "https://tools.unlimiting.workers.dev")!

    // 서버(Jev)는 각 변 256~1568px를 받는다. 비용은 픽셀 수에 비례하므로 긴 변 512px로 보낸다.
    static let sendLongSide: CGFloat = 512
    static let minSide: CGFloat = 256

    let apiKey: String
    let baseURL: URL
    let appId: String?
    let session: URLSession

    /// - Parameter appId: 키에 허용된 앱 ID. 기본값은 번들 ID다.
    public init(apiKey: String, baseURL: URL = ToolsClient.defaultBaseURL,
                appId: String? = Bundle.main.bundleIdentifier, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.appId = appId
        self.session = session
    }

    /// 크롭 영역만 받는다.
    public func profileCropRect(_ image: CGImage) async throws -> ProfileCropRect {
        var req = URLRequest(url: baseURL.appendingPathComponent("v1/profile-crop"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        if let appId { req.setValue(appId, forHTTPHeaderField: "X-App-Id") }
        req.httpBody = try Self.encodeForAPI(image)

        let (data, res) = try await session.data(for: req)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "HTTP \(status)"
            throw ToolsError(status: status, message: message)
        }
        return try JSONDecoder().decode(ProfileCropRect.self, from: data)
    }

    /// 크롭 영역을 받아 정사각형으로 자른다.
    /// - Parameter size: 출력 한 변 픽셀. nil이면 원본 해상도로 자른다.
    public func profileCrop(_ image: CGImage, size: Int? = nil) async throws -> ProfileCropResult {
        let rect = try await profileCropRect(image)
        let W = CGFloat(image.width), H = CGFloat(image.height)
        let x = (rect.crop.left * W).rounded(), y = (rect.crop.top * H).rounded()
        let side = max(1, min((rect.crop.width * W).rounded(), W - x, H - y))
        let pixelRect = CGRect(x: x, y: y, width: side, height: side)
        guard var cropped = image.cropping(to: pixelRect) else {
            throw ToolsError(status: 0, message: "이미지를 자르지 못했습니다")
        }
        if let size, size != Int(side) { cropped = try Self.resize(cropped, width: size, height: size) }
        return ProfileCropResult(rect: rect, image: cropped, pixelRect: pixelRect)
    }

    /// 인코딩된 이미지(JPEG, PNG, HEIC 등)를 EXIF 회전을 적용해 자른다.
    public func profileCrop(data: Data, size: Int? = nil) async throws -> ProfileCropResult {
        try await profileCrop(Self.decodeOriented(data), size: size)
    }

    // MARK: - 이미지 처리

    /// EXIF 회전을 적용해 디코딩한다 (서버는 회전 정보를 보지 않는다).
    static func decodeOriented(_ data: Data) throws -> CGImage {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? Int, let h = props[kCGImagePropertyPixelHeight] as? Int
        else { throw ToolsError(status: 0, message: "이미지를 읽지 못했습니다") }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(w, h),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else {
            throw ToolsError(status: 0, message: "이미지를 읽지 못했습니다")
        }
        return image
    }

    static func encodeForAPI(_ image: CGImage) throws -> Data {
        let W = CGFloat(image.width), H = CGFloat(image.height)
        var s = sendLongSide / max(W, H)
        if min(W, H) * s < minSide { s = minSide / min(W, H) }
        let w = Int((W * s).rounded()), h = Int((H * s).rounded())
        guard max(w, h) <= 1568 else { throw ToolsError(status: 400, message: "가로세로 비율이 너무 극단적인 이미지입니다") }
        return try jpeg(resize(image, width: w, height: h), quality: 0.85)
    }

    static func resize(_ image: CGImage, width: Int, height: Int) throws -> CGImage {
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw ToolsError(status: 0, message: "이미지를 줄이지 못했습니다")
        }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let out = ctx.makeImage() else { throw ToolsError(status: 0, message: "이미지를 줄이지 못했습니다") }
        return out
    }

    static func jpeg(_ image: CGImage, quality: Double) throws -> Data {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw ToolsError(status: 0, message: "JPEG 인코딩 실패")
        }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw ToolsError(status: 0, message: "JPEG 인코딩 실패") }
        return data as Data
    }
}
