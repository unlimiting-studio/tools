#if canImport(UIKit)
import UIKit

extension ToolsClient {
    /// UIImage를 정사각형으로 자른다. imageOrientation을 적용한 뒤 처리한다.
    public func profileCrop(_ image: UIImage, size: Int? = nil) async throws -> (image: UIImage, rect: ProfileCropRect) {
        let result = try await profileCrop(Self.orientedCGImage(image), size: size)
        return (UIImage(cgImage: result.image), result.rect)
    }

    public func profileCropRect(_ image: UIImage) async throws -> ProfileCropRect {
        try await profileCropRect(Self.orientedCGImage(image))
    }

    package static func orientedCGImage(_ image: UIImage) throws -> CGImage {
        if image.imageOrientation == .up, let cg = image.cgImage { return cg }
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        let rendered = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in image.draw(at: .zero) }
        guard let cg = rendered.cgImage else { throw ToolsError(status: 0, message: "이미지를 읽지 못했습니다") }
        return cg
    }
}
#endif
