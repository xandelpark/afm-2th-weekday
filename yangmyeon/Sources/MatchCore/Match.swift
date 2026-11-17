import Foundation

/// 테니스 한 경기의 상태와 규칙. 순수 값 타입이고 부작용이 없다.
/// 카메라·UI 를 모르기 때문에 터미널에서 그대로 테스트된다.
public struct Match: Codable, Sendable, Equatable {

    public private(set) var format: Format
    /// 현재 게임(또는 타이브레이크)의 득점 수. [near, far]
    public private(set) var points: [Int] = [0, 0]
    /// 현재 세트의 게임 수. [near, far]
    public private(set) var games: [Int] = [0, 0]
    /// 끝난 세트들.
    public private(set) var sets: [SetScore] = []
    /// 세트 획득 수. [near, far]
    public private(set) var setsWon: [Int] = [0, 0]
    /// 이 게임을 서브하는 쪽. 타이브레이크 중에는 `currentServer` 를 봐야 한다.
    public private(set) var gameServer: Side
    public private(set) var inTiebreak = false
    /// 타이브레이크 첫 점을 서브한 쪽.
    private var tiebreakFirstServer: Side = .left
    public private(set) var winner: Side? = nil
    /// 되돌리기용. 상태를 통째로 쌓는다 — 규칙이 늘어나도 되돌리기가 틀리지 않는다.
    private var history: [Snapshot] = []

    private struct Snapshot: Codable, Sendable, Equatable {
        var points: [Int], games: [Int], sets: [SetScore], setsWon: [Int]
        var gameServer: Side, inTiebreak: Bool, tiebreakFirstServer: Side, winner: Side?
    }

    public init(format: Format = .단세트6게임, firstServer: Side = .left) {
        self.format = format
        self.gameServer = firstServer
        // 마지막 세트를 슈퍼 타이브레이크로 하는 형식에서 단세트면 바로 타이브레이크다.
        if format.superTiebreakFinalSet && format.setsToWin == 1 {
            self.inTiebreak = true
            self.tiebreakFirstServer = firstServer
        }
    }

    // MARK: 읽기

    public var isOver: Bool { winner != nil }

    /// 지금 서브하는 쪽. 타이브레이크는 1점 뒤 2점씩 교대한다.
    public var currentServer: Side {
        guard inTiebreak else { return gameServer }
        let n = points[0] + points[1]
        if n == 0 { return tiebreakFirstServer }
        // n=0:A, 1:B, 2:B, 3:A, 4:A, 5:B, 6:B ...
        return ((n + 1) / 2) % 2 == 1 ? tiebreakFirstServer.other : tiebreakFirstServer
    }

    /// 지금 타이브레이크의 목표 점수.
    public var tiebreakTarget: Int {
        isFinalSetSuperTiebreak ? format.superTiebreakTo : format.tiebreakTo
    }

    /// 이 타이브레이크가 '마지막 세트 대체' 슈퍼 타이브레이크인가.
    private var isFinalSetSuperTiebreak: Bool {
        guard format.superTiebreakFinalSet else { return false }
        if format.setsToWin == 1 { return true }
        return setsWon[0] == format.setsToWin - 1 && setsWon[1] == format.setsToWin - 1
    }

    /// 점수판에 쓸 표시.
    public func label(_ s: Side) -> PointLabel {
        if inTiebreak { return .number(points[s.rawValue]) }
        let me = points[s.rawValue], you = points[s.other.rawValue]
        if me >= 3 && you >= 3 {
            if me == you { return .forty }            // 40-40
            return me > you ? .advantage : .forty     // Ad / 40
        }
        switch me {
        case 0: return .love
        case 1: return .fifteen
        case 2: return .thirty
        default: return .forty
        }
    }

    /// 듀스인가(노애드면 '마지막 한 점').
    public var isDeuce: Bool {
        !inTiebreak && points[0] >= 3 && points[1] >= 3 && points[0] == points[1]
    }

    /// 이 한 점을 따면 게임(또는 타이브레이크)을 가져가는 쪽들.
    /// 노애드 40-40 에서는 양쪽 모두가 게임포인트라 둘이 나온다.
    public var gamePoints: [Side] {
        guard !isOver else { return [] }
        return Side.allCases.filter { s in
            var t = self
            t.history = []
            t.scorePoint(s)
            return t.games != games || t.sets.count != sets.count || t.isOver
        }
    }

    /// 게임포인트인 쪽 하나. 양쪽 다면 A 를 돌려준다 — 표시용으로는 `gamePoints` 를 쓸 것.
    public var gamePoint: Side? { gamePoints.first }

    /// 코트를 바꿀 때인가.
    ///
    /// ITF 규칙 10: 각 세트의 1·3·5… 번째 게임 뒤에 바꾼다. 세트가 끝났을 때는
    /// 그 세트의 총 게임 수가 홀수면 바로 바꾸고, 짝수면 다음 세트 첫 게임 뒤에 바꾼다.
    /// 타이브레이크 중에는 6점마다.
    public var changeEndsDue: Bool {
        guard !isOver else { return false }
        if inTiebreak {
            let n = points[0] + points[1]
            return n > 0 && n % 6 == 0
        }
        guard points == [0, 0] else { return false }
        let played = games[0] + games[1]
        if played == 0 {
            // 세트가 막 끝난 자리. 끝난 세트의 게임 수가 홀수였으면 지금 바꾼다.
            guard let last = sets.last else { return false }
            return (last.games[0] + last.games[1]) % 2 == 1
        }
        return played % 2 == 1
    }

    /// 되돌릴 게 있나.
    public var canUndo: Bool { !history.isEmpty }

    // MARK: 쓰기

    /// 한 쪽이 1점을 얻는다. 게임·세트·경기 종료까지 이 안에서 처리한다.
    public mutating func scorePoint(_ s: Side) {
        guard !isOver else { return }
        history.append(Snapshot(points: points, games: games, sets: sets, setsWon: setsWon,
                                gameServer: gameServer, inTiebreak: inTiebreak,
                                tiebreakFirstServer: tiebreakFirstServer, winner: winner))
        points[s.rawValue] += 1

        if inTiebreak {
            if wonTiebreak(s) { finishTiebreak(s) }
            return
        }
        if wonGame(s) { finishGame(s) }
    }

    /// 마지막 1점을 되돌린다.
    public mutating func undo() {
        guard let h = history.popLast() else { return }
        points = h.points; games = h.games; sets = h.sets; setsWon = h.setsWon
        gameServer = h.gameServer; inTiebreak = h.inTiebreak
        tiebreakFirstServer = h.tiebreakFirstServer; winner = h.winner
    }

    // MARK: 규칙

    private func wonGame(_ s: Side) -> Bool {
        let me = points[s.rawValue], you = points[s.other.rawValue]
        // 노애드: 40-40 다음 1점으로 끝낸다.
        if format.noAd && me >= 4 && you >= 3 { return true }
        return me >= 4 && me - you >= 2
    }

    private func wonTiebreak(_ s: Side) -> Bool {
        let me = points[s.rawValue], you = points[s.other.rawValue]
        return me >= tiebreakTarget && me - you >= 2
    }

    private mutating func finishGame(_ s: Side) {
        games[s.rawValue] += 1
        points = [0, 0]
        gameServer = gameServer.other

        let me = games[s.rawValue], you = games[s.other.rawValue]
        // 동수가 되면 타이브레이크로 간다.
        if format.tiebreak, me == format.gamesPerSet, you == format.gamesPerSet {
            inTiebreak = true
            tiebreakFirstServer = gameServer
            return
        }
        if me >= format.gamesPerSet && me - you >= 2 { finishSet(s, tiebreak: nil) }
    }

    private mutating func finishTiebreak(_ s: Side) {
        let tb = points
        // 슈퍼 타이브레이크가 마지막 세트를 대체하는 경우엔 게임이 없다.
        // 세트 점수 자리에 타이브레이크 점수를 그대로 적는다 — "10-8" 로 읽히게.
        if isFinalSetSuperTiebreak {
            points = [0, 0]; inTiebreak = false
            finishSet(s, tiebreak: tb, gamesOverride: tb)
        } else {
            games[s.rawValue] += 1
            points = [0, 0]; inTiebreak = false
            gameServer = tiebreakFirstServer.other
            finishSet(s, tiebreak: tb)
        }
    }

    private mutating func finishSet(_ s: Side, tiebreak tb: [Int]?, gamesOverride: [Int]? = nil) {
        sets.append(SetScore(games: gamesOverride ?? games, tiebreak: tb))
        setsWon[s.rawValue] += 1
        games = [0, 0]

        if setsWon[s.rawValue] >= format.setsToWin { winner = s; return }
        // 다음 세트가 슈퍼 타이브레이크로 대체되는지 본다.
        if isFinalSetSuperTiebreak {
            inTiebreak = true
            tiebreakFirstServer = gameServer
        }
    }

    // MARK: 표시용 문자열

    /// "6-4 7-5" 처럼 끝난 세트들을 한 줄로.
    public func setsText(for s: Side) -> String {
        sets.map { set -> String in
            var t = String(set.games[s.rawValue])
            // 7-6 세트는 진 쪽 타이브레이크 점수를 괄호로 적는 관례를 따른다.
            // 슈퍼 타이브레이크 세트는 게임 자리에 이미 점수가 들어 있어 괄호를 달지 않는다.
            if let tb = set.tiebreak, tb != set.games {
                let loser = min(tb[0], tb[1])
                if set.games[s.rawValue] > set.games[s.other.rawValue] { t += "(\(loser))" }
            }
            return t
        }.joined(separator: " ")
    }
}
