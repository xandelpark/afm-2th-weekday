import SwiftUI
import UIKit
import AVFoundation
import MatchCore

struct CameraPreview: UIViewRepresentable {
    /// 관찰해야 한다 — 세션 설정이 끝나 연결이 생기는 순간 updateUIView 가 다시 불려서
    /// 프리뷰 연결에 회전을 걸 수 있다. 그냥 let 으로 받으면 그 순간을 놓친다.
    @ObservedObject var engine: CaptureEngine
    /// 화면 안에서 실제 영상이 차지하는 영역. 화면 비율이 영상과 다르면(폴더블은 1.4:1,
    /// 영상은 16:9) 위아래가 비는데, 안내선은 영상 영역에 맞춰야 뜻이 있다.
    @Binding var videoRect: CGRect?

    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.backgroundColor = .black
        v.layer.session = engine.session
        v.layer.videoGravity = .resizeAspect
        v.onVideoRect = { r in DispatchQueue.main.async { if videoRect != r { videoRect = r } } }
        if let c = v.layer.connection { engine.register(preview: c) }
        return v
    }

    func updateUIView(_ v: PreviewView, context: Context) {
        if v.layer.session == nil { v.layer.session = engine.session }
        // 연결은 입력이 붙은 뒤에야 생긴다. 생기면 등록한다(이미 등록된 건 엔진이 걸러낸다).
        if let c = v.layer.connection { engine.register(preview: c) }
        v.setNeedsLayout()
    }

    final class PreviewView: UIView {
        var onVideoRect: ((CGRect?) -> Void)?
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        override var layer: AVCaptureVideoPreviewLayer {
            super.layer as! AVCaptureVideoPreviewLayer
        }
        override func layoutSubviews() {
            super.layoutSubviews()
            // 메타데이터 좌표 (0,0)-(1,1) = 영상 전체. 이걸 레이어 좌표로 바꾸면 영상 영역이다.
            // 연결이 없으면(설정 전) 레이어가 0 크기를 돌려주므로 그땐 nil.
            let r = layer.layerRectConverted(fromMetadataOutputRect: CGRect(x: 0, y: 0, width: 1, height: 1))
            onVideoRect?(r.width > 1 && r.height > 1 ? r : nil)
        }
    }
}

/// 양쪽 카메라 프리뷰 한 쪽. 엔진의 상자가 만든 레이어를 얹기만 한다.
struct DualPreviewHalf: UIViewRepresentable {
    @ObservedObject var engine: CaptureEngine
    let rear: Bool
    /// 이 패널의 안쪽(다른 카메라와 맞닿는) 가장자리가 오른쪽인가. 왼쪽 패널이면 true.
    var innerIsRight = true
    /// 안쪽 가장자리에서 잘라낼 폭 비율(0 ~ 0.45). 겹친 띠를 숨겨 두 영상을 이어 붙인다.
    var crop: Double = 0
    @Binding var videoRect: CGRect?

    func makeUIView(context: Context) -> HostView {
        let v = HostView(); v.backgroundColor = .black; v.clipsToBounds = true
        v.onVideoRect = { r in DispatchQueue.main.async { if videoRect != r { videoRect = r } } }
        attach(v); return v
    }
    func updateUIView(_ v: HostView, context: Context) {
        attach(v)
        if v.crop != crop || v.innerIsRight != innerIsRight { v.crop = crop; v.innerIsRight = innerIsRight }
        v.setNeedsLayout()
    }

    private func attach(_ v: HostView) {
        guard let layer = engine.previewLayer(rear: rear), v.preview !== layer else { return }
        v.preview?.removeFromSuperlayer()
        v.preview = layer
        v.layer.addSublayer(layer)
        v.setNeedsLayout()
    }

    final class HostView: UIView {
        var preview: AVCaptureVideoPreviewLayer?
        var onVideoRect: ((CGRect?) -> Void)?
        var crop: Double = 0
        var innerIsRight = true
        override func layoutSubviews() {
            super.layoutSubviews()
            guard let preview else { onVideoRect?(nil); return }
            CATransaction.begin(); CATransaction.setDisableActions(true)
            defer { CATransaction.commit() }
            // 변환을 풀고 패널에 꽉 맞춘 뒤 영상 영역을 읽는다 (좌표 변환은 변환 전 기준이다).
            preview.setAffineTransform(.identity)
            preview.bounds = bounds
            preview.position = CGPoint(x: bounds.midX, y: bounds.midY)
            let v = preview.layerRectConverted(fromMetadataOutputRect: CGRect(x: 0, y: 0, width: 1, height: 1))
            guard v.width > 1, v.height > 1 else { onVideoRect?(nil); return }
            guard crop > 0.001 else { onVideoRect?(v); return }

            // 남길 부분 K: 안쪽 가장자리에서 crop 만큼 뺀 나머지. 그걸 패널에 맞춰 키우고 가운데로.
            let cut = v.width * crop
            let k = CGRect(x: innerIsRight ? v.minX : v.minX + cut, y: v.minY, width: v.width - cut, height: v.height)
            let s = min(bounds.width / k.width, bounds.height / k.height)
            let kc = CGPoint(x: k.midX, y: k.midY), bc = CGPoint(x: bounds.midX, y: bounds.midY)
            // 점 p ↦ bc + s·(p − kc). 레이어 변환은 중심 기준이므로 평행이동 = s·(bc − kc).
            let t = CGAffineTransform(translationX: s * (bc.x - kc.x), y: s * (bc.y - kc.y)).scaledBy(x: s, y: s)
            preview.setAffineTransform(t)
            onVideoRect?(CGRect(x: bc.x - k.width * s / 2, y: bc.y - k.height * s / 2, width: k.width * s, height: k.height * s))
        }
    }
}

/// 시뮬레이터용 가짜 코트. 카메라 자리에 코트 그림을 깔아 안내선·점수판이 어떻게 얹히는지 본다.
/// 울트라와이드로 코트 옆 9 m 에서 본 구도를 흉내 냈다 — 네트가 가운데, 베이스라인이 양 끝.
struct SimulatedCourt: View {
    /// 실기기처럼 16:9 영상이 화면 가운데 놓이고 위아래가 비는 모양을 흉내 낸다.
    @Binding var videoRect: CGRect?
    /// 듀얼이면 한 반쪽 코트만 그린다 (왼쪽 패널은 A, 오른쪽은 B).
    var half: Side? = nil

    var body: some View {
        GeometryReader { g in
            let full = CGRect(origin: .zero, size: g.size)
            let video = Self.fit16x9(in: full)
            let w = video.width, h = video.height
            let court = CGRect(x: video.minX + w * 0.04, y: video.minY + h * 0.30, width: w * 0.92, height: h * 0.40)
            ZStack {
                Color.black
                LinearGradient(colors: [Color(red: 0.36, green: 0.52, blue: 0.70),
                                        Color(red: 0.55, green: 0.66, blue: 0.78)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(width: w, height: h).position(x: video.midX, y: video.midY)
                Rectangle()
                    .fill(Color(red: 0.20, green: 0.42, blue: 0.30))
                    .frame(width: w, height: h * 0.55).position(x: video.midX, y: video.minY + h * 0.725)
                Path { p in
                    p.addRect(court)
                    // 네트
                    p.move(to: CGPoint(x: court.midX, y: court.minY - h * 0.06))
                    p.addLine(to: CGPoint(x: court.midX, y: court.maxY))
                    // 서비스 라인 (네트에서 6.4 m ≈ 코트 길이의 27%)
                    for f in [0.231, 0.769] {
                        let x = court.minX + court.width * f
                        p.move(to: CGPoint(x: x, y: court.minY)); p.addLine(to: CGPoint(x: x, y: court.maxY))
                    }
                    // 센터 서비스 라인
                    p.move(to: CGPoint(x: court.minX + court.width * 0.231, y: court.midY))
                    p.addLine(to: CGPoint(x: court.minX + court.width * 0.769, y: court.midY))
                    // 단식 사이드라인
                    for f in [0.137, 0.863] {
                        let y = court.minY + court.height * f
                        p.move(to: CGPoint(x: court.minX, y: y)); p.addLine(to: CGPoint(x: court.maxX, y: y))
                    }
                }
                .stroke(.white.opacity(0.85), lineWidth: 2)
                Text(half.map { "시뮬레이터 · \($0.tag) 코트 카메라 자리 (16:9)" } ?? "시뮬레이터 · 카메라 자리 (16:9)")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.5))
                    .position(x: video.midX, y: video.minY + h * 0.88)
            }
            .onAppear { videoRect = video }
            .onChange(of: g.size) { videoRect = Self.fit16x9(in: CGRect(origin: .zero, size: g.size)) }
        }
    }

    static func fit16x9(in r: CGRect) -> CGRect {
        let ratio: CGFloat = 16.0 / 9.0
        var w = r.width, h = w / ratio
        if h > r.height { h = r.height; w = h * ratio }
        return CGRect(x: r.midX - w / 2, y: r.midY - h / 2, width: w, height: h)
    }
}

/// 프레임 안에 코트를 어디에 맞춰야 하는지 보여주는 안내선.
///
/// 9 m 떨어진 곳에 걸어놓고 각도를 맞춰야 하는데, 맨 화면만 보면 기준이 없다.
/// 네트가 가운데 수직으로 서고 양쪽 베이스라인이 프레임 안에 들어오면 맞다.
struct CourtGuide: View {
    /// 득점 탭이 켜져 있나. 꺼져 있으면 좌우 구역을 흐리게 둔다.
    let active: Bool
    var showGuide = true
    /// 영상이 실제로 보이는 영역. 안내선은 화면이 아니라 영상에 맞춘다. nil 이면 화면 전체.
    var videoRect: CGRect? = nil
    /// 양쪽 카메라 모드. 네트선 대신 화면 가운데가 두 카메라의 경계다.
    var dual = false

    private let ball = Color(red: 0.85, green: 0.95, blue: 0.25)

    var body: some View {
        GeometryReader { g in
            let v = videoRect ?? CGRect(origin: .zero, size: g.size)
            let w = v.width, h = v.height, x0 = v.minX, y0 = v.minY
            ZStack {
                if showGuide && dual {
                    // 두 카메라의 경계. 네트가 아니라 폰의 힌지다.
                    Path { p in
                        p.move(to: CGPoint(x: g.size.width / 2, y: 0))
                        p.addLine(to: CGPoint(x: g.size.width / 2, y: g.size.height))
                    }
                    .stroke(ball.opacity(0.85), style: StrokeStyle(lineWidth: 2, dash: [9, 7]))
                } else if showGuide {
                    // 네트 — 영상 가운데 수직
                    Path { p in
                        p.move(to: CGPoint(x: x0 + w / 2, y: y0))
                        p.addLine(to: CGPoint(x: x0 + w / 2, y: y0 + h))
                    }
                    .stroke(ball.opacity(0.85), style: StrokeStyle(lineWidth: 2, dash: [9, 7]))

                    // 베이스라인이 들어와야 하는 지점 — 프레임 양 끝에서 조금 안쪽.
                    // 9.15 m 에서는 베이스라인 밖으로 0.78 m 여백이 생긴다(폭 25.34 m 중 23.77 m).
                    ForEach([0.031, 0.969], id: \.self) { f in
                        Path { p in
                            p.move(to: CGPoint(x: x0 + w * f, y: y0 + h * 0.18))
                            p.addLine(to: CGPoint(x: x0 + w * f, y: y0 + h * 0.82))
                        }
                        .stroke(.white.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [4, 6]))
                    }

                    // 코트 평면이 앉을 대략적인 띠
                    Rectangle()
                        .strokeBorder(.white.opacity(0.22), lineWidth: 1.5)
                        .frame(width: w * 0.94, height: h * 0.56)
                        .position(x: v.midX, y: v.midY)
                }

                // 좌/우 구역
                HStack(spacing: 0) {
                    zone("A", on: active)
                    zone("B", on: active)
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func zone(_ tag: String, on: Bool) -> some View {
        ZStack(alignment: .top) {
            Rectangle().fill(on ? ball.opacity(0.055) : .clear)
            Text(tag)
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(.black.opacity(0.55), in: Capsule())
                .foregroundStyle(on ? ball : .white.opacity(0.55))
                // 상단 바(카메라 표시·버튼들) 아래로 내린다. 8 이면 겹친다.
                .padding(.top, 64)
        }
    }
}
