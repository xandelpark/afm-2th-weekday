import SwiftUI
import PencilKit

@main
struct PobomNoteApp: App {
    var body: some Scene {
        WindowGroup {
            GalleryView().preferredColorScheme(.light)
        }
    }
}

/// 첫 화면: 새 그림 + 그린 그림들.
struct GalleryView: View {
    @State private var items: [Store.Item] = []
    @State private var path: [UUID] = []
    @State private var toDelete: Store.Item?
    @State private var toast: String?
    @State private var started = false

    var body: some View {
        NavigationStack(path: $path) {
            GeometryReader { geo in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text("포봄노트")
                                .font(.system(size: 36, weight: .heavy, design: .rounded))
                                .foregroundStyle(Theme.ink)
                            Text("봄이의 스케치북")
                                .font(.system(size: 16, weight: .semibold, design: .rounded))
                                .foregroundStyle(Theme.accent)
                        }
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 260), spacing: 16)], spacing: 16) {
                            Button { newSketch(landscape: geo.size.width >= geo.size.height) } label: { NewCard() }
                                .buttonStyle(.plain)
                            ForEach(items) { it in
                                Button { path.append(it.id) } label: { Thumb(item: it) }
                                    .buttonStyle(.plain)
                                    .contextMenu {
                                        Button("사진에 저장", systemImage: "square.and.arrow.down") { saveToPhotos(it) }
                                        Button("지우기", systemImage: "trash", role: .destructive) { toDelete = it }
                                    }
                            }
                        }
                    }
                    .padding(22)
                }
            }
            .background(Theme.bg.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: UUID.self) { id in EditorScreen(id: id) }
            .overlay(alignment: .bottom) {
                if let toast {
                    Text(toast)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .padding(.horizontal, 18).padding(.vertical, 10)
                        .background(Capsule().fill(Theme.ink.opacity(0.88)))
                        .foregroundStyle(.white)
                        .padding(.bottom, 24)
                        .transition(.opacity)
                }
            }
            .alert("이 그림을 지울까요?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } })) {
                Button("지우기", role: .destructive) {
                    if let d = toDelete { Store.delete(d.id); reload() }
                }
                Button("그만두기", role: .cancel) {}
            } message: {
                Text("지운 그림은 다시 살릴 수 없어요")
            }
        }
        .onAppear {
            reload()
            guard !started else { return }
            started = true
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-demo") {
                let s = DemoSketch.make()
                Store.save(s, thumb: Renderer.image(of: s, maxSide: 480)?.pngData())
                reload()
                if !ProcessInfo.processInfo.arguments.contains("-demo-gallery") { path = [s.id] }
            }
            #endif
        }
        .onChange(of: path) { _, p in if p.isEmpty { reload() } }
    }

    private func reload() { items = Store.list() }

    private func newSketch(landscape: Bool) {
        let s = Sketch.blank(landscape: landscape)
        Store.save(s, thumb: nil)
        path.append(s.id)
    }

    private func saveToPhotos(_ it: Store.Item) {
        guard let s = Store.load(it.id) else { return }
        Task {
            let ok = await PhotoSaver.save(s)
            show(ok ? "사진 앱에 저장했어요" : "사진 앱에 저장하지 못했어요")
        }
    }

    private func show(_ t: String) {
        withAnimation { toast = t }
        Task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation { toast = nil }
        }
    }
}

struct NewCard: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "plus")
                .font(.system(size: 38, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 70, height: 70)
                .background(Circle().fill(Theme.accent))
            Text("새 그림")
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.ink)
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(1.3, contentMode: .fit)
        .background(RoundedRectangle(cornerRadius: 20).strokeBorder(Theme.accent.opacity(0.5), style: StrokeStyle(lineWidth: 3, dash: [9, 7])))
        .contentShape(Rectangle())
    }
}

struct Thumb: View {
    let item: Store.Item
    @State private var img: UIImage?
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20).fill(.white)
            if let img {
                Image(uiImage: img).resizable().scaledToFit().padding(8)
            }
        }
        .aspectRatio(1.3, contentMode: .fit)
        .shadow(color: Color(red: 0.45, green: 0.3, blue: 0.2).opacity(0.14), radius: 8, y: 3)
        .task(id: item.modified) { img = UIImage(contentsOfFile: Store.thumb(item.id).path) }
    }
}

#if DEBUG
/// 시뮬레이터 화면 확인용 그림: 크레파스 해·풀, 색연필 구름, 도장들.
enum DemoSketch {
    static func stroke(_ ink: PKInk.InkType, _ c: UInt32, _ w: CGFloat, _ pts: [CGPoint], u: CGFloat) -> PKStroke {
        let sp = pts.enumerated().map { i, p in
            PKStrokePoint(location: CGPoint(x: p.x * u, y: p.y * u), timeOffset: Double(i) * 0.016,
                          size: CGSize(width: w, height: w), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKStroke(ink: PKInk(ink, color: RGBA(hex: c).ui), path: PKStrokePath(controlPoints: sp, creationDate: Date()))
    }

    @MainActor
    static func make() -> Sketch {
        var s = Sketch.blank(landscape: true)
        let u: CGFloat = 0.45
        func ring(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, turns: CGFloat = 1) -> [CGPoint] {
            (0...Int(60 * turns)).map { i in
                let a = CGFloat(i) / 60 * 2 * .pi
                return CGPoint(x: cx + r * cos(a), y: cy + r * sin(a))
            }
        }
        func line(_ a: CGPoint, _ b: CGPoint, wave: CGFloat = 0) -> [CGPoint] {
            (0...40).map { i in
                let t = CGFloat(i) / 40
                return CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + sin(t * 18) * wave)
            }
        }
        var strokes: [PKStroke] = []
        // 해 (크레파스)
        for r in stride(from: 20, through: 110, by: 18) { strokes.append(stroke(.crayon, 0xFFB400, 24, ring(1180, 220, CGFloat(r)), u: u)) }
        for i in 0..<10 {
            let a = CGFloat(i) / 10 * 2 * .pi
            strokes.append(stroke(.crayon, 0xFF8A00, 18, line(CGPoint(x: 1180 + 140 * cos(a), y: 220 + 140 * sin(a)),
                                                               CGPoint(x: 1180 + 200 * cos(a), y: 220 + 200 * sin(a))), u: u))
        }
        // 풀밭 (카키 크레파스)
        for y in stride(from: 820, through: 990, by: 26) {
            strokes.append(stroke(.crayon, 0x7A7A3A, 30, line(CGPoint(x: 20, y: CGFloat(y)), CGPoint(x: 1420, y: CGFloat(y)), wave: 10), u: u))
        }
        // 구름 (색연필)
        for (cx, r) in [(260.0, 70.0), (350.0, 90.0), (450.0, 70.0)] {
            strokes.append(stroke(.pencil, 0x3B7BE8, 5, ring(cx, 230, r), u: u))
        }
        for st in strokes { s.ops.append(.ink(PKDrawing(strokes: [st]).dataRepresentation(), Double(u))) }
        // 지우개 한 줄 (해를 조금 지움)
        s.ops.append(.erase(line(CGPoint(x: 1100, y: 330), CGPoint(x: 1260, y: 330)), 26))
        // 도장
        let stamps: [(String, UInt32, Double, Double, Double)] = [
            ("star.fill", 0xFFD23F, 600, 160, 90), ("star.fill", 0xFF7EB6, 760, 260, 70), ("star.fill", 0x8E5CD9, 900, 130, 60),
            ("heart.fill", 0xF2545B, 420, 600, 130), ("heart.fill", 0xFF7EB6, 560, 680, 90),
            ("art.cat", 0x8B5E3C, 820, 690, 190), ("rainbow", 0x2EC4E6, 230, 520, 170),
            ("art.rabbit", 0xFF7EB6, 620, 470, 170), ("art.chick", 0xFFB400, 1000, 560, 130),
            ("art.bear", 0x7A7A3A, 140, 760, 150), ("art.frog", 0x4CB944, 400, 880, 110),
            ("camera.macro", 0xFF7EB6, 1100, 760, 120), ("camera.macro", 0xFFD23F, 1240, 790, 100),
            ("pawprint.fill", 0x7A7A3A, 980, 900, 60), ("pawprint.fill", 0x7A7A3A, 1060, 870, 60),
        ]
        for (sym, c, x, y, size) in stamps {
            s.ops.append(.stamp(Stamp(symbol: sym, color: RGBA(hex: c), x: x, y: y, size: size, angle: Double.random(in: -0.15...0.15),
                                      seed: UInt32.random(in: 1...UInt32.max), ink: 1)))
        }
        return s
    }
}
#endif
