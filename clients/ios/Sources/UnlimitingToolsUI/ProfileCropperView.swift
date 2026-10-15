#if canImport(SwiftUI) && canImport(UIKit) && canImport(TOCropViewController)
import SwiftUI
import UIKit
import UnlimitingTools

/// SwiftUI용 프로필 사진 크롭 화면. `.fullScreenCover` 안에 넣어 쓴다.
public struct ProfileCropperView: UIViewControllerRepresentable {
    let image: UIImage
    let initialCrop: CropRect?
    let client: ToolsClient?
    let options: ProfileCropperOptions
    let onCrop: (ProfileCropperResult) -> Void
    let onCancel: () -> Void
    let onError: ((Error) -> Void)?

    public init(image: UIImage, initialCrop: CropRect? = nil, client: ToolsClient? = nil,
                options: ProfileCropperOptions = .init(),
                onCrop: @escaping (ProfileCropperResult) -> Void, onCancel: @escaping () -> Void,
                onError: ((Error) -> Void)? = nil) {
        self.image = image
        self.initialCrop = initialCrop
        self.client = client
        self.options = options
        self.onCrop = onCrop
        self.onCancel = onCancel
        self.onError = onError
    }

    public func makeUIViewController(context: Context) -> ProfileCropperViewController {
        let vc = ProfileCropperViewController(image: image, initialCrop: initialCrop, client: client, options: options)
        updateUIViewController(vc, context: context)
        return vc
    }

    public func updateUIViewController(_ vc: ProfileCropperViewController, context: Context) {
        vc.onCrop = onCrop
        vc.onCancel = onCancel
        vc.onError = onError
    }
}
#endif
