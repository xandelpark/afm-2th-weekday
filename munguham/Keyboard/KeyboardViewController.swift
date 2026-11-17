import UIKit
import SwiftUI

/// 키 소리(설정의 '키보드 클릭'을 따른다)를 내려면 입력 화면이 이걸 따라야 한다.
final class ClickInputView: UIInputView, UIInputViewAudioFeedback {
    var enableInputClicksWhenVisible: Bool { true }
}

/// 문구함 키보드. 문구를 누르면 줄바꿈까지 그대로 입력창에 들어간다.
final class KeyboardViewController: UIInputViewController, KeyTarget {
    private let panel = Panel()
    private var height: NSLayoutConstraint?

    override func loadView() {
        let v = ClickInputView(frame: CGRect(x: 0, y: 0, width: 320, height: 300), inputViewStyle: .keyboard)
        v.allowsSelfSizing = true
        view = v
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        panel.target = self
        let host = UIHostingController(rootView: KeyboardPanel(panel: panel))
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)
        let h = view.heightAnchor.constraint(equalToConstant: 300)
        h.priority = UILayoutPriority(999)
        h.isActive = true
        height = h
        registerForTraitChanges([UITraitVerticalSizeClass.self]) { (vc: KeyboardViewController, _) in vc.fitHeight() }
    }

    /// 가로로 눕히면 조금 낮게
    private func fitHeight() {
        height?.constant = traitCollection.verticalSizeClass == .compact ? 236 : 300
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        panel.showGlobe = needsInputModeSwitchKey
        panel.query = ""
        panel.reload(hasAccess: hasFullAccess)
        fitHeight()
    }

    // MARK: KeyTarget
    func insert(_ text: String) { textDocumentProxy.insertText(text) }
    func deleteBackward() { textDocumentProxy.deleteBackward() }
    func nextKeyboard() { advanceToNextInputMode() }
    func click() { UIDevice.current.playInputClick() }
}
