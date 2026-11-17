import Foundation

/// 어느 쪽 코트인가. 화면에서 보이는 좌/우다.
///
/// 카메라를 코트 옆(네트 연장선)에 두면 네트가 프레임 가운데에 수직으로 서고
/// 두 코트가 좌우로 나뉜다. 깊이축은 코트 '폭' 이라 점수 구분과 상관이 없다.
public enum Side: Int, Codable, Sendable, CaseIterable {
    case left = 0, right = 1
    public var other: Side { self == .left ? .right : .left }
    /// 점수판·기록에 쓰는 이름.
    public var tag: String { self == .left ? "A" : "B" }
}

/// 경기 형식. 동호인 경기가 기본값이다 — 6게임 한 세트, 노애드 없음.
public struct Format: Codable, Sendable, Equatable {
    /// 한 세트를 가져가는 게임 수. 보통 6, 짧게 할 땐 4.
    public var gamesPerSet: Int
    /// 세트 수. 1 이면 단세트, 3 이면 3세트 중 2선승.
    public var setsToWin: Int
    /// 40-40 에서 2점 차 없이 다음 1점으로 끝낸다(노애드).
    public var noAd: Bool
    /// 게임이 동수가 되면 타이브레이크를 한다. 끄면 2게임 차까지 계속한다.
    public var tiebreak: Bool
    /// 타이브레이크 목표 점수. 보통 7.
    public var tiebreakTo: Int
    /// 마지막 세트를 10점 슈퍼 타이브레이크로 대체한다.
    public var superTiebreakFinalSet: Bool
    public var superTiebreakTo: Int

    public init(gamesPerSet: Int = 6, setsToWin: Int = 1, noAd: Bool = false,
                tiebreak: Bool = true, tiebreakTo: Int = 7,
                superTiebreakFinalSet: Bool = false, superTiebreakTo: Int = 10) {
        self.gamesPerSet = max(1, gamesPerSet)
        self.setsToWin = max(1, setsToWin)
        self.noAd = noAd
        self.tiebreak = tiebreak
        self.tiebreakTo = max(2, tiebreakTo)
        self.superTiebreakFinalSet = superTiebreakFinalSet
        self.superTiebreakTo = max(2, superTiebreakTo)
    }

    /// 3세트 경기에서 몇 세트를 치면 끝인가 — 2선승이면 setsToWin = 2.
    public var totalSets: Int { setsToWin * 2 - 1 }

    public static let 단세트6게임 = Format(gamesPerSet: 6, setsToWin: 1)
    public static let 단세트4게임노애드 = Format(gamesPerSet: 4, setsToWin: 1, noAd: true)
    public static let 삼세트 = Format(gamesPerSet: 6, setsToWin: 2)
    public static let 삼세트슈퍼타이 = Format(gamesPerSet: 6, setsToWin: 2,
                                        superTiebreakFinalSet: true)
}

/// 한 게임 안의 점수 표시. 타이브레이크는 숫자를 그대로 쓴다.
public enum PointLabel: Equatable, Sendable {
    case love, fifteen, thirty, forty, advantage, number(Int)

    public var text: String {
        switch self {
        case .love:      return "0"
        case .fifteen:   return "15"
        case .thirty:    return "30"
        case .forty:     return "40"
        case .advantage: return "Ad"
        case .number(let n): return String(n)
        }
    }
}

/// 끝난 세트 한 줄.
public struct SetScore: Codable, Sendable, Equatable {
    public var games: [Int]          // [near, far]
    public var tiebreak: [Int]?      // 타이브레이크로 끝났으면 그 점수
    public init(games: [Int], tiebreak: [Int]? = nil) {
        self.games = games; self.tiebreak = tiebreak
    }
    public func text(for s: Side) -> String { String(games[s.rawValue]) }
}
