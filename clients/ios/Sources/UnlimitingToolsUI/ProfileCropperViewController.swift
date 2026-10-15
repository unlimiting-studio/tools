// 프로필 사진 크롭 화면 (iOS 전용).
// 화면 가운데에 고정된 정사각형 틀 아래에서 사진을 끌고 확대한다. 제스처·확대 제한·툴바는 TOCropViewController를 쓴다.
#if canImport(UIKit) && canImport(TOCropViewController)
import TOCropViewController
import UIKit
import UIKit.UIGestureRecognizerSubclass
import UnlimitingTools

/// 크롭 틀 모양. 출력 이미지는 모양과 관계없이 정사각형이다.
public enum ProfileCropperShape: Sendable, Equatable {
    case circle
    case square
    /// radius: 한 변에 대한 모서리 반지름 비율
    case roundedSquare(radius: CGFloat = 0.12)
}

/// 틀 안의 3x3 격자를 언제 보여 줄지
public enum ProfileCropperGrid: Sendable {
    case always, whileInteracting, hidden
}

public struct ProfileCropperOptions: Sendable {
    public var shape: ProfileCropperShape
    public var grid: ProfileCropperGrid
    /// 출력 한 변 픽셀. nil이면 크롭 영역의 원본 해상도로 자른다.
    public var outputSize: Int?

    public init(shape: ProfileCropperShape = .circle, grid: ProfileCropperGrid = .whileInteracting, outputSize: Int? = nil) {
        self.shape = shape
        self.grid = grid
        self.outputSize = outputSize
    }
}

public struct ProfileCropperResult: @unchecked Sendable {
    /// 잘라낸 정사각형 이미지 (EXIF 회전 적용됨)
    public let image: UIImage
    /// 원본 픽셀 기준 크롭 영역
    public let pixelRect: CGRect
    /// 원본 크기에 대한 비율 좌표
    public let crop: CropRect
}

/// 프로필 사진 크롭 화면.
///
/// `initialCrop`을 주면 그 영역에서 시작한다. 없고 `client`를 주면 가운데 크롭으로 먼저 보여 주고,
/// API 결과가 오면 그 영역으로 옮긴다(사용자가 이미 만졌으면 옮기지 않는다).
/// 화면을 닫는 것은 호출한 쪽에서 `onCrop`·`onCancel` 안에서 처리한다.
@MainActor
public final class ProfileCropperViewController: UIViewController {
    /// 완료를 누르면 호출된다.
    public var onCrop: ((ProfileCropperResult) -> Void)?
    /// 취소를 누르면 호출된다.
    public var onCancel: (() -> Void)?
    /// 자동 크롭 API가 실패하면 호출된다. 화면은 가운데 크롭으로 계속 쓸 수 있다.
    public var onError: ((Error) -> Void)?

    /// 자동 크롭 영역. 전달받은 값이거나 API 결과다.
    public private(set) var autoCrop: CropRect?

    public let options: ProfileCropperOptions
    private let source: CGImage
    private let client: ToolsClient?
    private let cropper: TOCropViewController
    private let frameOverlay: FrameOverlayView
    private let spinner = UIActivityIndicatorView(style: .large)
    private var touched = false
    private var task: Task<Void, Never>?

    /// - Parameters:
    ///   - initialCrop: 미리 계산한 크롭 영역. 주면 API를 호출하지 않는다.
    ///   - client: initialCrop이 없을 때 자동 크롭 영역을 받아올 클라이언트
    public init(image: UIImage, initialCrop: CropRect? = nil, client: ToolsClient? = nil,
                options: ProfileCropperOptions = .init()) {
        // UIGraphicsImageRenderer가 만든 이미지는 항상 CGImage를 가지므로 실패하지 않는다.
        source = try! ToolsClient.orientedCGImage(image)
        // 회전을 적용한 1배율 이미지를 넘겨 TOCropViewController의 좌표가 원본 픽셀과 같게 한다.
        cropper = TOCropViewController(croppingStyle: .default, image: UIImage(cgImage: source, scale: 1, orientation: .up))
        self.client = initialCrop == nil ? client : nil
        self.options = options
        autoCrop = initialCrop
        frameOverlay = FrameOverlayView(shape: options.shape)
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit { task?.cancel() }

    public override var childForStatusBarHidden: UIViewController? { cropper }
    public override var childForStatusBarStyle: UIViewController? { cropper }

    public override func viewDidLoad() {
        super.viewDidLoad()

        // 틀은 1:1로 고정하고 크기를 바꾸지 못하게 한다. 회전·비율 버튼은 숨긴다.
        cropper.aspectRatioPreset = CGSize(width: 1, height: 1)
        cropper.aspectRatioLockEnabled = true
        cropper.resetAspectRatioEnabled = false
        cropper.aspectRatioPickerButtonHidden = true
        cropper.rotateButtonsHidden = true
        cropper.cropView.cropBoxResizeEnabled = false
        cropper.onDidCropImageToRect = { [weak self] rect, _ in self?.finish(rect) }
        cropper.onDidFinishCancelled = { [weak self] _ in self?.onCancel?() }
        if let autoCrop { cropper.imageCropFrame = pixelRect(autoCrop) }

        addChild(cropper)
        cropper.view.frame = view.bounds
        cropper.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(cropper.view)
        cropper.didMove(toParent: self)

        // 초기화 버튼은 가운데가 아니라 자동 크롭 영역으로 되돌린다 (TOCropViewController의 viewDidLoad 이후에 덮어쓴다).
        cropper.toolbar.resetButtonTapped = { [weak self] in self?.resetToAutoCrop() }

        // 기본 격자는 모서리 손잡이까지 그려 크기를 바꿀 수 있는 것처럼 보이므로 숨기고, 모양에 맞춘 격자를 직접 그린다.
        let cropView = cropper.cropView
        cropView.gridOverlayView?.isHidden = true
        frameOverlay.frame = cropView.foregroundContainerView.bounds
        frameOverlay.gridVisible = options.grid == .always
        cropView.foregroundContainerView.addSubview(frameOverlay)
        cropView.addGestureRecognizer(TouchObserver { [weak self] active in self?.interactionChanged(active) })

        spinner.color = .white
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        cropView.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: cropView.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: cropView.centerYAnchor),
        ])

        if let client { loadAutoCrop(client) }
    }

    /// 자동 크롭 영역으로 되돌린다. 아직 없으면 가운데 크롭으로 되돌린다.
    public func resetToAutoCrop() {
        if let autoCrop {
            move(to: autoCrop)
        } else {
            cropper.cropView.resetLayoutToDefault(animated: true)
        }
    }

    private func loadAutoCrop(_ client: ToolsClient) {
        spinner.startAnimating()
        let image = source
        task = Task { [weak self] in
            do {
                let rect = try await client.profileCropRect(image)
                guard let self, !Task.isCancelled else { return }
                self.spinner.stopAnimating()
                self.autoCrop = rect.crop
                if !self.touched { self.move(to: rect.crop) }
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.spinner.stopAnimating()
                self.onError?(error)
            }
        }
    }

    private func move(to crop: CropRect) {
        let rect = pixelRect(crop)
        guard view.window != nil else { cropper.imageCropFrame = rect; return }
        UIView.animate(withDuration: 0.4, delay: 0, usingSpringWithDamping: 1, initialSpringVelocity: 0,
                       options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.cropper.imageCropFrame = rect
        }
    }

    private func interactionChanged(_ active: Bool) {
        if active { touched = true }
        guard options.grid == .whileInteracting else { return }
        UIView.animate(withDuration: active ? 0.15 : 0.35) { self.frameOverlay.gridVisible = active }
    }

    private func pixelRect(_ crop: CropRect) -> CGRect {
        ToolsClient.pixelRect(crop, width: source.width, height: source.height)
    }

    private func finish(_ rect: CGRect) {
        // 틀이 정사각형이라 rect도 정사각형이지만, 반올림 차이에 대비해 짧은 변에 맞춘다.
        let side = min(rect.width, rect.height)
        let pixelRect = CGRect(x: rect.minX, y: rect.minY, width: side, height: side)
        do {
            guard var cropped = source.cropping(to: pixelRect) else {
                throw ToolsError(status: 0, message: "이미지를 자르지 못했습니다")
            }
            if let size = options.outputSize, size != cropped.width {
                cropped = try ToolsClient.resize(cropped, width: size, height: size)
            }
            let W = Double(source.width), H = Double(source.height)
            let crop = CropRect(left: pixelRect.minX / W, top: pixelRect.minY / H, width: side / W, height: side / H)
            onCrop?(ProfileCropperResult(image: UIImage(cgImage: cropped), pixelRect: pixelRect, crop: crop))
        } catch {
            onError?(error)
        }
    }
}

/// 틀 테두리와 3x3 격자. 크롭 영역을 보여 주는 뷰 안에 넣어 같은 크기·모양으로 잘리게 한다.
private final class FrameOverlayView: UIView {
    let shape: ProfileCropperShape
    private let grid = CAShapeLayer()
    private let border = CAShapeLayer()

    var gridVisible = false {
        didSet { grid.opacity = gridVisible ? 1 : 0 }
    }

    init(shape: ProfileCropperShape) {
        self.shape = shape
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        for layer in [grid, border] {
            layer.fillColor = nil
            layer.strokeColor = UIColor.white.cgColor
            self.layer.addSublayer(layer)
        }
        grid.strokeColor = UIColor.white.withAlphaComponent(0.6).cgColor
        grid.lineWidth = 1
        grid.opacity = 0
        border.lineWidth = 1.5
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let side = bounds.width
        let radius: CGFloat
        switch shape {
        case .circle: radius = side / 2
        case .square: radius = 0
        case let .roundedSquare(ratio): radius = side * ratio
        }
        // 부모(TOCropView의 foregroundContainerView)가 clipsToBounds라서 모서리를 둥글리면 사진과 격자가 함께 잘린다.
        superview?.layer.cornerRadius = radius

        let path = UIBezierPath()
        for i in 1...2 {
            let x = bounds.width * CGFloat(i) / 3, y = bounds.height * CGFloat(i) / 3
            path.move(to: CGPoint(x: x, y: 0)); path.addLine(to: CGPoint(x: x, y: bounds.height))
            path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: bounds.width, y: y))
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        grid.path = path.cgPath
        let inset = border.lineWidth / 2
        border.path = UIBezierPath(roundedRect: bounds.insetBy(dx: inset, dy: inset), cornerRadius: max(0, radius - inset)).cgPath
        CATransaction.commit()
    }
}

/// 다른 제스처를 막지 않고 손가락이 닿았는지만 알려 준다.
private final class TouchObserver: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private let onChange: (Bool) -> Void
    private var count = 0

    init(onChange: @escaping (Bool) -> Void) {
        self.onChange = onChange
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesEnded = false
        delegate = self
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        if count == 0 { onChange(true) }
        count += touches.count
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { release(touches) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { release(touches) }

    private func release(_ touches: Set<UITouch>) {
        count -= touches.count
        guard count <= 0 else { return }
        count = 0
        onChange(false)
        state = .failed
    }

    override func reset() {
        if count > 0 { onChange(false) }
        count = 0
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}
#endif
