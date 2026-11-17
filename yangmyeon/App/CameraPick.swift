import AVFoundation

/// 코트 전체를 담을 렌즈를 고른다.
///
/// 카메라를 코트 옆(네트 연장선)에 두고 길이 23.77 m 를 한 프레임에 담아야 한다.
/// 계산해 보면 울트라와이드(13 mm 환산, 가로 108.3°)는 8.58 m,
/// 메인(26 mm, 가로 69.4°)은 17.17 m 가 필요하다.
/// 일반 코트의 측면 펜스는 중앙선에서 약 9.14 m — **울트라와이드만 들어간다.**
struct CameraPick {

    struct Lens {
        let device: AVCaptureDevice
        /// 35 mm 환산 초점거리. 화각 계산의 근거다.
        let mm: Double
        var horizontalFOV: Double { 2 * atan(36 / (2 * mm)) * 180 / .pi }
        var verticalFOV: Double { 2 * atan(24 / (2 * mm)) * 180 / .pi }
        /// 코트 길이 23.77 m 를 담는 최소 거리.
        var minDistance: Double { 23.77 / 2 / tan(horizontalFOV / 2 * .pi / 180) }
        var name: String { device.localizedName }
        var isUltraWide: Bool { device.deviceType == .builtInUltraWideCamera }
    }

    /// 넓은 순서. 코트를 담는 게 1순위이므로 화각이 넓은 쪽을 먼저 본다.
    private static let order: [(AVCaptureDevice.DeviceType, Double)] = [
        (.builtInUltraWideCamera, 13),
        (.builtInWideAngleCamera, 26),
        (.builtInTelephotoCamera, 77),
    ]

    /// 쓸 수 있는 렌즈를 넓은 순서로. 비어 있으면 카메라를 못 쓰는 상태다.
    static func lenses() -> [Lens] {
        let types = order.map(\.0)
        let found = AVCaptureDevice.DiscoverySession(
            deviceTypes: types, mediaType: .video, position: .back).devices
        return order.compactMap { type, mm in
            found.first { $0.deviceType == type }.map { Lens(device: $0, mm: mm) }
        }
    }

    static func best() -> Lens? { lenses().first }

    /// 양쪽 동시 녹화에 쓸 두 카메라. 뒷면은 가장 넓은 렌즈, 앞면은 **바깥 화면 쪽** 카메라.
    /// 폴더블은 앞면이 둘(바깥 화면 쪽 / 안쪽 화면 밑)이다. 텐트·V 자 모두 바깥 면이 코트를 보므로
    /// 바깥 카메라를 명시해 잡는다. 없으면 일반 앞면으로 내려간다.
    /// 둘이 멀티캠 '동시 가능' 조합에 같이 있어야 한다. 아니면 nil.
    static func dualPair() -> (rear: Lens, front: Lens)? {
        guard AVCaptureMultiCamSession.isMultiCamSupported, let rear = best() else { return nil }
        let frontTypes: [(AVCaptureDevice.DeviceType, Double)] = [
            (.builtInOuterUltraWideCamera, 13),
            (.builtInUltraWideCamera, 13),
            (.builtInWideAngleCamera, 26),
        ]
        let fronts = AVCaptureDevice.DiscoverySession(
            deviceTypes: frontTypes.map(\.0), mediaType: .video, position: .front).devices
        let sets = AVCaptureDevice.DiscoverySession(
            deviceTypes: frontTypes.map(\.0) + [.builtInUltraWideCamera, .builtInWideAngleCamera],
            mediaType: .video, position: .unspecified).supportedMultiCamDeviceSets
        for (type, mm) in frontTypes {
            guard let f = fronts.first(where: { $0.deviceType == type }) else { continue }
            if sets.contains(where: { $0.contains(rear.device) && $0.contains(f) }) {
                return (rear, Lens(device: f, mm: mm))
            }
        }
        return nil
    }

    /// 양쪽 카메라 거치 안내. 기본은 네트 가운데 텐트.
    static func dualGuidance(mount: CaptureEngine.Mount) -> [(String, String)] {
        switch mount {
        case .netTent:
            return [
                ("설치 위치", "네트 위, 가운데에서 1 m 안팎 옆으로 비켜도 된다"),
                ("모양", "힌지를 위로 한 텐트(∧). 뒷면 카메라와 바깥 화면이 각각 한 코트를 본다"),
                ("힌지", "120~150°. 90° 면 베이스라인 선수 머리가 잘린다"),
                ("높이", "네트 줄 높이(0.9 m) 그대로. 더 높이면 좋다"),
                ("확인", "두 화면에 각각 베이스라인이 들어왔는지 · A/B 가 맞는 코트인지"),
                ("주의", "공이 맞는 자리다. 카메라 부분은 네트 줄 뒤로"),
            ]
        case .sideV:
            // 폰을 세워 두므로 카메라가 세로다: 가로 85°, 세로 108°.
            // 네트 기둥 옆 1 m(중앙선에서 약 7.4 m)에서 각 카메라를 코트 반쪽의 대각선(약 47°)으로 향하면
            // 가로 85° 안에 반쪽 코트가 4°~90° 로 다 들어온다. 힌지는 약 95°.
            return [
                ("설치 위치", "네트 기둥 옆 1 m 안팎 (코트 바깥, 네트 연장선 위)"),
                ("모양", "힌지를 세운 V 자. 뾰족한 쪽이 코트를 향하게 — 각 카메라가 코트 반쪽의 대각선을 본다"),
                ("힌지", "90~100°. 더 벌리면 코트 가운데가 양쪽에서 빠진다"),
                ("높이", "1.5 m 이상. 가까운 사이드라인 선수가 화면을 덮는 걸 줄인다"),
                ("확인", "두 화면에 각각 먼 쪽 코너(베이스라인×반대편 사이드라인)가 들어왔는지"),
            ]
        }
    }

    /// 기기에 달린 카메라 전부. 설치 안내 '기록' 에 남겨서 어떤 기기든 무엇이 열려 있는지 본다.
    /// 폴더블은 앞면이 둘(바깥 화면·안쪽 화면 밑)이라 종류 이름이 늘었다 — 목록을 박지 않고 전부 찾는다.
    static func inventory() -> [String] {
        let types: [AVCaptureDevice.DeviceType] = [
            .builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera,
            .builtInDualCamera, .builtInDualWideCamera, .builtInTripleCamera,
            .builtInTrueDepthCamera, .builtInLiDARDepthCamera,
            .builtInOuterUltraWideCamera, .builtInInnerUltraWideCamera,
        ]
        let found = AVCaptureDevice.DiscoverySession(
            deviceTypes: types, mediaType: .video, position: .unspecified).devices
        return found.map { d in
            let pos = d.position == .back ? "뒷면" : d.position == .front ? "앞면" : "?"
            let dims = d.activeFormat.dimensions
            return "\(pos) \(d.localizedName) [\(d.deviceType.rawValue)] \(dims.width)×\(dims.height)"
        }
    }

    /// 설치 안내. 고른 렌즈의 실제 화각으로 계산해서 돌려준다.
    static func guidance(_ l: Lens) -> [(String, String)] {
        let d = l.minDistance
        return [
            ("렌즈", "\(l.name) · 가로 \(String(format: "%.1f", l.horizontalFOV))°"),
            ("설치 위치", "코트 옆, 네트 연장선"),
            ("중앙선에서", "최소 \(String(format: "%.2f", d)) m · 권장 \(String(format: "%.1f", d + 0.6)) m 이상"),
            ("높이", "2 m 이상. 높을수록 선수가 겹쳐 보이지 않는다"),
            ("방향", "네트가 화면 가운데 수직으로 서게"),
            ("확인", "양쪽 베이스라인이 프레임 안에 들어왔는지"),
        ]
    }
}

extension AVCaptureDevice.Format {
    var dimensions: CMVideoDimensions {
        CMVideoFormatDescriptionGetDimensions(formatDescription)
    }
    var maxFrameRate: Double {
        videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0
    }
}
