import SwiftUI

enum Theme {
    static let bg = Color(red: 1.0, green: 0.965, blue: 0.925)        // 크림색 책상
    static let bar = Color.white
    static let ink = Color(red: 0.23, green: 0.18, blue: 0.16)        // 글자·아이콘
    static let soft = Color(red: 0.95, green: 0.92, blue: 0.89)       // 동그란 버튼 바탕
    static let pick = Color(red: 1.0, green: 0.87, blue: 0.72)        // 고른 것 표시
    static let accent = Color(red: 1.0, green: 0.48, blue: 0.35)
    static let rainbow = AngularGradient(colors: Palette.rainbow.map(\.color) + [Palette.rainbow[0].color], center: .center)
}

/// 동그란 아이콘 버튼 (집, 되돌리기 …)
struct RoundButton: View {
    let symbol: String
    var enabled = true
    var size: CGFloat = 46
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundStyle(Theme.ink)
                .frame(width: size, height: size)
                .background(Circle().fill(Theme.soft))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.3)
    }
}

/// 지금 색 + 둘레 무지개 테 — 누르면 색 고르는 창.
struct ColorWell: View {
    let color: Color
    var rainbow = false
    var size: CGFloat = 46
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().strokeBorder(Theme.rainbow, lineWidth: 5)
                Circle().fill(rainbow ? AnyShapeStyle(Theme.rainbow) : AnyShapeStyle(color)).padding(8)
            }
            .frame(width: size, height: size)
        }
        .buttonStyle(.plain)
    }
}

/// 최근 쓴 색 동그라미
struct Swatch: View {
    let color: RGBA
    let selected: Bool
    var size: CGFloat = 30
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Circle().fill(color.color)
                .overlay(Circle().strokeBorder(.black.opacity(0.08), lineWidth: 1))
                .padding(selected ? 4 : 0)
                .overlay(Circle().strokeBorder(selected ? Theme.ink : .clear, lineWidth: 2.5))
                .frame(width: size, height: size)
        }
        .buttonStyle(.plain)
    }
}

/// 잉크 결이 있는 작은 도장 그림
struct StampMark: View {
    let name: String
    let color: RGBA
    let pt: CGFloat
    var body: some View {
        if let img = StampInk.preview(name, color: color, pt: pt) {
            Image(uiImage: img).frame(width: pt, height: pt)
        } else {
            Color.clear.frame(width: pt, height: pt)
        }
    }
}

// MARK: 도구 그림 — 메모앱처럼 도구가 서 있고, 고른 도구가 쑥 올라온다

struct Cone: Shape {
    func path(in r: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: r.midX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
            p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
            p.closeSubpath()
        }
    }
}

struct Trapezoid: Shape {
    var top: CGFloat = 0.55
    func path(in r: CGRect) -> Path {
        let inset = r.width * (1 - top) / 2
        return Path { p in
            p.move(to: CGPoint(x: r.minX + inset, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX - inset, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
            p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
            p.closeSubpath()
        }
    }
}

struct ToolIcon: View {
    let tool: Tool
    let color: Color
    var symbol = "star.fill"
    var rainbow = false

    var body: some View {
        switch tool {
        case .pencil: pencil
        case .crayon: crayon
        case .eraser: eraser
        case .stamp: stamp
        }
    }

    private var pencil: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                Cone().fill(Color(red: 0.96, green: 0.84, blue: 0.66)).frame(width: 26, height: 24)
                Cone().fill(color).frame(width: 9, height: 8.3)
            }
            Rectangle().fill(color).frame(width: 26, height: 60)
                .overlay(HStack(spacing: 0) {
                    Color.white.opacity(0.28).frame(width: 7)
                    Color.clear
                    Color.black.opacity(0.10).frame(width: 7)
                })
        }
    }

    private var crayon: some View {
        VStack(spacing: 0) {
            UnevenRoundedRectangle(topLeadingRadius: 9, topTrailingRadius: 9).fill(color).frame(width: 18, height: 12)
            Trapezoid(top: 0.6).fill(color).frame(width: 30, height: 8)
            Rectangle().fill(color).frame(width: 30, height: 64)
                .overlay(alignment: .top) {
                    VStack(spacing: 4) {
                        Rectangle().fill(.black.opacity(0.22)).frame(height: 3)
                        Rectangle().fill(.white.opacity(0.55)).frame(height: 12)
                        Rectangle().fill(.black.opacity(0.22)).frame(height: 3)
                    }
                    .padding(.top, 6)
                }
        }
    }

    private var eraser: some View {
        VStack(spacing: 0) {
            UnevenRoundedRectangle(topLeadingRadius: 8, topTrailingRadius: 8)
                .fill(Color(red: 0.98, green: 0.66, blue: 0.74)).frame(width: 32, height: 24)
            Rectangle().fill(Color(red: 0.55, green: 0.76, blue: 0.98)).frame(width: 32, height: 60)
                .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.6)).frame(height: 4).padding(.top, 8) }
        }
    }

    private var stamp: some View {
        VStack(spacing: 0) {
            Circle().fill(Color(red: 0.80, green: 0.55, blue: 0.36)).frame(width: 24, height: 24)
            Rectangle().fill(Color(red: 0.72, green: 0.48, blue: 0.30)).frame(width: 12, height: 6)
            RoundedRectangle(cornerRadius: 6).fill(Color(red: 0.86, green: 0.64, blue: 0.44)).frame(width: 40, height: 56)
                .overlay(alignment: .top) {
                    StampMark(name: symbol, color: rainbow ? Palette.rainbow[0] : RGBA(UIColor(color)), pt: 26)
                        .padding(.top, 5)
                }
        }
    }
}
