import SwiftUI
import PencilKit

/// 색. 고르기 창(UIColorPickerViewController)이 P3 색을 줄 수 있어 0~1 밖 값도 그대로 둔다.
struct RGBA: Codable, Hashable, Sendable {
    var r: Double, g: Double, b: Double, a: Double

    init(r: Double, g: Double, b: Double, a: Double = 1) { self.r = r; self.g = g; self.b = b; self.a = a }
    init(hex: UInt32) {
        self.init(r: Double((hex >> 16) & 0xFF) / 255, g: Double((hex >> 8) & 0xFF) / 255, b: Double(hex & 0xFF) / 255)
    }
    init(_ c: UIColor) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        self.init(r: r, g: g, b: b, a: a)
    }
    var ui: UIColor { UIColor(red: r, green: g, blue: b, alpha: a) }
    var color: Color { Color(uiColor: ui) }

    /// 거의 같은 색인지 — 최근 색 목록에 같은 색이 두 번 들어가지 않게.
    func near(_ o: RGBA) -> Bool { abs(r - o.r) + abs(g - o.g) + abs(b - o.b) < 0.03 }
}

enum Tool: String, Codable, CaseIterable, Identifiable, Sendable {
    case pencil, crayon, eraser, stamp
    var id: String { rawValue }
    var name: String {
        switch self {
        case .pencil: "색연필"
        case .crayon: "크레파스"
        case .eraser: "지우개"
        case .stamp: "도장"
        }
    }
}

/// 찍은 도장 하나. 위치·크기는 캔버스 단위.
struct Stamp: Codable, Hashable, Sendable {
    var symbol: String
    var color: RGBA
    var x: Double
    var y: Double
    var size: Double
    var angle: Double
    /// 잉크 결을 정하는 수. 같은 수면 다시 그려도 같은 자국.
    var seed: UInt32? = nil
    /// 잉크 양 (끌면서 여러 번 찍으면 점점 연해진다). 1 = 새로 묻힌 잉크.
    var ink: Double? = nil
}

/// 그림은 '한 일' 의 목록이다. 되돌리기는 마지막 일을 빼고 처음부터 다시 그린다.
enum Op: Codable, Sendable {
    /// 색연필·크레파스 한 획. PencilKit 데이터 + 그릴 때의 배율(화면 포인트 / 캔버스 단위).
    case ink(Data, Double)
    /// 지우개 한 번. 점은 캔버스 단위, 굵기도 캔버스 단위.
    case erase([CGPoint], Double)
    case stamp(Stamp)
    /// 다 지우기. 되돌리면 그림이 돌아온다.
    case clear
}

struct Sketch: Codable, Identifiable, Sendable {
    var id: UUID
    var created: Date
    var modified: Date
    /// 캔버스 크기(단위). 가로 그림 1440×1000, 세로 그림 1000×1440.
    var width: Double
    var height: Double
    var ops: [Op]

    static func blank(landscape: Bool) -> Sketch {
        Sketch(id: UUID(), created: Date(), modified: Date(),
               width: landscape ? 1440 : 1000, height: landscape ? 1000 : 1440, ops: [])
    }
    var size: CGSize { CGSize(width: width, height: height) }
    /// 마지막 '다 지우기' 뒤로 남은 일. 이게 비어 있으면 빈 종이다.
    var visibleOps: ArraySlice<Op> {
        if let i = ops.lastIndex(where: { if case .clear = $0 { true } else { false } }) {
            return ops[(i + 1)...]
        }
        return ops[...]
    }
}

/// 그림 파일. Documents/그림/<id>.json + 미리보기 <id>.png
enum Store {
    static var dir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("그림", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    static func file(_ id: UUID) -> URL { dir.appendingPathComponent("\(id.uuidString).json") }
    static func thumb(_ id: UUID) -> URL { dir.appendingPathComponent("\(id.uuidString).png") }

    struct Item: Identifiable, Hashable {
        let id: UUID
        let modified: Date
    }

    static func list() -> [Item] {
        let fm = FileManager.default
        let urls = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        return urls.filter { $0.pathExtension == "json" }.compactMap { u in
            guard let id = UUID(uuidString: u.deletingPathExtension().lastPathComponent) else { return nil }
            let d = (try? u.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return Item(id: id, modified: d)
        }
        .sorted { $0.modified > $1.modified }
    }

    static func load(_ id: UUID) -> Sketch? {
        guard let d = try? Data(contentsOf: file(id)) else { return nil }
        return try? JSONDecoder().decode(Sketch.self, from: d)
    }

    static func save(_ s: Sketch, thumb png: Data?) {
        if let d = try? JSONEncoder().encode(s) { try? d.write(to: file(s.id), options: .atomic) }
        if let png { try? png.write(to: thumb(s.id), options: .atomic) }
    }

    static func delete(_ id: UUID) {
        try? FileManager.default.removeItem(at: file(id))
        try? FileManager.default.removeItem(at: thumb(id))
    }
}

/// 크레파스 상자 같은 기본 색. 최근 색이 비어 있을 때 이걸로 채운다. (카키도 넣었다 — 봄이가 좋아한다)
enum Palette {
    static let starter: [RGBA] = [
        RGBA(hex: 0xF2545B), RGBA(hex: 0xFF9F1C), RGBA(hex: 0xFFD23F), RGBA(hex: 0x4CB944),
        RGBA(hex: 0x3B7BE8), RGBA(hex: 0x8E5CD9), RGBA(hex: 0xFF7EB6), RGBA(hex: 0x7A7A3A),
        RGBA(hex: 0x8B5E3C), RGBA(hex: 0x2B2B2B),
    ]
    /// 알록달록 도장: 찍을 때마다 이 중 하나.
    static let rainbow: [RGBA] = [
        RGBA(hex: 0xF2545B), RGBA(hex: 0xFF9F1C), RGBA(hex: 0xFFD23F), RGBA(hex: 0x4CB944),
        RGBA(hex: 0x2EC4E6), RGBA(hex: 0x3B7BE8), RGBA(hex: 0x8E5CD9), RGBA(hex: 0xFF7EB6),
    ]
}

/// 도장 모양 묶음. 동물은 직접 그린 얼굴(StampArt) + 기본 기호. 이 기기에 없는 기호는 빠진다.
enum Stamps {
    struct Group: Identifiable {
        let id: String
        let icon: String
        let names: [String]
    }
    private static func sf(_ names: [String]) -> [String] { names.filter { UIImage(systemName: $0) != nil } }

    static let groups: [Group] = [
        Group(id: "동물", icon: "art.bear", names: StampArt.items.map(\.name) + sf([
            "cat.fill", "dog.fill", "hare.fill", "tortoise.fill", "bird.fill", "fish.fill",
            "ladybug.fill", "ant.fill", "lizard.fill", "teddybear.fill", "pawprint.fill", "shoeprints.fill",
        ])),
        Group(id: "반짝", icon: "star.fill", names: sf([
            "star.fill", "heart.fill", "sparkle", "sun.max.fill", "moon.fill", "cloud.fill", "rainbow",
            "bolt.fill", "snowflake", "drop.fill", "flame.fill", "camera.macro", "leaf.fill", "tree.fill", "carrot.fill",
            "circle.fill", "square.fill", "triangle.fill", "diamond.fill", "hexagon.fill", "seal.fill",
            "suit.club.fill", "suit.spade.fill",
        ])),
        Group(id: "물건", icon: "car.fill", names: sf([
            "crown.fill", "balloon.fill", "gift.fill", "birthday.cake.fill", "party.popper.fill",
            "music.note", "bell.fill", "tennisball.fill", "car.fill", "bus.fill", "airplane", "sailboat.fill",
            "bicycle", "house.fill", "umbrella.fill", "face.smiling.inverse", "hand.thumbsup.fill",
        ])),
    ]
    static func group(of name: String) -> Int { groups.firstIndex { $0.names.contains(name) } ?? 0 }
}
