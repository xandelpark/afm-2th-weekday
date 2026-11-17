import Foundation
import AVFoundation

/// 두 카메라가 겹쳐 보는 띠. 폰을 접은 각도와 화각에서 계산한다.
///
/// 두 카메라는 180° − (힌지 각도) 만큼 벌어져 본다. 카메라 하나의 (힌지에 수직인 축) 화각이
/// 그보다 넓으면 그 차이가 가운데에서 겹친다. 핀홀 투영이라 각도가 아니라 tan 으로 비율을 낸다.
/// 안쪽 가장자리를 두 카메라 사이 중앙선까지 잘라내면 두 영상이 한 장면처럼 이어진다.
enum Seam {
    /// 한쪽 프레임 폭 중 안쪽 가장자리에서 잘라낼 비율. 0 = 겹침 없음(또는 틈).
    static func crop(hinge: Double, fovAcross: Double) -> Double {
        guard hinge > 0, hinge < 180, fovAcross > 1 else { return 0 }
        let aMid  = (180 - hinge) / 2 * .pi / 180        // 카메라 축 ↔ 두 카메라의 중앙선
        let aEdge = fovAcross / 2 * .pi / 180            // 카메라 축 ↔ 프레임 가장자리
        guard aEdge > aMid else { return 0 }
        let c = (tan(aEdge) - tan(aMid)) / (2 * tan(aEdge))
        return min(0.45, max(0, c))
    }

    /// 16:9 영상의 짧은 축 화각. 장축 화각(h°) 에서. 울트라와이드 108° → 약 76°.
    static func acrossFOV(longAxis h: Double) -> Double {
        guard h > 1 else { return 0 }
        return 2 * atan(tan(h / 2 * .pi / 180) * 9 / 16) * 180 / .pi
    }

    /// 힌지를 못 읽을 때 쓰는 거치별 기본 각도.
    static func defaultHinge(mount: String?) -> Double { mount == "netTent" ? 135 : 110 }

    /// 화각 기록이 없을 때 쓰는 짧은 축 화각 — 촬영 화면의 대략적인 겹침 표시용.
    /// 2026-11-03 녹화를 두 카메라 화각이 같다고 보고 잰 값(겹침 25% ⇒ 약 53°).
    /// 실제로는 두 카메라 화각이 다르다(같은 사람이 A 에서 1.58배 크다 — 뒷면 약 44°, 앞면 약 64°).
    /// 다시 보기·합본은 이 값을 안 쓰고 그림을 직접 맞춘다(Stitch.swift 의 StitchAligner).
    static let measuredAcross: Double = 53

}
