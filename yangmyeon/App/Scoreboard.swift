import SwiftUI
import MatchCore

/// 중계용 점수판. 영상 위에 올리는 것이므로 배경에 기대지 않고 자기 바탕을 깐다.
struct Scoreboard: View {
    let match: Match
    let nameA: String
    let nameB: String
    /// 크게 쓸 것인가(중계 모드).
    var large = false

    private var rows: [(Side, String)] { [(.left, nameA), (.right, nameB)] }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(rows, id: \.0) { side, name in
                row(side, name)
                if side == .left { Divider().background(.white.opacity(0.18)) }
            }
        }
        .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: large ? 14 : 10))
        .overlay(RoundedRectangle(cornerRadius: large ? 14 : 10)
            .strokeBorder(.white.opacity(0.14)))
        .foregroundStyle(.white)
    }

    private func row(_ side: Side, _ name: String) -> some View {
        HStack(spacing: large ? 14 : 10) {
            // 서브 표시 — 중계에서 제일 먼저 찾는 정보다.
            Circle()
                .fill(match.currentServer == side && !match.isOver
                      ? Color(red: 0.85, green: 0.95, blue: 0.25) : .clear)
                .frame(width: large ? 10 : 7, height: large ? 10 : 7)

            Text(name)
                .font(.system(size: large ? 22 : 15, weight: .semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            // 끝난 세트들
            if !match.sets.isEmpty {
                Text(match.setsText(for: side))
                    .font(.system(size: large ? 22 : 15, weight: .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.62))
            }
            // 현재 세트 게임 수
            Text("\(match.games[side.rawValue])")
                .font(.system(size: large ? 26 : 18, weight: .bold, design: .rounded))
                .monospacedDigit()
                .frame(width: large ? 34 : 24)
            // 현재 게임 점수
            Text(match.isOver ? "—" : match.label(side).text)
                .font(.system(size: large ? 30 : 20, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .frame(width: large ? 58 : 40)
                .foregroundStyle(match.gamePoints.contains(side)
                                 ? Color(red: 0.85, green: 0.95, blue: 0.25) : .white)
        }
        .padding(.horizontal, large ? 18 : 12)
        .padding(.vertical, large ? 12 : 8)
    }
}
