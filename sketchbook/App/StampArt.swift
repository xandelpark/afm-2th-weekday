import CoreGraphics
import Foundation

/// 직접 그린 귀여운 동물 도장. 100×100 칸 안에 흰색(=잉크)으로 모양, 검정(=빈 곳)으로 눈·코·테두리.
/// 고무도장처럼 한 가지 색으로 찍히고, 얼굴은 비워 둔 선으로 나타난다.
/// CoreGraphics 만 써서 맥에서도 그대로 돌려 볼 수 있다.
enum StampArt {
    struct Item: Sendable { let name: String; let title: String; let draw: @Sendable (Pen) -> Void }

    static let items: [Item] = [
        Item(name: "art.bear", title: "곰", draw: bear),
        Item(name: "art.rabbit", title: "토끼", draw: rabbit),
        Item(name: "art.cat", title: "고양이", draw: cat),
        Item(name: "art.dog", title: "강아지", draw: dog),
        Item(name: "art.pig", title: "돼지", draw: pig),
        Item(name: "art.chick", title: "병아리", draw: chick),
        Item(name: "art.frog", title: "개구리", draw: frog),
        Item(name: "art.mouse", title: "쥐", draw: mouse),
        Item(name: "art.lion", title: "사자", draw: lion),
        Item(name: "art.penguin", title: "펭귄", draw: penguin),
        Item(name: "art.owl", title: "부엉이", draw: owl),
        Item(name: "art.whale", title: "고래", draw: whale),
        Item(name: "art.octopus", title: "문어", draw: octopus),
        Item(name: "art.butterfly", title: "나비", draw: butterfly),
        Item(name: "art.snail", title: "달팽이", draw: snail),
        Item(name: "art.dino", title: "공룡", draw: dino),
    ]
    private static let byName: [String: Item] = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0) })

    static func has(_ name: String) -> Bool { byName[name] != nil }

    /// 회색 컨텍스트(위가 0 인 좌표)의 rect 에 그린다. 바탕은 검정이어야 한다.
    static func draw(_ name: String, in g: CGContext, rect: CGRect) {
        guard let it = byName[name] else { return }
        g.saveGState()
        g.translateBy(x: rect.minX, y: rect.minY)
        g.scaleBy(x: rect.width / 100, y: rect.height / 100)
        it.draw(Pen(g: g))
        g.restoreGState()
    }

    /// 그리기 도구. ink=true 면 잉크(흰색), false 면 비우기(검정).
    struct Pen {
        let g: CGContext
        private func set(_ ink: Bool) {
            g.setFillColor(gray: ink ? 1 : 0, alpha: 1)
            g.setStrokeColor(gray: ink ? 1 : 0, alpha: 1)
        }
        func circle(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ ink: Bool = true) {
            set(ink); g.fillEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
        }
        func ellipse(_ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat, _ ink: Bool = true, rot: CGFloat = 0) {
            set(ink)
            g.saveGState()
            g.translateBy(x: x, y: y)
            g.rotate(by: rot)
            g.fillEllipse(in: CGRect(x: -rx, y: -ry, width: rx * 2, height: ry * 2))
            g.restoreGState()
        }
        func ring(_ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat, _ w: CGFloat, _ ink: Bool = false) {
            set(ink)
            g.setLineWidth(w)
            g.strokeEllipse(in: CGRect(x: x - rx, y: y - ry, width: rx * 2, height: ry * 2))
        }
        func poly(_ pts: [(CGFloat, CGFloat)], _ ink: Bool = true) {
            set(ink)
            g.beginPath()
            g.addLines(between: pts.map { CGPoint(x: $0.0, y: $0.1) })
            g.closePath()
            g.fillPath()
        }
        func rrect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat, _ ink: Bool = true) {
            set(ink)
            g.addPath(CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: r, cornerHeight: r, transform: nil))
            g.fillPath()
        }
        /// 선. 점 두 개면 직선, 세 개면 (시작, 조절점, 끝) 곡선.
        func line(_ pts: [(CGFloat, CGFloat)], _ w: CGFloat, _ ink: Bool = false) {
            set(ink)
            g.setLineWidth(w)
            g.setLineCap(.round)
            g.setLineJoin(.round)
            g.beginPath()
            g.move(to: CGPoint(x: pts[0].0, y: pts[0].1))
            if pts.count == 3 {
                g.addQuadCurve(to: CGPoint(x: pts[2].0, y: pts[2].1), control: CGPoint(x: pts[1].0, y: pts[1].1))
            } else {
                for p in pts.dropFirst() { g.addLine(to: CGPoint(x: p.0, y: p.1)) }
            }
            g.strokePath()
        }
        /// 웃는 입: 코 아래로 짧게 내려와 양쪽으로 갈라진다.
        func mouth(_ x: CGFloat, _ y: CGFloat, _ s: CGFloat = 1, _ w: CGFloat = 2.3) {
            line([(x, y), (x, y + 3.5 * s)], w)
            line([(x, y + 3.5 * s), (x - 2 * s, y + 6 * s), (x - 5.5 * s, y + 5 * s)], w)
            line([(x, y + 3.5 * s), (x + 2 * s, y + 6 * s), (x + 5.5 * s, y + 5 * s)], w)
        }
    }

    // MARK: 동물들

    static func bear(_ p: Pen) {
        p.circle(22, 26, 14); p.circle(78, 26, 14)
        p.circle(22, 26, 6.5, false); p.circle(78, 26, 6.5, false)
        p.ellipse(50, 58, 42.5, 38.5, false)
        p.ellipse(50, 58, 40, 36)
        p.circle(35, 52, 4.6, false); p.circle(65, 52, 4.6, false)
        p.ring(50, 71, 14, 10.5, 2.8)
        p.ellipse(50, 66.5, 5.5, 3.8, false)
        p.mouth(50, 69, 0.9)
    }

    static func rabbit(_ p: Pen) {
        p.ellipse(35, 28, 10, 25, rot: -0.14); p.ellipse(65, 28, 10, 25, rot: 0.14)
        p.ellipse(35, 30, 4.2, 16, false, rot: -0.14); p.ellipse(65, 30, 4.2, 16, false, rot: 0.14)
        p.ellipse(50, 67, 36.5, 31.5, false)
        p.ellipse(50, 67, 34, 29)
        p.circle(38, 63, 4.2, false); p.circle(62, 63, 4.2, false)
        p.ellipse(50, 72, 4, 3, false)
        p.mouth(50, 74, 0.8)
    }

    static func cat(_ p: Pen) {
        p.poly([(13, 48), (21, 5), (47, 28)]); p.poly([(87, 48), (79, 5), (53, 28)])
        p.poly([(20, 38), (24, 15), (37, 28)], false); p.poly([(80, 38), (76, 15), (63, 28)], false)
        p.ellipse(50, 61, 40.5, 34.5, false)
        p.ellipse(50, 61, 38, 32)
        p.ellipse(36, 57, 4.5, 6.2, false); p.ellipse(64, 57, 4.5, 6.2, false)
        p.poly([(45.5, 66), (54.5, 66), (50, 71)], false)
        p.mouth(50, 70.5, 0.85)
        p.line([(17, 64), (31, 66.5)], 2); p.line([(17, 72), (31, 70.5)], 2)
        p.line([(83, 64), (69, 66.5)], 2); p.line([(83, 72), (69, 70.5)], 2)
    }

    static func dog(_ p: Pen) {
        p.ellipse(18, 50, 11, 24, rot: 0.38); p.ellipse(82, 50, 11, 24, rot: -0.38)
        p.ellipse(50, 53, 33.5, 37.5, false)
        p.ellipse(50, 53, 31, 35)
        p.circle(39, 46, 4.3, false); p.circle(61, 46, 4.3, false)
        p.ring(61, 46, 9.5, 9.5, 2.2)
        p.ellipse(50, 62, 8, 5.8, false)
        p.mouth(50, 66, 1.05)
    }

    static func pig(_ p: Pen) {
        p.ellipse(25, 22, 10, 14, rot: -0.7); p.ellipse(75, 22, 10, 14, rot: 0.7)
        p.ellipse(25, 23, 4.5, 7.5, false, rot: -0.7); p.ellipse(75, 23, 4.5, 7.5, false, rot: 0.7)
        p.circle(50, 57, 39.5, false)
        p.circle(50, 57, 37)
        p.circle(35, 48, 4, false); p.circle(65, 48, 4, false)
        p.ring(50, 66, 14, 10, 3)
        p.ellipse(45, 66, 2.6, 4, false); p.ellipse(55, 66, 2.6, 4, false)
    }

    static func chick(_ p: Pen) {
        p.ellipse(45, 17, 4, 9, rot: -0.45); p.ellipse(55, 16, 4, 10, rot: 0.35); p.ellipse(50, 14, 3.6, 9)
        p.circle(50, 59, 37)
        p.circle(38, 51, 4.2, false); p.circle(62, 51, 4.2, false)
        p.poly([(44, 59), (56, 59), (50, 68)], false)
        p.line([(19, 60), (22, 78), (33, 74)], 2.6); p.line([(81, 60), (78, 78), (67, 74)], 2.6)
    }

    static func frog(_ p: Pen) {
        p.circle(28, 33, 16); p.circle(72, 33, 16)
        p.ellipse(50, 63, 44, 30)
        p.circle(28, 33, 10, false); p.circle(72, 33, 10, false)
        p.circle(28, 33, 4.5); p.circle(72, 33, 4.5)
        p.circle(44, 56, 1.8, false); p.circle(56, 56, 1.8, false)
        p.line([(26, 69), (50, 86), (74, 69)], 3)
    }

    static func mouse(_ p: Pen) {
        p.circle(23, 31, 21); p.circle(77, 31, 21)
        p.circle(23, 31, 12, false); p.circle(77, 31, 12, false)
        p.ellipse(50, 63, 33, 30.5, false)
        p.ellipse(50, 63, 30.5, 28)
        p.circle(39, 59, 4, false); p.circle(61, 59, 4, false)
        p.circle(50, 71, 4.5, false)
        p.line([(23, 69), (37, 71)], 1.8); p.line([(23, 77), (37, 75)], 1.8)
        p.line([(77, 69), (63, 71)], 1.8); p.line([(77, 77), (63, 75)], 1.8)
    }

    static func lion(_ p: Pen) {
        for i in 0..<12 {
            let a = CGFloat(i) / 12 * 2 * .pi
            p.circle(50 + 34 * cos(a), 52 + 34 * sin(a), 12)
        }
        p.circle(50, 52, 36)
        p.circle(50, 52, 28, false)
        p.circle(50, 52, 25.5)
        p.circle(41, 47, 3.6, false); p.circle(59, 47, 3.6, false)
        p.poly([(45, 56), (55, 56), (50, 62)], false)
        p.mouth(50, 61.5, 0.85)
    }

    static func penguin(_ p: Pen) {
        p.ellipse(17, 60, 7, 20, rot: 0.38); p.ellipse(83, 60, 7, 20, rot: -0.38)
        p.ellipse(50, 54, 34, 45, false)
        p.ellipse(50, 54, 31.5, 42.5)
        p.ellipse(40, 96, 9, 3.5); p.ellipse(60, 96, 9, 3.5)
        p.ring(50, 70, 19, 23, 2.6)
        p.circle(40, 28, 3.6, false); p.circle(60, 28, 3.6, false)
        p.poly([(45, 35), (55, 35), (50, 43)], false)
    }

    static func owl(_ p: Pen) {
        p.poly([(15, 9), (26, 36), (41, 22)]); p.poly([(85, 9), (74, 36), (59, 22)])
        p.ellipse(50, 58, 36, 40)
        p.circle(35, 44, 13, false); p.circle(35, 44, 9); p.circle(35, 44, 4.5, false)
        p.circle(65, 44, 13, false); p.circle(65, 44, 9); p.circle(65, 44, 4.5, false)
        p.poly([(45.5, 53), (54.5, 53), (50, 62)], false)
        p.line([(19, 60), (20, 78), (28, 88)], 2.4); p.line([(81, 60), (80, 78), (72, 88)], 2.4)
    }

    static func whale(_ p: Pen) {
        p.line([(42, 46), (42, 30)], 4.5, true)
        p.circle(33, 24, 4.2); p.circle(42, 18, 4.8); p.circle(51, 24, 4.2)
        p.ellipse(44, 64, 38, 24)
        p.poly([(72, 58), (90, 36), (99, 42), (86, 60), (99, 78), (90, 84), (72, 70)])
        p.circle(24, 60, 3.6, false)
        p.line([(12, 68), (22, 75), (32, 71)], 2.4)
        p.line([(56, 70), (62, 76), (68, 70)], 2)
    }

    static func octopus(_ p: Pen) {
        for i in 0..<5 {
            let x = 22 + CGFloat(i) * 14
            p.ellipse(x, 74, 7, 19, rot: (CGFloat(i) - 2) * 0.28)
        }
        p.ellipse(50, 40, 33, 31)
        p.circle(40, 42, 4.2, false); p.circle(60, 42, 4.2, false)
        p.line([(44, 52), (50, 57), (56, 52)], 2.3)
    }

    static func butterfly(_ p: Pen) {
        p.ellipse(29, 36, 21, 17, rot: -0.5); p.ellipse(71, 36, 21, 17, rot: 0.5)
        p.ellipse(33, 67, 15, 13, rot: 0.5); p.ellipse(67, 67, 15, 13, rot: -0.5)
        p.circle(27, 34, 6, false); p.circle(73, 34, 6, false)
        p.circle(33, 68, 4, false); p.circle(67, 68, 4, false)
        p.ellipse(50, 53, 7.5, 29, false)
        p.ellipse(50, 53, 5, 27)
        p.line([(48, 27), (45, 15), (38, 10)], 2.6, true); p.line([(52, 27), (55, 15), (62, 10)], 2.6, true)
        p.circle(38, 10, 3.2); p.circle(62, 10, 3.2)
    }

    static func snail(_ p: Pen) {
        p.rrect(6, 74, 84, 16, 8)
        p.ellipse(84, 68, 9, 14)
        p.line([(81, 56), (77, 40)], 3, true); p.line([(88, 56), (92, 40)], 3, true)
        p.circle(77, 39, 3.6); p.circle(92, 39, 3.6)
        p.circle(86, 64, 2.2, false)
        p.circle(45, 50, 31, false)
        p.circle(45, 50, 28.5)
        var pts: [(CGFloat, CGFloat)] = []
        for t in 0...120 {
            let f = CGFloat(t) / 120
            let th = f * 4.3 * .pi
            let r = 2 + 21 * f
            pts.append((45 + r * cos(th), 50 + r * sin(th)))
        }
        p.line(pts, 3)
    }

    static func dino(_ p: Pen) {
        p.poly([(30, 56), (2, 78), (7, 82), (34, 70)])
        for (a, b, c) in [((28, 50), (34, 37), (41, 47)), ((38, 46), (45, 32), (52, 44)),
                          ((49, 44), (56, 32), (62, 45)), ((59, 47), (66, 37), (71, 51))] as [((CGFloat, CGFloat), (CGFloat, CGFloat), (CGFloat, CGFloat))] {
            p.poly([a, b, c])
        }
        p.ellipse(48, 62, 27, 18)
        p.rrect(30, 66, 11, 26, 5); p.rrect(55, 66, 11, 26, 5)
        p.line([(66, 58), (76, 44), (77, 24)], 14, true)
        p.ellipse(81, 20, 13, 9)
        p.circle(85, 17, 2.4, false)
        p.line([(82, 24), (87, 26), (91, 22)], 1.6)
        p.line([(34, 66), (34, 74)], 1.8); p.line([(62, 66), (62, 74)], 1.8)
    }
}
