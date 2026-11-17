import Foundation
import AVFoundation
import CoreImage
import CoreGraphics
import ImageIO

// MARK: - 맞춤 값

/// B 영상을 A 화면 위 어디에, 몇 배로 얹을지. 좌표는 A 화면(회전 반영) 기준, 원점 왼쪽 위.
///
/// 두 카메라는 화각이 다르다. 2026-11-03 실측: 같은 사람이 A(뒷면)에서 B(앞면)보다 약 1.5배 크게 찍혔다.
/// 그래서 B 를 그 배율만큼 키워 크기를 맞추고, 겹치는 띠에서는 레이어처럼 한 영상을 위에 올린다.
/// 위 영상이 덮은 곳에서는 아래 영상의 사람·물건이 안 보인다 — 같은 사람이 두 번 나오지 않는다.
struct StitchAlign: Codable, Equatable, Sendable {
    /// B 픽셀 1 이 A 픽셀 몇 개인가 (회전 반영 화면 기준).
    var scale: Double
    /// B 왼쪽 위 모서리 자리. A 폭·높이에 대한 비율.
    var x: Double
    var y: Double
    /// 겹친 띠에서 위에 올릴 영상. 0 = A, 1 = B.
    var top: Int = 0
    /// 위 영상의 안쪽 가장자리를 더 걷어낼 비율(위 영상 폭 기준). 0 = 겹친 띠 전부를 위 영상이 덮는다.
    var seam: Double = 0
    /// B 색에 곱해 A 와 맞추는 배수 R·G·B (선형). 두 카메라 노출·색이 조금씩 다르다.
    var gain: [Double]? = nil
    /// 자동 맞춤의 일치도(0~1). 손으로 바꾸면 nil.
    var score: Double? = nil

    /// 맞춤 없이 나란히: B 를 A 높이에 맞춰 바로 오른쪽에.
    static func sideBySide(a: CGSize, b: CGSize) -> StitchAlign {
        StitchAlign(scale: Double(a.height / max(1, b.height)), x: 1, y: 0)
    }

    /// 배율만 바꾼다. 겹친 띠(A 오른쪽 끝, 높이 가운데)가 제자리에 있도록 위치를 같이 옮긴다.
    func withScale(_ s2: Double, a: CGSize) -> StitchAlign {
        let ax = Double(a.width), ay = Double(a.height) / 2
        let lx = (ax - x * Double(a.width)) / scale, ly = (ay - y * Double(a.height)) / scale
        var n = self
        n.scale = s2
        n.x = (ax - s2 * lx) / Double(a.width)
        n.y = (ay - s2 * ly) / Double(a.height)
        n.score = nil
        return n
    }

    /// B 를 위아래 가운데에 놓았을 때의 y. "위아래" 조절은 여기서 얼마나 벗어났는지로 보여준다.
    func centeredY(a: CGSize, b: CGSize) -> Double { (1 - scale * Double(b.height / a.height)) / 2 }
}

/// 맞춤 값을 픽셀 자리로 푼 것. 그리기·내보내기·화면이 같은 계산을 쓴다.
struct StitchLayout: Sendable {
    let a: CGSize, b: CGSize          // 회전 반영 화면 크기
    let align: StitchAlign
    let bRect: CGRect                 // A 좌표(원점 왼쪽 위)에서 B 가 차지하는 자리
    let canvas: CGRect                // 결과 화면. 가로 = 둘을 합친 폭, 세로 = 둘 다 있는 높이

    init(a: CGSize, b: CGSize, align: StitchAlign) {
        self.a = a; self.b = b; self.align = align
        let s = CGFloat(align.scale)
        let br = CGRect(x: CGFloat(align.x) * a.width, y: CGFloat(align.y) * a.height,
                        width: b.width * s, height: b.height * s)
        bRect = br
        let minX = min(0, br.minX), maxX = max(a.width, br.maxX)
        var minY = max(0, br.minY), maxY = min(a.height, br.maxY)
        // 위아래가 거의 안 겹치면(맞춤이 크게 틀린 것) 잘라내지 말고 다 보여준다.
        if maxY - minY < a.height * 0.25 { minY = min(0, br.minY); maxY = max(a.height, br.maxY) }
        canvas = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    /// 겹친 폭(A 픽셀). 0 이하면 나란히 붙은 것.
    var overlap: CGFloat { a.width - bRect.minX }

    /// 긴 변이 maxSide 를 넘지 않는 짝수 크기. 인코더는 짝수를 원한다.
    func renderSize(maxSide: CGFloat) -> CGSize {
        let k = min(1, maxSide / max(canvas.width, canvas.height))
        return CGSize(width: max(2, CGFloat(Int(canvas.width * k) / 2 * 2)),
                      height: max(2, CGFloat(Int(canvas.height * k) / 2 * 2)))
    }

    /// 위 영상이 끝나는 x (A 픽셀). 이 선이 이음매다.
    var seamX: CGFloat {
        let f = feather
        if align.top == 0 {
            return max(bRect.minX + f, a.width * (1 - CGFloat(align.seam)))
        } else {
            return min(a.width - f, bRect.minX + bRect.width * CGFloat(align.seam))
        }
    }

    /// 이음매를 부드럽게 섞는 폭. 넓으면 어긋난 곳이 두 겹으로 비친다 — 좁게.
    var feather: CGFloat { overlap > 2 ? max(2, min(overlap * 0.25, canvas.width * 0.005)) : 0 }
}

// MARK: - 합치기

/// A·B 두 영상을 한 화면으로. 다시 보기(실시간)와 합본 파일 내보내기가 같은 그리기를 쓴다.
/// 원본은 손대지 않고 폴더에 `합본.mov` 를 새로 쓴다.
enum Stitch {
    static let fileName = "합본.mov"

    enum Quality: String, CaseIterable, Identifiable {
        case full, half
        var id: String { rawValue }
        var label: String { self == .full ? "원본 크기" : "절반 크기 (빠름)" }
        /// 결과 긴 변 상한.
        var maxSide: CGFloat { self == .full ? 3840 : 1920 }
    }

    enum Err: LocalizedError {
        case needTwo, noTrack, cancelled, failed(String)
        var errorDescription: String? {
            switch self {
            case .needTwo: return "영상이 두 개 있어야 합친다"
            case .noTrack: return "영상 트랙을 읽을 수 없다"
            case .cancelled: return "취소됨"
            case .failed(let s): return s
            }
        }
    }

    /// 그리기 공용. CIContext 는 여러 스레드에서 같이 써도 된다.
    static let ctx = CIContext(options: [.cacheIntermediates: false])
    static let video709 = CGColorSpace(name: CGColorSpace.itur_709)!

    /// 트랙의 preferredTransform → 세워 보이게 돌리는 방향. 거울상은 녹화 때 꺼 두었다.
    static func orientation(_ t: CGAffineTransform) -> CGImagePropertyOrientation {
        switch (t.a.rounded(), t.b.rounded(), t.c.rounded(), t.d.rounded()) {
        case (0, 1, -1, 0): return .right
        case (0, -1, 1, 0): return .left
        case (-1, 0, 0, -1): return .down
        default: return .up
        }
    }

    /// 돌리고 원점을 0 으로.
    static func upright(_ i: CIImage, _ o: CGImagePropertyOrientation) -> CIImage {
        let r = i.oriented(o)
        return r.transformed(by: CGAffineTransform(translationX: -r.extent.minX, y: -r.extent.minY))
    }

    /// A·B 프레임 한 쌍을 한 장으로. a·b 는 `upright` 를 거친 그림. 결과 크기는 out.
    static func compose(a: CIImage, b: CIImage, layout L: StitchLayout, out: CGSize) -> CIImage {
        let H = L.a.height
        let s = CGFloat(L.align.scale)
        // CI 는 원점이 왼쪽 아래다. A 좌표(왼쪽 위)의 y 를 뒤집어 놓는다.
        var bImg = b.transformed(by: CGAffineTransform(scaleX: s, y: s))
            .transformed(by: CGAffineTransform(translationX: L.bRect.minX, y: H - L.bRect.maxY))
        var aImg = a
        // 아래 영상 색을 위 영상에 맞춘다.
        if let g = L.align.gain, g.count == 3 {
            if L.align.top == 0 { bImg = tint(bImg, g) } else { aImg = tint(aImg, g.map { 1 / $0 }) }
        }
        let topIsA = L.align.top == 0
        var top = topIsA ? aImg : bImg
        let bottom = topIsA ? bImg : aImg

        // 이음매: 위 영상을 seamX 에서 끊는다. 좁은 폭만 섞어서 색 경계가 칼선처럼 보이지 않게.
        if L.overlap > 2 {
            let x = L.seamX, f = L.feather
            let (p0, p1, c0, c1): (CGFloat, CGFloat, CIColor, CIColor) = topIsA
                ? (x - f, x, .white, .black)      // A 가 위: 이음매 왼쪽만 A
                : (x, x + f, .black, .white)      // B 가 위: 이음매 오른쪽만 B
            let mask = CIFilter(name: "CILinearGradient", parameters: [
                "inputPoint0": CIVector(x: p0, y: 0), "inputPoint1": CIVector(x: p1, y: 0),
                "inputColor0": c0, "inputColor1": c1,
            ])?.outputImage ?? CIImage(color: .white)
            top = top.applyingFilter("CIBlendWithMask", parameters: [
                kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: mask,
            ])
        }

        let c = CGRect(x: L.canvas.minX, y: H - L.canvas.maxY, width: L.canvas.width, height: L.canvas.height)
        var img = top.composited(over: bottom)
            .composited(over: CIImage(color: .black).cropped(to: c))
            .cropped(to: c)
            .transformed(by: CGAffineTransform(translationX: -c.minX, y: -c.minY))
        let kx = out.width / c.width, ky = out.height / c.height
        if ky < 0.75 {
            // 많이 줄일 땐 란초스로 — 그냥 줄이면 그물망·네트가 물결무늬로 깨진다.
            img = img.applyingFilter("CILanczosScaleTransform", parameters: [
                kCIInputScaleKey: ky, kCIInputAspectRatioKey: kx / ky,
            ])
        } else {
            img = img.transformed(by: CGAffineTransform(scaleX: kx, y: ky))
        }
        return img.cropped(to: CGRect(origin: .zero, size: out))
    }

    private static func tint(_ i: CIImage, _ g: [Double]) -> CIImage {
        i.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: g[0], y: 0, z: 0, w: 0),
            "inputGVector": CIVector(x: 0, y: g[1], z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: g[2], w: 0),
        ])
    }

    /// 두 영상을 한 타임라인에 올린 것. 맞춤 값이 바뀌면 `videoComposition` 만 다시 만든다.
    struct Sources: @unchecked Sendable {
        let comp: AVMutableComposition
        let trackA: CMPersistentTrackID, trackB: CMPersistentTrackID
        let a: CGSize, b: CGSize
        let orientA: CGImagePropertyOrientation, orientB: CGImagePropertyOrientation
        let duration: CMTime

        static func load(_ videos: [URL]) async throws -> Sources {
            guard videos.count >= 2 else { throw Err.needTwo }
            let assetA = AVURLAsset(url: videos[0]), assetB = AVURLAsset(url: videos[1])
            guard let ta = try await assetA.loadTracks(withMediaType: .video).first,
                  let tb = try await assetB.loadTracks(withMediaType: .video).first else { throw Err.noTrack }
            let (nsA, tfA) = try await ta.load(.naturalSize, .preferredTransform)
            let (nsB, tfB) = try await tb.load(.naturalSize, .preferredTransform)
            let durA = try await assetA.load(.duration), durB = try await assetB.load(.duration)
            let duration = CMTimeMinimum(durA, durB)

            let comp = AVMutableComposition()
            guard let vA = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
                  let vB = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
            else { throw Err.noTrack }
            let range = CMTimeRange(start: .zero, duration: duration)
            try vA.insertTimeRange(range, of: ta, at: .zero)
            try vB.insertTimeRange(range, of: tb, at: .zero)
            // 소리는 A 쪽만. 두 마이크를 섞으면 울린다.
            if let audio = try await assetA.loadTracks(withMediaType: .audio).first,
               let au = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                try? au.insertTimeRange(range, of: audio, at: .zero)
            }
            func shown(_ n: CGSize, _ t: CGAffineTransform) -> CGSize {
                let r = CGRect(origin: .zero, size: n).applying(t)
                return CGSize(width: abs(r.width), height: abs(r.height))
            }
            return Sources(comp: comp, trackA: vA.trackID, trackB: vB.trackID,
                           a: shown(nsA, tfA), b: shown(nsB, tfB),
                           orientA: orientation(tfA), orientB: orientation(tfB), duration: duration)
        }

        func layout(_ align: StitchAlign) -> StitchLayout { StitchLayout(a: a, b: b, align: align) }

        func videoComposition(align: StitchAlign, maxSide: CGFloat) -> AVMutableVideoComposition {
            let L = layout(align)
            let vc = AVMutableVideoComposition()
            vc.customVideoCompositorClass = StitchCompositor.self
            vc.renderSize = L.renderSize(maxSide: maxSide)
            vc.frameDuration = CMTime(value: 1, timescale: 30)
            vc.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
            vc.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
            vc.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
            vc.instructions = [StitchInstruction(range: CMTimeRange(start: .zero, duration: duration),
                                                 trackA: trackA, trackB: trackB,
                                                 orientA: orientA, orientB: orientB, layout: L)]
            return vc
        }
    }

    private final class SessionBox: @unchecked Sendable {
        let session: AVAssetExportSession
        init(_ s: AVAssetExportSession) { session = s }
    }

    /// 합본 파일을 만든다. - progress: 0~1.
    static func export(folder: URL, videos: [URL], align: StitchAlign, quality: Quality,
                       progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        let src = try await Sources.load(videos)
        let vc = src.videoComposition(align: align, maxSide: quality.maxSide)

        let out = folder.appendingPathComponent(fileName)
        try? FileManager.default.removeItem(at: out)
        guard let session = AVAssetExportSession(asset: src.comp, presetName: AVAssetExportPresetHEVCHighestQuality)
        else { throw Err.failed("내보내기 세션을 만들 수 없다") }
        session.videoComposition = vc
        session.shouldOptimizeForNetworkUse = true

        // AVAssetExportSession 은 Sendable 이 아니다. 진행률 관찰만 다른 태스크에서 하므로 상자에 담아 넘긴다.
        let boxed = SessionBox(session)
        let watcher = Task {
            for await state in boxed.session.states(updateInterval: 0.5) {
                if case .exporting(let p) = state { progress(p.fractionCompleted) }
            }
        }
        defer { watcher.cancel() }
        do {
            try await session.export(to: out, as: .mov)
        } catch {
            if (error as? CancellationError) != nil { throw Err.cancelled }
            throw Err.failed(error.localizedDescription)
        }
        progress(1)
        return out
    }
}

// MARK: - 프레임마다 그리는 쪽

/// 합치기 설정을 들고 다니는 지시서. AVFoundation 이 프레임마다 컴포지터에 넘겨준다.
final class StitchInstruction: NSObject, AVVideoCompositionInstructionProtocol, @unchecked Sendable {
    let timeRange: CMTimeRange
    let enablePostProcessing = false
    let containsTweening = true
    let requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID = kCMPersistentTrackID_Invalid
    let trackA: CMPersistentTrackID, trackB: CMPersistentTrackID
    let orientA: CGImagePropertyOrientation, orientB: CGImagePropertyOrientation
    let layout: StitchLayout

    init(range: CMTimeRange, trackA: CMPersistentTrackID, trackB: CMPersistentTrackID,
         orientA: CGImagePropertyOrientation, orientB: CGImagePropertyOrientation, layout: StitchLayout) {
        timeRange = range
        self.trackA = trackA; self.trackB = trackB
        self.orientA = orientA; self.orientB = orientB
        self.layout = layout
        requiredSourceTrackIDs = [NSNumber(value: trackA), NSNumber(value: trackB)]
    }
}

/// A·B 프레임을 받아 `Stitch.compose` 로 한 장을 그린다.
final class StitchCompositor: NSObject, AVVideoCompositing, @unchecked Sendable {
    let sourcePixelBufferAttributes: [String: any Sendable]? = [
        kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
                                                     kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
                                                     kCVPixelFormatType_32BGRA],
        kCVPixelBufferMetalCompatibilityKey as String: true,
    ]
    let requiredPixelBufferAttributesForRenderContext: [String: any Sendable] = [
        kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_32BGRA],
        kCVPixelBufferMetalCompatibilityKey as String: true,
    ]

    func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

    func startRequest(_ req: AVAsynchronousVideoCompositionRequest) {
        guard let ins = req.videoCompositionInstruction as? StitchInstruction,
              let fa = req.sourceFrame(byTrackID: ins.trackA),
              let fb = req.sourceFrame(byTrackID: ins.trackB),
              let out = req.renderContext.newPixelBuffer() else {
            req.finish(with: NSError(domain: "Stitch", code: -1,
                                     userInfo: [NSLocalizedDescriptionKey: "프레임을 받지 못했다"]))
            return
        }
        let size = req.renderContext.size
        let a = Stitch.upright(CIImage(cvPixelBuffer: fa), ins.orientA)
        let b = Stitch.upright(CIImage(cvPixelBuffer: fb), ins.orientB)
        let img = Stitch.compose(a: a, b: b, layout: ins.layout, out: size)
        Stitch.ctx.render(img, to: out, bounds: CGRect(origin: .zero, size: size), colorSpace: Stitch.video709)
        req.finish(withComposedVideoFrame: out)
    }

    func cancelAllPendingVideoCompositionRequests() {}
}

// MARK: - 자동 맞춤

/// 같은 시각의 A·B 프레임을 비교해 B 의 배율과 자리를 찾는다.
///
/// 사진 정합(Vision)은 거의 같은 장면끼리만 맞춘다 — 배율이 1.5배씩 다르고 겹침이 20% 남짓이면 엉뚱한 답을 낸다.
/// 그래서 직접 찾는다: 윤곽(밝기 기울기) 그림을 작게 만들어, 배율 × 좌우 × 위아래를 전부 대 보고
/// 겹친 띠가 가장 닮은 자리(정규화 상관)를 고른 뒤, 해상도를 올려 가며 다듬는다.
/// 그물망처럼 잔 무늬는 작은 그림에서 뭉개져 헷갈리지 않는다. B 는 A 의 오른쪽에 있다고 본다.
enum StitchAligner {
    struct Plane { let w: Int; let h: Int; var v: [Float] }

    struct Result: Sendable {
        var align: StitchAlign
        /// 서로 다른 두 시각의 프레임에서 같은 답이 나왔나. 아니면 화면에 "확인해 달라" 를 띄운다.
        var trusted: Bool
    }

    /// 영상 두 개를 맞춘다. 앞쪽·뒤쪽 두 시각의 프레임에서 따로 찾아 답이 같으면 믿는다.
    /// - scaleHint: 지난번에 믿을 만했던 배율. 화각 비율은 기기마다 고정이라, 있으면 그 근처(±3%)만 찾는다
    ///   (폰을 뒤집어 A·B 가 바뀌었을 수 있어 역수도 본다). 그걸로 답이 안 맞으면 전 범위로 다시 찾는다.
    /// - at: 이 시각 근처(그 시각과 0.7초 뒤) 프레임으로 맞춘다. nil 이면 영상 30%·70% 지점.
    static func estimate(videos: [URL], at: Double? = nil, scaleHint: Double? = nil,
                         trace: (@Sendable (String) -> Void)? = nil) async -> Result? {
        guard videos.count > 1, let src = try? await Stitch.Sources.load(Array(videos.prefix(2))) else { return nil }
        let dur = CMTimeGetSeconds(src.duration)
        let times: [Double]
        if let at { times = [at, at + 0.7].map { max(0, min($0, dur - 0.1)) } }
        else { times = dur < 1.5 ? [dur / 2] : [dur * 0.3, dur * 0.7].map { min($0, dur - 0.1) } }
        var pairs: [(CIImage, CIImage, Double)] = []      // A, B, 작은 그림 배율 → 화면 배율
        for t in times {
            let time = CMTime(seconds: max(0, t), preferredTimescale: 600)
            var imgs: [CGImage] = []
            for v in videos.prefix(2) {
                let g = AVAssetImageGenerator(asset: AVURLAsset(url: v))
                g.appliesPreferredTrackTransform = true
                g.maximumSize = CGSize(width: 1280, height: 1280)
                g.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 30)
                g.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)
                guard let (img, _) = try? await g.image(at: time) else { return nil }
                imgs.append(img)
            }
            let ka = CGFloat(imgs[0].width) / src.a.width, kb = CGFloat(imgs[1].width) / src.b.width
            pairs.append((CIImage(cgImage: imgs[0]), CIImage(cgImage: imgs[1]), Double(kb / ka)))
        }

        func run(_ range: [ClosedRange<Double>]?) -> Result? {
            var found: [StitchAlign] = []
            for (a, b, k) in pairs {
                // 힌트는 화면 배율 → 작은 그림 배율로.
                let r = range?.map { ($0.lowerBound / k)...($0.upperBound / k) }
                guard var al = estimate(a: a, b: b, scales: r, displayK: k, trace: trace) else { continue }
                al.scale *= k
                found.append(al)
            }
            guard let best = found.max(by: { ($0.score ?? 0) < ($1.score ?? 0) }) else { return nil }
            let agree = found.count == pairs.count && found.allSatisfy {
                abs($0.scale / best.scale - 1) < 0.03 && abs($0.x - best.x) < 0.015 && abs($0.y - best.y) < 0.025
            }
            trace?(String(format: "결과 %d개, 일치 %@", found.count, agree ? "예" : "아니오"))
            return Result(align: best, trusted: agree)
        }

        if let h = scaleHint, h > 0 {
            let near = [(h * 0.97)...(h * 1.03), (0.97 / h)...(1.03 / h)]
            if let r = run(near), r.trusted { return r }
        }
        return run(nil)
    }

    /// 두 그림(세워 놓은 것) 사이 맞춤. scale 은 이 그림들 픽셀 기준.
    /// - scales: 찾을 배율 범위(이 그림들 픽셀 기준). nil 이면 0.4~2.5 전부.
    /// - displayK: 이 그림 배율 → 화면 배율 (A·B 해상도가 다를 때만 1 이 아니다).
    static func estimate(a: CIImage, b: CIImage, scales: [ClosedRange<Double>]? = nil, displayK: Double = 1,
                         trace: (@Sendable (String) -> Void)? = nil) -> StitchAlign? {
        let ctx = Stitch.ctx
        let wa = a.extent.width, wb = b.extent.width
        var cacheA: [Int: Plane] = [:], cacheB: [Int: Plane] = [:]
        func planeA(_ w: Int) -> Plane? {
            if let p = cacheA[w] { return p }
            let p = edges(a, width: w, ctx: ctx); cacheA[w] = p; return p
        }
        func planeB(_ w: Int) -> Plane? {
            if let p = cacheB[w] { return p }
            let p = edges(b, width: w, ctx: ctx); cacheB[w] = p; return p
        }

        // 1) 거친 단계: A 폭 64. 배율 0.4~2.5 를 1% 간격으로.
        struct Cand { var s: Double; var bw: Int; var tx: Int; var ty: Int; var score: Double }
        let W0 = 64
        guard let A0 = planeA(W0) else { return nil }
        let k0 = Double(W0) / wa
        var perScale: [Cand] = []
        var grid: [Double] = []
        for r in scales ?? [0.4...2.5] {
            var v = r.lowerBound
            while v <= r.upperBound { grid.append(v); v *= 1.01 }
        }
        var seen = Set<Int>()
        for s in grid {
            let bw = Int((Double(wb) * s * k0).rounded())
            if bw >= 8, seen.insert(bw).inserted, let B = planeB(bw) {
                let minOv = max(3, Int(Double(W0) * 0.06)), maxOv = Int(Double(W0) * 0.8)
                let txLo = max(1, W0 - min(maxOv, B.w - 1)), txHi = W0 - minOv
                let tyc = (A0.h - B.h) / 2, tyR = Int(Double(A0.h) * 0.15)
                if txLo <= txHi, let best = search(A0, B, tx: txLo...txHi, ty: (tyc - tyR)...(tyc + tyR)) {
                    perScale.append(Cand(s: s, bw: bw, tx: best.tx, ty: best.ty, score: best.score))
                }
            }
        }
        // 서로 다른 후보 몇 개만 남긴다.
        var cands: [Cand] = []
        for c in perScale.sorted(by: { $0.score > $1.score }) {
            if cands.contains(where: { abs(log($0.s / c.s)) < 0.04 && abs($0.tx - c.tx) <= 3 }) { continue }
            cands.append(c)
            if cands.count == 6 { break }
        }
        guard !cands.isEmpty else { return nil }
        trace?("거친 후보: " + cands.map { String(format: "s%.3f tx%d ty%d %.3f", $0.s, $0.tx, $0.ty, $0.score) }.joined(separator: " | "))

        // 2) 해상도를 두 배씩 올리며 다듬는다.
        var W = W0
        var topA = true
        for (level, keep) in [(128, 3), (256, 2), (512, 1)] {
            let f = Double(level) / Double(W)
            W = level
            guard let A = planeA(W) else { return nil }
            // 이음매는 위 영상의 안쪽 끝. 더 촘촘한(배율 큰) 쪽이 위로 간다 — B 를 키워야 하면 A 가 위.
            if level == 256 { topA = cands[0].s * displayK >= 1 }
            let bandW = Int(Double(W) * 0.12)
            let band: Band = level < 256 ? .all : (topA ? .aRight(bandW) : .bLeft(bandW))
            var next: [Cand] = []
            for c in cands {
                let bw0 = Int((Double(c.bw) * f).rounded())
                let tx0 = Int((Double(c.tx) * f).rounded()), ty0 = Int((Double(c.ty) * f).rounded())
                var best = c; best.score = -2
                let dw = level >= 512 ? 6 : 3
                for bw in (bw0 - dw)...(bw0 + dw) where bw >= 8 {
                    guard let B = planeB(bw) else { continue }
                    if let r = search(A, B, tx: (tx0 - 2)...(tx0 + 2), ty: (ty0 - 2)...(ty0 + 2), band: band), r.score > best.score {
                        best = Cand(s: Double(bw) / (Double(wb) * Double(W) / wa), bw: bw, tx: r.tx, ty: r.ty, score: r.score)
                    }
                }
                if best.score > -2 { next.append(best) }
            }
            cands = Array(next.sorted { $0.score > $1.score }.prefix(keep))
            guard !cands.isEmpty else { return nil }
            trace?("\(level): " + cands.map { String(format: "s%.4f tx%d ty%d %.3f", $0.s, $0.tx, $0.ty, $0.score) }.joined(separator: " | "))
        }
        let c = cands[0]
        let k = Double(W) / wa
        let ha = Double(a.extent.height)
        var out = StitchAlign(scale: c.s, x: Double(c.tx) / k / wa, y: Double(c.ty) / k / ha)
        out.score = max(0, c.score)
        out.gain = gain(a: a, b: b, align: out)
        out.top = topA ? 0 : 1
        return out
    }

    /// 비교할 세로 띠. 이음매에서만 맞으면 된다 — 겹친 띠 전체는 두 카메라가 40° 가까이 틀어져 있어
    /// 한 배율로 다 맞지 않는다(띠 양 끝에서 크기 비가 20% 가까이 다르다). 그래서 다듬을 때는 이음매 근처만 본다.
    enum Band { case all, aRight(Int), bLeft(Int) }

    /// 정수 이동 범위 안에서 정규화 상관이 가장 큰 자리. 겹친 띠가 너무 작으면 건너뛴다.
    static func search(_ A: Plane, _ B: Plane, tx: ClosedRange<Int>, ty: ClosedRange<Int>, band: Band = .all) -> (tx: Int, ty: Int, score: Double)? {
        var best: (Int, Int, Double)?
        for y in ty {
            for x in tx {
                guard let r = ncc(A, B, tx: x, ty: y, band: band) else { continue }
                // 작은 띠는 우연히 닮기 쉽다 — 픽셀 수가 적으면 조금 깎는다.
                let sc = r.score - 1.5 / Double(r.n).squareRoot()
                if best == nil || sc > best!.2 { best = (x, y, sc) }
            }
        }
        return best.map { ($0.0, $0.1, $0.2) }
    }

    /// A(x,y) 와 B(x − tx, y − ty) 의 정규화 상관.
    static func ncc(_ A: Plane, _ B: Plane, tx: Int, ty: Int, band: Band = .all) -> (score: Double, n: Int)? {
        var x0 = max(0, tx), x1 = min(A.w, tx + B.w)
        switch band {
        case .all: break
        case .aRight(let w): x0 = max(x0, A.w - w)
        case .bLeft(let w): x1 = min(x1, tx + w)
        }
        let y0 = max(0, ty), y1 = min(A.h, ty + B.h)
        guard x1 - x0 >= 3, y1 - y0 >= A.h / 2 else { return nil }
        var sa = 0.0, sb = 0.0, saa = 0.0, sbb = 0.0, sab = 0.0
        A.v.withUnsafeBufferPointer { pa in
            B.v.withUnsafeBufferPointer { pb in
                for y in y0..<y1 {
                    let ra = y * A.w, rb = (y - ty) * B.w - tx
                    var a1: Float = 0, b1: Float = 0, aa: Float = 0, bb: Float = 0, ab: Float = 0
                    for x in x0..<x1 {
                        let u = pa[ra + x], v = pb[rb + x]
                        a1 += u; b1 += v; aa += u * u; bb += v * v; ab += u * v
                    }
                    sa += Double(a1); sb += Double(b1); saa += Double(aa); sbb += Double(bb); sab += Double(ab)
                }
            }
        }
        let n = Double((x1 - x0) * (y1 - y0))
        let va = n * saa - sa * sa, vb = n * sbb - sb * sb
        guard va > 1e-9, vb > 1e-9 else { return nil }
        return ((n * sab - sa * sb) / (va * vb).squareRoot(), Int(n))
    }

    /// 폭 w 로 줄인 밝기의 윤곽 세기(가로·세로 기울기 합). 노출 차이에 덜 흔들린다.
    static func edges(_ img: CIImage, width w: Int, ctx: CIContext) -> Plane? {
        guard let g = gray(img, width: w, ctx: ctx) else { return nil }
        var out = [Float](repeating: 0, count: g.w * g.h)
        for y in 1..<(g.h - 1) {
            for x in 1..<(g.w - 1) {
                let i = y * g.w + x
                out[i] = abs(g.v[i + 1] - g.v[i - 1]) + abs(g.v[i + g.w] - g.v[i - g.w])
            }
        }
        return Plane(w: g.w, h: g.h, v: out)
    }

    static func gray(_ img: CIImage, width w: Int, ctx: CIContext) -> Plane? {
        guard let (px, h) = rgba(img, width: w, ctx: ctx) else { return nil }
        var v = [Float](repeating: 0, count: w * h)
        for i in 0..<(w * h) {
            v[i] = 0.299 * Float(px[i * 4]) + 0.587 * Float(px[i * 4 + 1]) + 0.114 * Float(px[i * 4 + 2])
        }
        return Plane(w: w, h: h, v: v)
    }

    /// 폭 w 로 줄여 RGBA8 로 꺼낸다. 행은 위에서 아래.
    static func rgba(_ img: CIImage, width w: Int, ctx: CIContext,
                     space: CGColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!) -> ([UInt8], Int)? {
        let e = img.extent
        guard w > 2, e.width > 2 else { return nil }
        let k = CGFloat(w) / e.width
        let h = max(3, Int((e.height * k).rounded()))
        let small = img.transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
            .applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: k, kCIInputAspectRatioKey: 1.0])
            .clampedToExtent()
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        ctx.render(small, toBitmap: &buf, rowBytes: w * 4, bounds: CGRect(x: 0, y: 0, width: w, height: h),
                   format: .RGBA8, colorSpace: space)
        return (buf, h)
    }

    /// 겹친 띠에서 B 에 곱할 색 배수 (선형 공간). 같은 자리 픽셀끼리 밝기 비율을 모아 중앙값을 쓴다.
    /// 평균을 쓰면 한쪽 카메라 바로 앞에만 있는 물건(시차로 다른 쪽엔 다른 게 보이는 곳)에 끌려간다.
    static func gain(a: CIImage, b: CIImage, align: StitchAlign) -> [Double]? {
        let W = 160
        let lin = CGColorSpace(name: CGColorSpace.linearSRGB)!
        let k = Double(W) / a.extent.width
        let bw = Int((b.extent.width * align.scale * k).rounded())
        guard let (pa, ha) = rgba(a, width: W, ctx: Stitch.ctx, space: lin),
              let (pb, hb) = rgba(b, width: bw, ctx: Stitch.ctx, space: lin) else { return nil }
        let tx = Int((align.x * a.extent.width * k).rounded()), ty = Int((align.y * a.extent.height * k).rounded())
        var ratios: [[Double]] = [[], [], []]
        for y in max(0, ty)..<min(ha, ty + hb) {
            for x in max(0, tx)..<min(W, tx + bw) {
                let ia = (y * W + x) * 4, ib = ((y - ty) * bw + (x - tx)) * 4
                for c in 0..<3 {
                    let va = Double(pa[ia + c]), vb = Double(pb[ib + c])
                    // 너무 어둡거나 하얗게 날아간 곳은 비율이 의미 없다.
                    guard va > 8, vb > 8, va < 245, vb < 245 else { continue }
                    ratios[c].append(va / vb)
                }
            }
        }
        guard ratios.allSatisfy({ $0.count > 50 }) else { return nil }
        return ratios.map { r in
            let m = r.sorted()[r.count / 2]
            return min(1.35, max(0.75, m))
        }
    }
}

// MARK: - 저장

/// 경기 폴더의 `보기설정.json`. 다시 보기에서 고른 보기 방식과 맞춤 값.
struct StitchPrefs: Codable, Equatable {
    /// 합쳐 보기(겹쳐 한 화면) / 나란히.
    var merge: Bool = true
    var align: StitchAlign? = nil
    /// 자동 맞춤이 낸 값. 손으로 바꾼 뒤 "처음 값" 으로 돌아갈 때 쓴다.
    var auto: StitchAlign? = nil

    static func url(_ folder: URL) -> URL { folder.appendingPathComponent("보기설정.json") }
    static func load(_ folder: URL) -> StitchPrefs? {
        guard let d = try? Data(contentsOf: url(folder)) else { return nil }
        return try? JSONDecoder().decode(StitchPrefs.self, from: d)
    }
    func save(_ folder: URL) {
        let e = JSONEncoder(); e.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let d = try? e.encode(self) { try? d.write(to: Self.url(folder)) }
    }

    /// 지난번에 믿을 만했던 B→A 배율. 두 카메라 화각 비율은 기기마다 고정이라 다음 자동 맞춤의 힌트로 쓴다.
    static var cameraScale: Double? {
        get { UserDefaults.standard.object(forKey: "camScale") as? Double }
        set { UserDefaults.standard.set(newValue, forKey: "camScale") }
    }

    /// 경기 하나의 맞춤 값을 정한다: 저장된 값 → 자동 맞춤 → 나란히.
    /// 세로로 찍은(힌지 세움) 두 영상일 때만 겹쳐 맞춘다. 가로(텐트)는 겹침이 위쪽이라 나란히.
    static func resolve(folder: URL, videos: [URL]) async -> (prefs: StitchPrefs, note: String?) {
        if let p = load(folder), p.align != nil { return (p, nil) }
        guard videos.count > 1, let src = try? await Stitch.Sources.load(videos) else { return (StitchPrefs(merge: false), nil) }
        let side = StitchAlign.sideBySide(a: src.a, b: src.b)
        guard src.a.height > src.a.width else { return (StitchPrefs(merge: false, align: side), nil) }
        if let r = await StitchAligner.estimate(videos: videos, scaleHint: cameraScale) {
            let p = StitchPrefs(merge: true, align: r.align, auto: r.align)
            p.save(folder)
            if r.trusted { cameraScale = r.align.scale; return (p, nil) }
            return (p, "자동 맞춤이 확실하지 않다 — 어긋나 보이면 '맞춤' 에서 손봐 달라")
        }
        return (StitchPrefs(merge: false, align: side), "자동 맞춤을 못 했다 — '맞춤' 에서 직접 맞춰 달라")
    }
}
