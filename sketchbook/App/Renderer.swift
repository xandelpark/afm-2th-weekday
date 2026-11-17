import UIKit
import PencilKit

/// 그림 목록(Op)을 비트맵에 그린다. 화면·미리보기·사진 저장이 모두 이걸 쓴다.
/// 비트맵 좌표는 캔버스 단위(위가 0), 픽셀은 단위당 k 개.
@MainActor
enum Renderer {
    static let space = CGColorSpace(name: CGColorSpace.displayP3) ?? CGColorSpaceCreateDeviceRGB()

    static func makeContext(canvas: CGSize, k: CGFloat) -> CGContext? {
        let w = max(1, Int((canvas.width * k).rounded())), h = max(1, Int((canvas.height * k).rounded()))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: CGFloat(w) / canvas.width, y: -CGFloat(h) / canvas.height)
        ctx.interpolationQuality = .high
        return ctx
    }

    /// 종이부터 다시 그린다 (마지막 '다 지우기' 뒤만).
    static func paintAll(_ s: Sketch, into ctx: CGContext, k: CGFloat) {
        paper(ctx, s.size)
        paint(s.visibleOps, into: ctx, canvas: s.size, k: k)
    }

    /// 몇 개만 이어서 그린다. 이어진 획들은 한 번에 그려 빠르다.
    static func paint(_ ops: ArraySlice<Op>, into ctx: CGContext, canvas: CGSize, k: CGFloat) {
        UIGraphicsPushContext(ctx)
        defer { UIGraphicsPopContext() }
        var pending: (PKDrawing, Double)?
        func flush() {
            if let (d, u) = pending { ink(d, unit: u, canvas: canvas, k: k) }
            pending = nil
        }
        for op in ops {
            switch op {
            case .ink(let data, let u):
                guard let d = try? PKDrawing(data: data) else { continue }
                if let (pd, pu) = pending, pu == u { pending = (pd.appending(d), u) } else { flush(); pending = (d, u) }
            case .erase(let pts, let w):
                flush(); erase(pts, width: w, ctx: ctx)
            case .stamp(let st):
                flush(); stamp(st, ctx: ctx, k: k)
            case .clear:
                flush(); paper(ctx, canvas)
            }
        }
        flush()
    }

    static func paper(_ ctx: CGContext, _ canvas: CGSize) {
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.fill(CGRect(origin: .zero, size: canvas))
    }

    /// PencilKit 이 직접 그린 그림을 붙인다 — 그래서 메모앱과 같은 색연필·크레파스 결이 나온다.
    static func ink(_ d: PKDrawing, unit u: Double, canvas: CGSize, k: CGFloat) {
        let u = CGFloat(u)
        let inDrawing = CGRect(x: 0, y: 0, width: canvas.width * u, height: canvas.height * u)
        let b = d.bounds.intersection(inDrawing)
        guard !b.isNull, !b.isEmpty else { return }
        // 픽셀 격자에 맞춘다 — 반 픽셀 밀려 다 그린 획이 흐려지지 않게.
        let px = CGRect(x: b.minX / u * k, y: b.minY / u * k, width: b.width / u * k, height: b.height / u * k).integral
        let r = CGRect(x: px.minX / k, y: px.minY / k, width: px.width / k, height: px.height / k)
        let dr = CGRect(x: r.minX * u, y: r.minY * u, width: r.width * u, height: r.height * u)
        var img: UIImage?
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
            img = d.image(from: dr, scale: k / u)
        }
        img?.draw(in: r)
    }

    static func erase(_ pts: [CGPoint], width: Double, ctx: CGContext) {
        guard let p0 = pts.first else { return }
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.setStrokeColor(UIColor.white.cgColor)
        if pts.count == 1 {
            ctx.fillEllipse(in: CGRect(x: p0.x - width / 2, y: p0.y - width / 2, width: width, height: width))
            return
        }
        ctx.setLineWidth(width)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        ctx.addPath(smooth(pts))
        ctx.strokePath()
    }

    /// 점들을 부드러운 선으로 (중점 사이를 2차 곡선으로).
    static func smooth(_ pts: [CGPoint]) -> CGPath {
        let p = CGMutablePath()
        guard let first = pts.first else { return p }
        p.move(to: first)
        if pts.count < 3 {
            for q in pts.dropFirst() { p.addLine(to: q) }
            return p
        }
        for i in 1..<(pts.count - 1) {
            let mid = CGPoint(x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2)
            p.addQuadCurve(to: mid, control: pts[i])
        }
        p.addLine(to: pts[pts.count - 1])
        return p
    }

    static func symbol(_ name: String, color: UIColor) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 160, weight: .semibold))?
            .withTintColor(color, renderingMode: .alwaysOriginal)
    }

    private static var aspects: [String: CGFloat] = [:]
    /// 도장 모양의 가로/세로 비.
    static func aspect(_ name: String) -> CGFloat {
        if let a = aspects[name] { return a }
        var a: CGFloat = 1
        if !StampArt.has(name), let img = symbol(name, color: .white) { a = img.size.width / max(1, img.size.height) }
        aspects[name] = a
        return a
    }

    /// 도장 자국이 들어갈 자리 — 가운데가 (0,0), 긴 변이 size.
    static func stampRect(_ name: String, size: CGFloat) -> CGRect {
        let a = aspect(name)
        let w = a >= 1 ? size : size * a, h = a >= 1 ? size / a : size
        return CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
    }

    /// 고무도장 자국: 결이 있는 마스크로 잉크를 찍는다.
    /// 곱하기로 한 번(아래 그림과 잉크가 섞여 겹친 곳이 진해진다) + 보통으로 조금(어두운 바탕에서도 색이 보이게).
    static func stamp(_ st: Stamp, ctx: CGContext, k: CGFloat) {
        let r = stampRect(st.symbol, size: st.size)
        let w = Int((r.width * k).rounded(.up)), h = Int((r.height * k).rounded(.up))
        let seed = st.seed ?? UInt32(truncatingIfNeeded: Int(st.x * 31 + st.y * 17))
        guard let mask = StampInk.mask(symbol: st.symbol, seed: seed, w: w, h: h) else { return }
        let ink = CGFloat(st.ink ?? 1)
        ctx.saveGState()
        ctx.translateBy(x: st.x, y: st.y)
        ctx.rotate(by: st.angle)
        ctx.scaleBy(x: 1, y: -1)   // 마스크 이미지는 아래가 0 — 위가 0 인 좌표라 뒤집는다 (r 은 위아래 대칭)
        ctx.clip(to: r, mask: mask)
        ctx.setBlendMode(.multiply)
        ctx.setFillColor(st.color.ui.withAlphaComponent(0.92 * ink).cgColor)
        ctx.fill(r)
        ctx.setBlendMode(.normal)
        ctx.setFillColor(st.color.ui.withAlphaComponent(0.32 * ink).cgColor)
        ctx.fill(r)
        ctx.restoreGState()
    }

    /// 그림 한 장을 통째로 (미리보기·사진 저장). 긴 변이 maxSide 픽셀.
    static func image(of s: Sketch, maxSide: CGFloat) -> UIImage? {
        let k = maxSide / max(s.width, s.height)
        guard let ctx = makeContext(canvas: s.size, k: k) else { return nil }
        paintAll(s, into: ctx, k: k)
        return ctx.makeImage().map { UIImage(cgImage: $0) }
    }
}
