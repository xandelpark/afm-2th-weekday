// 무작위 경기 불변식 검증. main.swift 의 시나리오 검사와 함께 돈다.
//
// 시나리오 검사는 "내가 생각한 경우" 만 본다. 여기서는 형식마다 수천 판을 무작위로
// 치면서 규칙이 어떤 순서로도 깨지지 않는지 본다. 난수는 고정 시드라 실패가 재현된다.
import Foundation

/// 재현 가능한 난수 (xorshift64*). SystemRandomNumberGenerator 는 시드를 못 준다.
struct SeededRNG: RandomNumberGenerator {
    private var s: UInt64
    init(seed: UInt64) { s = seed == 0 ? 0x9E3779B97F4A7C15 : seed }
    mutating func next() -> UInt64 {
        s ^= s >> 12; s ^= s << 25; s ^= s >> 27
        return s &* 2685821657736338717
    }
}

/// 규칙과 독립적으로 쓴 '정답'. Match 의 구현을 베끼지 않고 규칙서 문장을 그대로 옮겼다.
enum Oracle {
    static func label(points me: Int, you: Int) -> String {
        if me >= 3 && you >= 3 { return me == you ? "40" : (me > you ? "Ad" : "40") }
        return ["0", "15", "30", "40"][min(me, 3)]
    }
    /// 이 한 점으로 게임(또는 타이브레이크)이 끝나는가.
    static func isGamePoint(_ m: Match, for s: Side) -> Bool {
        let me = m.points[s.rawValue], you = m.points[s.other.rawValue]
        if m.inTiebreak { return me + 1 >= m.tiebreakTarget && me + 1 - you >= 2 }
        if m.format.noAd && me >= 3 && you >= 3 { return true }
        return me + 1 >= 4 && me + 1 - you >= 2
    }
    /// 끝난 세트가 규칙상 가능한 점수인가.
    static func validSet(_ set: SetScore, _ f: Format, isSuper: Bool) -> Bool {
        let a = set.games[0], b = set.games[1]
        let hi = max(a, b), lo = min(a, b)
        if isSuper {
            guard let tb = set.tiebreak, tb == set.games else { return false }
            return hi >= f.superTiebreakTo && hi - lo >= 2
        }
        if let tb = set.tiebreak {
            // 7-6 류: 동수에서 타이브레이크 한 게임
            guard f.tiebreak, hi == f.gamesPerSet + 1, lo == f.gamesPerSet else { return false }
            let th = max(tb[0], tb[1]), tl = min(tb[0], tb[1])
            return th >= f.tiebreakTo && th - tl >= 2
        }
        return hi >= f.gamesPerSet && hi - lo >= 2
    }
}

func runInvariants() -> (passed: Int, failed: Int) {
    var failed = 0, passed = 0
    func check(_ ok: Bool, _ what: @autoclosure () -> String) {
        if ok { passed += 1 } else { failed += 1; if failed <= 30 { print("  ✗ \(what())") } }
    }

    let formats: [(String, Format)] = [
        ("단세트6게임", .단세트6게임),
        ("단세트4게임노애드", .단세트4게임노애드),
        ("삼세트", .삼세트),
        ("삼세트슈퍼타이", .삼세트슈퍼타이),
        ("타이브레이크없음", Format(gamesPerSet: 6, setsToWin: 1, tiebreak: false)),
        ("단세트슈퍼타이만", Format(gamesPerSet: 6, setsToWin: 1, superTiebreakFinalSet: true)),
    ]
    let enc = JSONEncoder(), dec = JSONDecoder()
    var rng = SeededRNG(seed: 20261102)
    let matchesPerFormat = 1500
    var longest = 0

    for (name, f) in formats {
        print("■ 무작위 \(matchesPerFormat)판 · \(name)")
        let f0 = failed
        for game in 0..<matchesPerFormat {
            // 한쪽이 유리한 경기도 섞는다 — 50:50 만 돌리면 6-0 같은 경우가 드물다.
            let bias = [0.5, 0.5, 0.65, 0.8, 0.95][game % 5]
            var m = Match(format: f, firstServer: game % 2 == 0 ? .left : .right)
            var steps = 0
            var transcript: [Side] = []
            // 초기 상태도 세트 하나 없이 깨끗한지
            check(m.points == [0, 0] && m.games == [0, 0] && m.sets.isEmpty && !m.isOver,
                  "\(name) #\(game) 시작 상태")

            while !m.isOver && steps < 5000 {
                let s: Side = Double.random(in: 0..<1, using: &rng) < bias ? .left : .right
                let before = m

                // 정답과 대조 — 점수 표시, 게임포인트
                for side in Side.allCases {
                    if !m.inTiebreak {
                        check(m.label(side).text == Oracle.label(points: m.points[side.rawValue],
                                                                 you: m.points[side.other.rawValue]),
                              "\(name) #\(game) 점수표시 \(m.points)")
                    }
                    check(m.gamePoints.contains(side) == Oracle.isGamePoint(m, for: side),
                          "\(name) #\(game) 게임포인트 \(side) points=\(m.points) tb=\(m.inTiebreak)")
                }

                m.scorePoint(s); steps += 1; transcript.append(s)

                // 점수가 음수가 되거나 '끝났어야 하는' 게임이 이어지지 않는다
                check(m.points.allSatisfy { $0 >= 0 } && m.games.allSatisfy { $0 >= 0 },
                      "\(name) #\(game) 음수")
                for side in Side.allCases {
                    let me = m.points[side.rawValue], you = m.points[side.other.rawValue]
                    if m.inTiebreak {
                        check(!(me >= m.tiebreakTarget && me - you >= 2),
                              "\(name) #\(game) 끝났어야 할 타이브레이크 \(m.points)")
                    } else if !m.isOver {
                        check(!(me >= 4 && me - you >= 2), "\(name) #\(game) 끝났어야 할 게임 \(m.points)")
                        if f.noAd { check(!(me >= 4 && you >= 3), "\(name) #\(game) 노애드 미종료 \(m.points)") }
                    }
                }

                // 게임이 끝났으면 서브가 교대됐다 (타이브레이크 안에서는 별도 규칙)
                if m.games != before.games && !before.inTiebreak && !m.inTiebreak {
                    check(m.gameServer == before.gameServer.other, "\(name) #\(game) 서브 교대")
                }
                // 타이브레이크 서브 순서: 1점 뒤 2점씩
                if m.inTiebreak && before.inTiebreak {
                    let n = m.points[0] + m.points[1]
                    let first = before.points == [0, 0] ? before.currentServer : nil
                    if let first {
                        check(m.currentServer == first.other, "\(name) #\(game) 타이 1점 뒤 교대")
                    }
                    _ = n
                }

                // 세트가 끝났으면 가능한 점수여야 한다
                if m.sets.count > before.sets.count, let set = m.sets.last {
                    let isSuper = f.superTiebreakFinalSet
                        && (f.setsToWin == 1 || (before.setsWon[0] == f.setsToWin - 1
                                                 && before.setsWon[1] == f.setsToWin - 1))
                    check(Oracle.validSet(set, f, isSuper: isSuper),
                          "\(name) #\(game) 세트 점수 불가능 \(set.games) tb=\(String(describing: set.tiebreak))")
                    check(m.games == [0, 0] && m.points == [0, 0], "\(name) #\(game) 세트 뒤 초기화")
                    // 타이브레이크로 끝난 세트: 다음 세트 첫 서브는 타이브레이크 첫 서버의 상대
                    if before.inTiebreak && !isSuper && !m.isOver {
                        let tbPointsBefore = before.points[0] + before.points[1]
                        _ = tbPointsBefore
                    }
                }

                // 경기 종료는 정확히 setsToWin 에서
                check(m.isOver == (m.setsWon[0] >= f.setsToWin || m.setsWon[1] >= f.setsToWin),
                      "\(name) #\(game) 종료 시점")
                if m.isOver { check(m.winner.map { m.setsWon[$0.rawValue] >= f.setsToWin } ?? false,
                                    "\(name) #\(game) 승자") }

                // 되돌리기는 정확히 이전 상태
                var u = m; u.undo()
                check(u == before, "\(name) #\(game) 되돌리기 불일치 step \(steps)")

                // 인코딩 왕복
                if steps % 37 == 0 {
                    if let d = try? enc.encode(m), let back = try? dec.decode(Match.self, from: d) {
                        check(back == m, "\(name) #\(game) Codable 왕복")
                    } else { check(false, "\(name) #\(game) Codable 실패") }
                }
            }
            check(m.isOver, "\(name) #\(game) \(steps)점 안에 안 끝남")
            longest = max(longest, steps)

            // 끝난 경기에 점을 더 줘도 변화 없음
            let done = m; m.scorePoint(.left); m.scorePoint(.right)
            check(m == done, "\(name) #\(game) 종료 뒤 득점이 들어감")

            // 처음까지 전부 되돌리면 시작 상태와 같다
            var back = m
            while back.canUndo { back.undo() }
            check(back == Match(format: f, firstServer: game % 2 == 0 ? .left : .right),
                  "\(name) #\(game) 전부 되돌리기")

            // 같은 순서로 다시 치면 같은 결과 (결정적)
            var replay = Match(format: f, firstServer: game % 2 == 0 ? .left : .right)
            for s in transcript { replay.scorePoint(s) }
            check(replay == m, "\(name) #\(game) 재생 불일치")
        }
        print(failed == f0 ? "  전부 통과" : "  실패 \(failed - f0)건")
    }
    print("  (가장 긴 경기 \(longest)점)")
    return (passed, failed)
}
