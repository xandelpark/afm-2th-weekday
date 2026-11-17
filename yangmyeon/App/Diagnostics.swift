import SwiftUI
import UIKit
import AVFoundation

/// 실기기에서만 답이 나오는 질문들을 한 화면에 모은다.
///
/// "V 자로 반쯤 펼쳐 세우고 뒷면 카메라 + 바깥 앞면 카메라로 양쪽 코트를 나눠 찍자" 는 안은
/// (1) 그 두 카메라를 한 세션에서 동시에 돌릴 수 있는가(멀티캠 조합),
/// (2) 힌지 각도를 앱이 읽을 수 있는가 — 이 둘이 되어야 시작할 수 있다.
/// 시뮬레이터는 둘 다 "안 됨" 으로 나오는 게 정상이다.
enum Diagnostics {

    /// 멀티캠 지원 여부와, 동시에 열 수 있는 카메라 조합 전부.
    static func multiCam() -> [String] {
        var out: [String] = []
        out.append(AVCaptureMultiCamSession.isMultiCamSupported
                   ? "멀티캠: 지원" : "멀티캠: 지원 안 함 — 양쪽 카메라 동시 녹화 불가")
        guard AVCaptureMultiCamSession.isMultiCamSupported else { return out }
        let types: [AVCaptureDevice.DeviceType] = [
            .builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera,
            .builtInTrueDepthCamera, .builtInOuterUltraWideCamera, .builtInInnerUltraWideCamera,
        ]
        let sets = AVCaptureDevice.DiscoverySession(
            deviceTypes: types, mediaType: .video, position: .unspecified).supportedMultiCamDeviceSets
        if sets.isEmpty { out.append("동시 조합: 없음") }
        for s in sets {
            let names = s.map { d -> String in
                let pos = d.position == .back ? "뒷면" : d.position == .front ? "앞면" : "?"
                return "\(pos) \(d.localizedName)"
            }.sorted()
            out.append("동시 가능: " + names.joined(separator: " + "))
        }
        return out
    }
}

/// 힌지 상태를 읽는다. UIKit 의 `UIHingeInteraction` 은 뷰에 붙여야만 값을 주므로
/// 빈 UIView 하나를 두고 거기서 받는다.
struct HingeProbe: UIViewRepresentable {
    @Binding var text: String

    func makeUIView(context: Context) -> UIView {
        let v = UIView(frame: .zero)
        v.isUserInteractionEnabled = false
        let interaction = UIHingeInteraction { _, update in
            guard let hinge = update.hinge else {
                DispatchQueue.main.async { text = "힌지: 이 기기는 힌지 정보를 주지 않는다" }
                return
            }
            let deg = Int((hinge.angle * 180 / .pi).rounded())
            let status: String = switch hinge.status {
            case .closed:        "접힘"
            case .partiallyOpen: "반쯤 펼침"
            case .fullyOpen:     "완전히 펼침"
            default:             "알 수 없음"
            }
            DispatchQueue.main.async { text = "힌지: \(status) · \(deg)°" }
        }
        v.addInteraction(interaction)
        return v
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
