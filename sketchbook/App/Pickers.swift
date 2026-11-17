import UIKit
import Photos

/// 메모앱과 같은 색 고르기 창(격자·스펙트럼·슬라이더). 고르는 동안 색이 바로 바뀐다.
@MainActor
final class ColorPickerPresenter: NSObject, UIColorPickerViewControllerDelegate {
    static let shared = ColorPickerPresenter()
    private var onChange: ((UIColor) -> Void)?
    private var onDone: ((UIColor) -> Void)?

    func present(_ initial: UIColor, onChange: @escaping (UIColor) -> Void, onDone: @escaping (UIColor) -> Void) {
        self.onChange = onChange
        self.onDone = onDone
        let vc = UIColorPickerViewController()
        vc.selectedColor = initial
        vc.supportsAlpha = false
        vc.title = "색 고르기"
        vc.delegate = self
        if let sheet = vc.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        Self.top()?.present(vc, animated: true)
    }

    func colorPickerViewController(_ vc: UIColorPickerViewController, didSelect color: UIColor, continuously: Bool) {
        onChange?(color)
    }

    func colorPickerViewControllerDidFinish(_ vc: UIColorPickerViewController) {
        onDone?(vc.selectedColor)
        onChange = nil
        onDone = nil
    }

    static func top() -> UIViewController? {
        let w = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first { $0.isKeyWindow }
        var vc = w?.rootViewController
        while let p = vc?.presentedViewController { vc = p }
        return vc
    }
}

/// 사진 앱에 저장 (추가만 — 사진첩을 읽지는 않는다).
enum PhotoSaver {
    @MainActor
    static func save(_ s: Sketch) async -> Bool {
        guard let data = Renderer.image(of: s, maxSide: 2880)?.pngData() else { return false }
        let st = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard st == .authorized || st == .limited else { return false }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }
            return true
        } catch {
            return false
        }
    }
}
