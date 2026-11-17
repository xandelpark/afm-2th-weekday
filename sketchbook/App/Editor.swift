import SwiftUI
import PencilKit

/// 고른 도구·색·크기. 앱을 껐다 켜도 남는다.
struct ToolPrefs: Codable {
    var tool: Tool = .crayon
    var colors: [Tool: RGBA] = [.pencil: RGBA(hex: 0x3B7BE8), .crayon: RGBA(hex: 0xF2545B), .stamp: RGBA(hex: 0xFF9F1C)]
    var sizes: [Tool: Int] = [.pencil: 1, .crayon: 1, .eraser: 1, .stamp: 1]
    var symbol = "art.bear"
    var rainbow = false
    var recents: [RGBA] = Palette.starter

    static let key = "도구설정"
    static func load() -> ToolPrefs {
        guard let d = UserDefaults.standard.data(forKey: key), let p = try? JSONDecoder().decode(ToolPrefs.self, from: d) else { return ToolPrefs() }
        return p
    }
    func save() { if let d = try? JSONEncoder().encode(self) { UserDefaults.standard.set(d, forKey: Self.key) } }
}

/// 그림 한 장을 고치는 동안의 상태. 화면(SwiftUI)과 캔버스(UIKit)가 같이 본다.
@MainActor
final class Editor: ObservableObject {
    @Published var prefs: ToolPrefs { didSet { prefs.save(); canvas?.applyTool() } }
    @Published var showStamps = false
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false

    private(set) var sketch: Sketch
    private var redoStack: [Op] = []
    private var dirty = false
    private var saveTask: Task<Void, Never>?
    weak var canvas: CanvasUIView?

    /// 굵기 3단계 (화면 포인트). 색연필 2.4~16, 크레파스 10~50 이 PencilKit 이 받는 범위.
    static let widths: [Tool: [CGFloat]] = [
        .pencil: [3, 6, 11], .crayon: [12, 22, 36], .eraser: [18, 34, 60], .stamp: [44, 70, 110],
    ]

    init(sketch: Sketch) {
        self.sketch = sketch
        self.prefs = ToolPrefs.load()
        canUndo = !sketch.ops.isEmpty
    }

    var tool: Tool {
        get { prefs.tool }
        set { prefs.tool = newValue }
    }
    func color(_ t: Tool) -> RGBA { t == .eraser ? RGBA(hex: 0xFFFFFF) : (prefs.colors[t] ?? RGBA(hex: 0x2B2B2B)) }
    func width(_ t: Tool) -> CGFloat { Self.widths[t]![min(2, max(0, prefs.sizes[t] ?? 1))] }

    /// 지금 도구에 색을 준다. 도장 색을 고르면 알록달록은 꺼진다.
    func setColor(_ c: RGBA, for t: Tool) {
        guard t != .eraser else { return }
        prefs.colors[t] = c
        if t == .stamp { prefs.rainbow = false }
    }
    /// 고르기 창을 닫을 때 — 최근 색 맨 앞에.
    func remember(_ c: RGBA) {
        var r = prefs.recents.filter { !$0.near(c) }
        r.insert(c, at: 0)
        prefs.recents = Array(r.prefix(12))
    }

    // MARK: 한 일 · 되돌리기

    func record(_ op: Op) {
        sketch.ops.append(op)
        redoStack.removeAll()
        changed()
    }

    func undo() {
        guard let op = sketch.ops.popLast() else { return }
        redoStack.append(op)
        canvas?.renderAll()
        changed()
    }

    func redo() {
        guard let op = redoStack.popLast() else { return }
        sketch.ops.append(op)
        canvas?.draw(op)
        changed()
    }

    var isBlank: Bool { sketch.visibleOps.isEmpty }

    func clearAll() {
        guard !isBlank else { return }
        canvas?.commit(.clear)
    }

    private func changed() {
        canUndo = !sketch.ops.isEmpty
        canRedo = !redoStack.isEmpty
        dirty = true
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.2))
            guard !Task.isCancelled else { return }
            self?.save()
        }
    }

    func save() {
        saveTask?.cancel()
        guard dirty else { return }
        dirty = false
        sketch.modified = Date()
        let thumb = canvas?.thumbnail() ?? Renderer.image(of: sketch, maxSide: 480)
        Store.save(sketch, thumb: thumb?.pngData())
    }

    /// 나갈 때. 아무것도 안 그린 새 종이는 남기지 않는다.
    func close() {
        if sketch.ops.isEmpty { saveTask?.cancel(); Store.delete(sketch.id); return }
        save()
    }
}

/// 종이 + 그리는 판. 색연필·크레파스는 PencilKit 이 받아 그리고, 손을 떼면 종이에 붙인다.
/// 지우개·도장은 이 뷰가 직접 손가락을 받는다.
@MainActor
final class CanvasUIView: UIView, PKCanvasViewDelegate {
    private unowned let ed: Editor
    private let paper = UIView()
    private let pk = PKCanvasView()
    private let eraserLayer = CAShapeLayer()
    private var ctx: CGContext?
    private var fit = CGRect.zero
    private var s: CGFloat = 1   // 화면 포인트 / 캔버스 단위
    private var k: CGFloat = 1   // 픽셀 / 캔버스 단위
    private var clearing = false
    private var touch: UITouch?
    private var erasePts: [CGPoint] = []
    private var lastStamp: CGPoint?
    private var inkLeft: Double = 1
    private var handleView: UIImageView?
    private let haptic = UIImpactFeedbackGenerator(style: .medium)

    init(ed: Editor) {
        self.ed = ed
        super.init(frame: .zero)
        backgroundColor = .clear
        isMultipleTouchEnabled = false

        paper.backgroundColor = .white
        paper.isUserInteractionEnabled = false
        paper.layer.contentsGravity = .resize
        paper.layer.shadowColor = UIColor(red: 0.45, green: 0.3, blue: 0.2, alpha: 1).cgColor
        paper.layer.shadowOpacity = 0.16
        paper.layer.shadowRadius = 12
        paper.layer.shadowOffset = CGSize(width: 0, height: 4)
        addSubview(paper)

        eraserLayer.fillColor = nil
        eraserLayer.strokeColor = UIColor.white.cgColor
        eraserLayer.lineCap = .round
        eraserLayer.lineJoin = .round
        paper.layer.addSublayer(eraserLayer)

        pk.backgroundColor = .clear
        pk.isOpaque = false
        pk.drawingPolicy = .anyInput
        pk.isScrollEnabled = false
        pk.contentInsetAdjustmentBehavior = .never
        pk.overrideUserInterfaceStyle = .light
        pk.delegate = self
        addSubview(pk)
        applyTool()
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let c = ed.sketch.size
        let area = bounds.insetBy(dx: 14, dy: 14)
        guard area.width > 10, area.height > 10 else { return }
        let sc = min(area.width / c.width, area.height / c.height)
        let f = CGRect(x: area.midX - c.width * sc / 2, y: area.midY - c.height * sc / 2, width: c.width * sc, height: c.height * sc)
        guard f != fit else { return }
        fit = f
        s = sc
        k = sc * traitCollection.displayScale
        CATransaction.begin(); CATransaction.setDisableActions(true)
        paper.frame = f
        pk.frame = f
        eraserLayer.frame = paper.bounds
        paper.layer.shadowPath = UIBezierPath(rect: paper.bounds).cgPath
        CATransaction.commit()
        ctx = Renderer.makeContext(canvas: c, k: k)
        renderAll()
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-demo-live"), !debugDone {
            debugDone = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.debugLive() }
        }
        #endif
    }

    #if DEBUG
    private var debugDone = false
    /// 손 대신 PencilKit 판에 획을 넣어 '손 떼면 종이로 옮기기' 와 도장 찍기를 확인한다.
    private func debugLive() {
        let before = ed.sketch.ops.count
        let pts = (0...40).map { i -> PKStrokePoint in
            let t = CGFloat(i) / 40
            let p = CGPoint(x: fit.width * (0.12 + 0.76 * t), y: fit.height * (0.45 + 0.12 * sin(t * 12)))
            return PKStrokePoint(location: p, timeOffset: Double(i) * 0.016, size: CGSize(width: 22, height: 22),
                                 opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let st = PKStroke(ink: PKInk(.crayon, color: ed.color(.crayon).ui), path: PKStrokePath(controlPoints: pts, creationDate: Date()))
        pk.drawing = PKDrawing(strokes: [st])
        let afterInk = ed.sketch.ops.count
        placeStamp(at: CGPoint(x: ed.sketch.width * 0.5, y: ed.sketch.height * 0.25))
        let line = "[검증] 획 \(before)→\(afterInk) (판에 남은 획 \(pk.drawing.strokes.count)), 도장 후 \(ed.sketch.ops.count), s=\(s)\n"
        try? line.write(to: Store.dir.deletingLastPathComponent().appendingPathComponent("검증.txt"), atomically: true, encoding: .utf8)
    }
    #endif

    func applyTool() {
        let t = ed.tool
        switch t {
        case .pencil, .crayon:
            pk.isUserInteractionEnabled = true
            let type: PKInk.InkType = t == .pencil ? .pencil : .crayon
            let w = min(max(ed.width(t), type.validWidthRange.lowerBound), type.validWidthRange.upperBound)
            pk.tool = PKInkingTool(type, color: ed.color(t).ui, width: w)
        case .eraser, .stamp:
            pk.isUserInteractionEnabled = false
        }
    }

    // MARK: 그리기

    func renderAll() {
        guard let ctx else { return }
        Renderer.paintAll(ed.sketch, into: ctx, k: k)
        show()
    }

    func draw(_ op: Op) {
        guard let ctx else { return }
        Renderer.paint([op][...], into: ctx, canvas: ed.sketch.size, k: k)
        show()
    }

    /// 새로 한 일: 종이에 그리고 목록에 남긴다.
    func commit(_ op: Op) {
        draw(op)
        ed.record(op)
    }

    private func show() {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        paper.layer.contents = ctx?.makeImage()
        CATransaction.commit()
    }

    func thumbnail() -> UIImage? {
        guard let img = ctx?.makeImage() else { return nil }
        let w = CGFloat(img.width), h = CGFloat(img.height)
        let sc = min(1, 480 / max(w, h))
        let size = CGSize(width: (w * sc).rounded(), height: (h * sc).rounded())
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
            UIImage(cgImage: img).draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // MARK: 색연필·크레파스 — 손을 떼면 PencilKit 판에서 종이로 옮긴다

    func canvasViewDrawingDidChange(_ cv: PKCanvasView) {
        guard !clearing, !cv.drawing.strokes.isEmpty else { return }
        let d = cv.drawing
        clearing = true
        cv.drawing = PKDrawing()
        clearing = false
        commit(.ink(d.dataRepresentation(), Double(s)))
    }

    func canvasViewDidBeginUsingTool(_ cv: PKCanvasView) {
        if ed.showStamps { ed.showStamps = false }
    }

    // MARK: 지우개·도장

    private func canvasPoint(_ p: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - fit.minX) / s, y: (p.y - fit.minY) / s)
    }

    private func onPaper(_ p: CGPoint) -> Bool { fit.insetBy(dx: -10, dy: -10).contains(p) }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard touch == nil, let t = touches.first else { return }
        if ed.showStamps { ed.showStamps = false; return }   // 도장 고르는 칸이 열려 있으면 닫기만
        let v = t.location(in: self)
        guard onPaper(v) else { return }
        let p = canvasPoint(v)
        switch ed.tool {
        case .stamp:
            touch = t
            inkLeft = 1
            showHandle(at: v)
            placeStamp(at: p)
            lastStamp = p
        case .eraser:
            touch = t
            erasePts = [p]
            updateEraser()
        default: break
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touch, touches.contains(t) else { return }
        let pts = (event?.coalescedTouches(for: t) ?? [t]).map { canvasPoint($0.location(in: self)) }
        switch ed.tool {
        case .eraser:
            erasePts += pts
            updateEraser()
        case .stamp:
            // 끌면 손잡이가 따라오고 도장이 줄지어 찍힌다 (점점 연해진다)
            handleView?.center = t.location(in: self)
            let gap = ed.width(.stamp) / s * 1.1
            for p in pts {
                if let l = lastStamp, hypot(p.x - l.x, p.y - l.y) >= gap {
                    placeStamp(at: p)
                    lastStamp = p
                }
            }
        default: break
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { finish(touches) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { finish(touches) }

    private func finish(_ touches: Set<UITouch>) {
        guard let t = touch, touches.contains(t) else { return }
        touch = nil
        lastStamp = nil
        liftHandle()
        if ed.tool == .eraser, !erasePts.isEmpty {
            let w = Double(ed.width(.eraser) / s)
            let pts = erasePts
            erasePts = []
            CATransaction.begin(); CATransaction.setDisableActions(true)
            eraserLayer.path = nil
            commit(.erase(pts, w))
            CATransaction.commit()
        }
    }

    private func updateEraser() {
        var pts = erasePts.map { CGPoint(x: $0.x * s, y: $0.y * s) }
        if pts.count == 1 { pts.append(CGPoint(x: pts[0].x + 0.01, y: pts[0].y)) }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        eraserLayer.lineWidth = ed.width(.eraser)
        eraserLayer.path = Renderer.smooth(pts)
        CATransaction.commit()
    }

    private func placeStamp(at p: CGPoint) {
        let color = ed.prefs.rainbow ? (Palette.rainbow.randomElement() ?? ed.color(.stamp)) : ed.color(.stamp)
        let st = Stamp(symbol: ed.prefs.symbol, color: color, x: p.x, y: p.y,
                       size: Double(ed.width(.stamp) / s), angle: Double.random(in: -0.16...0.16),
                       seed: UInt32.random(in: 1...UInt32.max), ink: inkLeft)
        commit(.stamp(st))
        haptic.impactOccurred(intensity: CGFloat(0.5 + 0.5 * inkLeft))
        Sfx.shared.thump(volume: Float(0.45 + 0.55 * inkLeft))
        pressHandle()
        inkLeft = max(0.6, inkLeft - 0.07)
    }

    // 나무 도장 손잡이: 손가락을 대면 종이를 꾹 누르고, 떼면 들리면서 자국이 드러난다.

    private func showHandle(at v: CGPoint) {
        handleView?.removeFromSuperview()
        let r = Renderer.stampRect(ed.prefs.symbol, size: ed.width(.stamp))
        let side = max(r.width, r.height) * 1.18
        let hv = UIImageView(image: StampInk.handle(side: side))
        hv.bounds = CGRect(x: 0, y: 0, width: side, height: side)
        hv.center = v
        hv.layer.shadowColor = UIColor.black.cgColor
        hv.layer.shadowOpacity = 0.28
        hv.layer.shadowRadius = 6
        hv.layer.shadowOffset = CGSize(width: 0, height: 3)
        hv.transform = CGAffineTransform(scaleX: 1.3, y: 1.3)
        hv.alpha = 0.4
        addSubview(hv)
        handleView = hv
        UIView.animate(withDuration: 0.08, delay: 0, options: [.curveEaseIn]) {
            hv.transform = .identity
            hv.alpha = 1
        }
    }

    private func pressHandle() {
        guard let hv = handleView else { return }
        UIView.animate(withDuration: 0.06, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
            hv.transform = CGAffineTransform(scaleX: 0.93, y: 0.93)
        } completion: { _ in
            UIView.animate(withDuration: 0.1, delay: 0, options: [.beginFromCurrentState]) { hv.transform = .identity }
        }
    }

    private func liftHandle() {
        guard let hv = handleView else { return }
        handleView = nil
        UIView.animate(withDuration: 0.24, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
            hv.transform = CGAffineTransform(scaleX: 1.4, y: 1.4).translatedBy(x: 0, y: -8)
            hv.alpha = 0
        } completion: { _ in
            hv.removeFromSuperview()
        }
    }
}

struct CanvasRep: UIViewRepresentable {
    let ed: Editor
    func makeUIView(context: Context) -> CanvasUIView {
        let v = CanvasUIView(ed: ed)
        ed.canvas = v
        return v
    }
    func updateUIView(_ v: CanvasUIView, context: Context) {}
}
