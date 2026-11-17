import UIKit

/// 고무도장 자국 만들기.
/// 도장 모양(SF Symbol)을 회색 마스크로 그린 뒤 결을 입힌다:
///  - 가장자리: 살짝 흐린 모양에 잡음을 더해 다시 자른다 → 잉크가 번지거나 덜 묻은 거친 테두리
///  - 빈 점: 잉크가 안 묻은 작은 점들 (종이 결)
///  - 얼룩·힘: 넓은 얼룩 + 한쪽이 더 세게 눌린 기울기
/// 같은 seed 면 언제 그려도 같은 자국이 나온다 (되돌리기·사진 저장 때 다시 그려도 같다).
@MainActor
enum StampInk {
    private static let cache = NSCache<NSString, CGImage>()

    /// 흰색(=잉크) / 검정(=빈 곳) 회색 마스크. w×h 픽셀.
    static func mask(symbol: String, seed: UInt32, w: Int, h: Int) -> CGImage? {
        let w = min(max(w, 4), 1200), h = min(max(h, 4), 1200)
        let key = "\(symbol)|\(seed)|\(w)x\(h)" as NSString
        if let m = cache.object(forKey: key) { return m }
        guard let shape = shapeAlpha(symbol: symbol, w: w, h: h) else { return nil }
        let out = texture(shape, w: w, h: h, seed: seed)
        guard let img = grayImage(out, w: w, h: h) else { return nil }
        cache.setObject(img, forKey: key, cost: w * h)
        return img
    }

    /// 도장 모양을 그대로(결 없이) 회색 버퍼로.
    private static func shapeAlpha(symbol: String, w: Int, h: Int) -> [Float]? {
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
        else { return nil }
        ctx.setFillColor(gray: 0, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: 1, y: -1)
        if StampArt.has(symbol) {
            StampArt.draw(symbol, in: ctx, rect: CGRect(x: 0, y: 0, width: w, height: h))
        } else {
            guard let img = Renderer.symbol(symbol, color: .white) else { return nil }
            UIGraphicsPushContext(ctx)
            img.draw(in: CGRect(x: 0, y: 0, width: w, height: h))
            UIGraphicsPopContext()
        }
        guard let data = ctx.data else { return nil }
        let p = data.bindMemory(to: UInt8.self, capacity: w * h)
        var a = [Float](repeating: 0, count: w * h)
        for i in 0..<(w * h) { a[i] = Float(p[i]) / 255 }
        return a
    }

    private static func texture(_ a: [Float], w: Int, h: Int, seed: UInt32) -> [UInt8] {
        let n = Float(max(w, h))
        // 살짝 흐리게 — 가장자리에 잡음을 섞을 여유
        // 작은 도장은 덜 흐리고 테두리 잡음도 줄인다 — 눈·입 같은 가는 틈이 메워지지 않게
        let small = n < 260
        let br = max(1, Int(n / 110))
        let blurred = small ? boxBlur(a, w: w, h: h, r: 1) : boxBlur(boxBlur(a, w: w, h: h, r: br), w: w, h: h, r: br)
        let edgeAmp: Float = small ? 0.38 : 0.6
        let cellEdge = max(1.5, n / 38)      // 테두리 울퉁불퉁
        let cellSpeck = max(1.2, n / 75)     // 빈 점
        let cellGrain = max(1.0, n / 160)    // 종이 결
        let cellBlot = max(3, n / 4.5)       // 넓은 얼룩
        // 힘이 쏠린 방향 (seed 로 정함)
        let ang = Float(hash(7, 7, seed)) * 2 * .pi
        let dx = cos(ang), dy = sin(ang)
        var out = [UInt8](repeating: 0, count: w * h)
        for y in 0..<h {
            let fy = Float(y)
            for x in 0..<w {
                let i = y * w + x
                let b = blurred[i]
                if b < 0.02 { continue }
                let fx = Float(x)
                let e = b + (noise(fx / cellEdge, fy / cellEdge, seed) - 0.5) * edgeAmp
                let edge = smooth(0.40, 0.60, e)
                if edge <= 0 { continue }
                let speck = 0.18 + 0.82 * smooth(0.14, 0.30, noise(fx / cellSpeck, fy / cellSpeck, seed &+ 101))
                let grain = 0.86 + 0.14 * noise(fx / cellGrain, fy / cellGrain, seed &+ 211)
                let blot = 0.78 + 0.22 * noise(fx / cellBlot, fy / cellBlot, seed &+ 307)
                let t = ((fx / Float(w) - 0.5) * dx + (fy / Float(h) - 0.5) * dy) * 2   // -1 … 1
                let press = min(1, 0.90 - 0.16 * t)
                let v = edge * speck * grain * blot * press
                out[i] = UInt8(max(0, min(255, v * 255)))
            }
        }
        return out
    }

    private static func grayImage(_ px: [UInt8], w: Int, h: Int) -> CGImage? {
        guard let provider = CGDataProvider(data: Data(px) as CFData) else { return nil }
        return CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w,
                       space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }

    // MARK: 계산 도구

    private static func boxBlur(_ s: [Float], w: Int, h: Int, r: Int) -> [Float] {
        var tmp = [Float](repeating: 0, count: w * h)
        var out = [Float](repeating: 0, count: w * h)
        let norm = 1 / Float(2 * r + 1)
        for y in 0..<h {
            var acc: Float = 0
            let row = y * w
            for x in -r...r { acc += s[row + min(max(x, 0), w - 1)] }
            for x in 0..<w {
                tmp[row + x] = acc * norm
                acc += s[row + min(x + r + 1, w - 1)] - s[row + max(x - r, 0)]
            }
        }
        for x in 0..<w {
            var acc: Float = 0
            for y in -r...r { acc += tmp[min(max(y, 0), h - 1) * w + x] }
            for y in 0..<h {
                out[y * w + x] = acc * norm
                acc += tmp[min(y + r + 1, h - 1) * w + x] - tmp[max(y - r, 0) * w + x]
            }
        }
        return out
    }

    @inline(__always) private static func smooth(_ a: Float, _ b: Float, _ x: Float) -> Float {
        let t = min(1, max(0, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)
    }

    @inline(__always) static func hash(_ x: Int32, _ y: Int32, _ s: UInt32) -> Float {
        var h = (UInt32(bitPattern: x) &* 0x8DA6_B343) ^ (UInt32(bitPattern: y) &* 0xD816_3841) ^ (s &* 0xCB1A_B31F)
        h ^= h >> 13
        h = h &* 0x5BD1_E995
        h ^= h >> 15
        return Float(h & 0xFF_FFFF) / Float(0x100_0000)
    }

    /// 부드러운 값 잡음 0…1
    @inline(__always) private static func noise(_ x: Float, _ y: Float, _ s: UInt32) -> Float {
        let xf = x.rounded(.down), yf = y.rounded(.down)
        let xi = Int32(xf), yi = Int32(yf)
        let fx = x - xf, fy = y - yf
        let ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
        let a = hash(xi, yi, s), b = hash(xi &+ 1, yi, s), c = hash(xi, yi &+ 1, s), d = hash(xi &+ 1, yi &+ 1, s)
        return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
    }

    // MARK: 화면에 보여 줄 작은 도장 그림 (도장 칸·도구 막대)

    private static let previewCache = NSCache<NSString, UIImage>()

    static func preview(_ name: String, color: RGBA, pt: CGFloat) -> UIImage? {
        let key = "\(name)|\(color.r),\(color.g),\(color.b)|\(Int(pt))" as NSString
        if let i = previewCache.object(forKey: key) { return i }
        let scale: CGFloat = 3
        let r = Renderer.stampRect(name, size: pt)
        guard let m = mask(symbol: name, seed: 4242, w: Int(r.width * scale), h: Int(r.height * scale)) else { return nil }
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = scale
        let img = UIGraphicsImageRenderer(size: r.size, format: fmt).image { c in
            let g = c.cgContext
            let box = CGRect(origin: .zero, size: r.size)
            g.translateBy(x: 0, y: r.height)
            g.scaleBy(x: 1, y: -1)
            g.clip(to: box, mask: m)
            g.setFillColor(color.ui.cgColor)
            g.fill(box)
        }
        previewCache.setObject(img, forKey: key)
        return img
    }

    // MARK: 도장 손잡이 (위에서 내려다본 나무 도장)

    private static let handleCache = NSCache<NSNumber, UIImage>()

    static func handle(side: CGFloat) -> UIImage {
        let key = NSNumber(value: Int(side.rounded()))
        if let i = handleCache.object(forKey: key) { return i }
        let s = CGFloat(key.intValue)
        let img = UIGraphicsImageRenderer(size: CGSize(width: s, height: s)).image { c in
            let g = c.cgContext
            let body = CGRect(x: 0, y: 0, width: s, height: s).insetBy(dx: s * 0.04, dy: s * 0.04)
            let bodyPath = UIBezierPath(roundedRect: body, cornerRadius: s * 0.16)
            // 나무 몸통
            g.saveGState()
            bodyPath.addClip()
            let wood = CGGradient(colorsSpace: nil, colors: [UIColor(red: 0.93, green: 0.76, blue: 0.56, alpha: 1).cgColor,
                                                             UIColor(red: 0.78, green: 0.56, blue: 0.36, alpha: 1).cgColor] as CFArray,
                                  locations: [0, 1])!
            g.drawLinearGradient(wood, start: CGPoint(x: 0, y: 0), end: CGPoint(x: s, y: s), options: [])
            // 나뭇결
            g.setStrokeColor(UIColor(red: 0.62, green: 0.42, blue: 0.25, alpha: 0.18).cgColor)
            g.setLineWidth(max(1, s * 0.012))
            for i in 0..<7 {
                let y = body.minY + body.height * (CGFloat(i) + 0.5) / 7
                g.move(to: CGPoint(x: body.minX, y: y))
                g.addCurve(to: CGPoint(x: body.maxX, y: y + s * 0.03),
                           control1: CGPoint(x: body.minX + s * 0.3, y: y - s * 0.04),
                           control2: CGPoint(x: body.minX + s * 0.6, y: y + s * 0.06))
            }
            g.strokePath()
            g.restoreGState()
            UIColor(red: 0.55, green: 0.36, blue: 0.2, alpha: 0.35).setStroke()
            bodyPath.lineWidth = max(1.5, s * 0.025)
            bodyPath.stroke()
            // 가운데 손잡이
            let r = s * 0.24
            let knob = CGRect(x: s / 2 - r, y: s / 2 - r, width: r * 2, height: r * 2)
            g.setShadow(offset: CGSize(width: 0, height: s * 0.03), blur: s * 0.06, color: UIColor.black.withAlphaComponent(0.3).cgColor)
            g.setFillColor(UIColor(red: 0.70, green: 0.47, blue: 0.28, alpha: 1).cgColor)
            g.fillEllipse(in: knob)
            g.setShadow(offset: .zero, blur: 0, color: nil)
            let shine = CGGradient(colorsSpace: nil, colors: [UIColor(white: 1, alpha: 0.55).cgColor, UIColor(white: 1, alpha: 0).cgColor] as CFArray,
                                   locations: [0, 1])!
            g.saveGState()
            g.addEllipse(in: knob)
            g.clip()
            g.drawRadialGradient(shine, startCenter: CGPoint(x: knob.midX - r * 0.35, y: knob.midY - r * 0.35), startRadius: 0,
                                 endCenter: CGPoint(x: knob.midX - r * 0.35, y: knob.midY - r * 0.35), endRadius: r * 1.1, options: [])
            g.restoreGState()
        }
        handleCache.setObject(img, forKey: key)
        return img
    }
}
