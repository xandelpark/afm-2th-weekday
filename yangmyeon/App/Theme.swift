import SwiftUI

/// 앱 전체의 색·모양. 코트 위에 얹는 화면이라 어둡고, 강조는 테니스공 색 하나다.
enum Theme {
    static let ball   = Color(red: 0.85, green: 0.95, blue: 0.25)   // A · 강조
    static let sky    = Color(red: 0.35, green: 0.78, blue: 0.98)   // B
    static let bg     = Color(red: 0.055, green: 0.06, blue: 0.07)
    static let card   = Color(red: 0.11, green: 0.115, blue: 0.13)
    static let card2  = Color(red: 0.16, green: 0.165, blue: 0.185)
    static let text   = Color.white
    static let dim    = Color.white.opacity(0.55)
    static let line   = Color.white.opacity(0.08)

    static func side(_ s: Int) -> Color { s == 0 ? ball : sky }
}

/// 카드 한 장. 목록·홈 타일에 똑같이 쓴다.
struct Card: ViewModifier {
    var padding: CGFloat = 16
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.line))
    }
}
extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(Card(padding: padding)) }
}

/// 큰 주 버튼 — 노랑 바탕에 검정 글씨.
struct PrimaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(.black)
            .padding(.horizontal, 22).padding(.vertical, 14)
            .background(Theme.ball.opacity(configuration.isPressed ? 0.75 : 1), in: Capsule())
    }
}

/// 보조 버튼 — 어두운 캡슐.
struct SecondaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .lineLimit(1).fixedSize()
            .padding(.horizontal, 18).padding(.vertical, 12)
            .background(Theme.card2.opacity(configuration.isPressed ? 0.6 : 1), in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.line))
    }
}

/// 섹션 제목.
struct SectionTitle: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Theme.dim)
            .textCase(.uppercase)
            .tracking(1.2)
    }
}

/// 시간 표시 공통.
enum Fmt {
    static func clock(_ t: TimeInterval) -> String {
        let s = Int(t.rounded())
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
                         : String(format: "%d:%02d", s / 60, s % 60)
    }
    static let date: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "M월 d일 (E) HH:mm"; return f
    }()
    static func gb(_ bytes: Int64) -> String {
        bytes >= 1_073_741_824 ? String(format: "%.1f GB", Double(bytes) / 1_073_741_824)
                               : String(format: "%.0f MB", Double(bytes) / 1_048_576)
    }
}
