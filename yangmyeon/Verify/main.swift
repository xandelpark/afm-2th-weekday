// 규칙 검증기. Testing·XCTest 는 전체 Xcode 에만 있어서 쓰지 않는다.
// swiftc 로 바로 빌드해 돌리고, 하나라도 틀리면 1 로 끝낸다.
import Foundation

func play(_ m: inout Match, _ seq: String) {
    for c in seq where c == "N" || c == "F" { m.scorePoint(c == "N" ? .left : .right) }
}
func win(_ m: inout Match, _ s: Side, games: Int) {
    for _ in 0..<games { play(&m, s == .left ? "NNNN" : "FFFF") }
}
/// 양쪽이 한 게임씩 번갈아 가져간다. n-n 동수를 만들 때 쓴다.
func trade(_ m: inout Match, _ pairs: Int, first: Side = .left) {
    for _ in 0..<pairs {
        play(&m, first == .left ? "NNNN" : "FFFF")
        play(&m, first == .left ? "FFFF" : "NNNN")
    }
}

/// 전부 지역 상태로 돌린다. 전역 var 가 없으면 동시성 격리 문제가 생기지 않는다.
func runChecks() -> (passed: Int, failed: Int) {
    var failed = 0, passed = 0
    func check(_ ok: Bool, _ what: String) {
        if ok { passed += 1 } else { failed += 1; print("  ✗ \(what)") }
    }
    func group(_ name: String, _ body: () -> Void) {
        print("■ \(name)"); let f0 = failed; body()
        print(failed == f0 ? "  전부 통과" : "  실패 \(failed - f0)건")
    }

    group("게임 점수") {
        var m = Match()
        check(m.label(.left).text == "0", "시작은 0")
        m.scorePoint(.left); check(m.label(.left).text == "15", "1점 → 15")
        m.scorePoint(.left); check(m.label(.left).text == "30", "2점 → 30")
        m.scorePoint(.left); check(m.label(.left).text == "40", "3점 → 40")
        m.scorePoint(.left); check(m.games == [1, 0], "4점 → 게임")

        var d = Match()
        play(&d, "NNNFFF")
        check(d.isDeuce, "40-40 은 듀스")
        d.scorePoint(.left)
        check(d.label(.left).text == "Ad", "듀스 뒤 1점은 어드밴티지")
        check(d.games == [0, 0], "어드밴티지만으로는 게임이 끝나지 않는다")
        d.scorePoint(.right)
        check(d.isDeuce, "진 쪽이 따면 다시 듀스")
        play(&d, "NN")
        check(d.games == [1, 0], "듀스에서 2점 연속이면 게임")

        var na = Match(format: Format(gamesPerSet: 4, setsToWin: 1, noAd: true))
        play(&na, "NNNFFF")
        check(na.isDeuce, "노애드도 40-40 까지는 같다")
        na.scorePoint(.right)
        check(na.games == [0, 1], "노애드는 40-40 다음 1점으로 끝난다")

        var sv = Match(firstServer: .left)
        check(sv.currentServer == .left, "첫 서브")
        play(&sv, "NNNN"); check(sv.currentServer == .right, "게임 뒤 서브 교대")
        play(&sv, "FFFF"); check(sv.currentServer == .left, "다시 교대")
    }

    group("세트") {
        var a = Match(format: .단세트6게임)
        win(&a, .right, games: 4); win(&a, .left, games: 6)
        check(a.winner == .left, "6-4 로 세트 획득")
        check(a.sets.first?.games == [6, 4], "세트 스코어 6-4")

        var b = Match(format: .단세트6게임)
        trade(&b, 5)
        check(b.games == [5, 5], "5-5")
        win(&b, .left, games: 1)
        check(b.winner == nil, "6-5 로는 안 끝난다")
        win(&b, .left, games: 1)
        check(b.winner == .left && b.sets.first?.games == [7, 5], "7-5 로 끝난다")

        var c = Match(format: .단세트6게임)
        trade(&c, 6)
        check(c.games == [6, 6], "번갈아 6게임씩이면 6-6")
        check(c.inTiebreak, "6-6 이면 타이브레이크")
        check(c.tiebreakTarget == 7, "목표 7점")
        check(c.label(.left).text == "0", "타이브레이크는 숫자로 센다")
    }

    group("타이브레이크") {
        func toTB() -> Match {
            var m = Match(format: .단세트6게임, firstServer: .left)
            trade(&m, 6); return m
        }
        var a = toTB()
        play(&a, "NFNFNFNFNFNF")
        check(a.points == [6, 6], "6-6")
        play(&a, "N")
        check(a.winner == nil, "7-6 은 2점 차가 아니라 계속")
        play(&a, "N")
        check(a.winner == .left, "8-6 으로 끝")
        check(a.sets.first?.games == [7, 6], "세트는 7-6")
        check(a.sets.first?.tiebreak == [8, 6], "타이브레이크 점수 기록")

        var b = toTB()
        let first = b.currentServer
        check(b.currentServer == first, "0점: 첫 서버")
        b.scorePoint(.left); check(b.currentServer == first.other, "1점: 교대")
        b.scorePoint(.left); check(b.currentServer == first.other, "2점: 그대로")
        b.scorePoint(.left); check(b.currentServer == first, "3점: 교대")
        b.scorePoint(.left); check(b.currentServer == first, "4점: 그대로")
        b.scorePoint(.left); check(b.currentServer == first.other, "5점: 교대")

        var c = toTB()
        play(&c, "NFNFN")
        check(!c.changeEndsDue, "5점에서는 코트 안 바꾼다")
        c.scorePoint(.right)
        check(c.changeEndsDue, "6점마다 코트 교대")
    }

    group("3세트 경기") {
        var m = Match(format: .삼세트)
        win(&m, .left, games: 6)
        check(m.setsWon == [1, 0] && m.winner == nil, "1세트 획득, 경기는 계속")
        win(&m, .right, games: 6)
        check(m.setsWon == [1, 1] && m.winner == nil, "1-1")
        win(&m, .left, games: 6)
        check(m.winner == .left, "2세트 선취로 경기 종료")
        check(m.sets.count == 3, "세트 3개 기록")

        var s = Match(format: .삼세트슈퍼타이)
        win(&s, .left, games: 6)
        win(&s, .right, games: 6)
        check(s.setsWon == [1, 1], "1-1")
        check(s.inTiebreak, "1-1 이면 바로 슈퍼 타이브레이크")
        check(s.tiebreakTarget == 10, "목표 10점")
        for _ in 0..<10 { s.scorePoint(.left) }
        check(s.winner == .left, "10-0 으로 경기 종료")
        check(s.sets.last?.tiebreak == [10, 0], "슈퍼 타이브레이크 점수 기록")
    }

    group("되돌리기") {
        var m = Match(format: .단세트6게임)
        trade(&m, 5)
        let before = m
        play(&m, "NNNN")
        check(m.games == [6, 5], "게임 하나 진행")
        for _ in 0..<4 { m.undo() }
        check(m == before, "게임 경계를 넘어 정확히 복원")

        var e = Match(format: .단세트6게임)
        win(&e, .right, games: 4); win(&e, .left, games: 5)
        play(&e, "NNNN")
        check(e.winner == .left, "경기 종료")
        e.undo()
        check(e.winner == nil && e.games == [5, 4], "경기 종료도 되돌려진다")

        var z = Match()
        let z0 = z
        z.undo()
        check(z == z0 && !z.canUndo, "되돌릴 게 없으면 아무 일도 없다")
    }

    group("게임 포인트 표시") {
        var a = Match(); play(&a, "NNNFF")
        check(a.gamePoint == .left, "40-30 은 A 게임포인트")
        var b = Match(); play(&b, "NNFF")
        check(b.gamePoint == nil, "30-30 은 게임포인트 아님")
        var c = Match(); play(&c, "NNNFFFN")
        check(c.label(.left).text == "Ad" && c.gamePoint == .left, "어드밴티지는 게임포인트")
        var d = Match(format: .단세트6게임)
        win(&d, .left, games: 5); play(&d, "NNN")
        check(d.gamePoint == .left, "5-0 40-0 은 세트포인트이자 게임포인트")
        var e = Match(); play(&e, "NNNFFF")
        check(e.gamePoints.isEmpty, "듀스는 게임포인트 아님")
        var n = Match(format: .단세트4게임노애드); play(&n, "NNNFFF")
        check(n.gamePoints == [.left, .right], "노애드 40-40 은 양쪽 다 게임포인트")
    }

    group("코트 체인지 (ITF 10)") {
        var m = Match(format: .삼세트)
        check(!m.changeEndsDue, "시작엔 안 바꾼다")
        play(&m, "NNNN"); check(m.changeEndsDue, "1게임 뒤 바꾼다")
        play(&m, "N");    check(!m.changeEndsDue, "게임 중간엔 아니다")
        play(&m, "NNN");  check(!m.changeEndsDue, "2게임 뒤는 아니다")
        play(&m, "NNNN"); check(m.changeEndsDue, "3게임 뒤 바꾼다")
        win(&m, .left, games: 3)
        check(m.sets.last?.games == [6, 0] && !m.changeEndsDue, "6-0 (짝수) 세트 끝엔 안 바꾼다")
        play(&m, "FFFF"); check(m.changeEndsDue, "다음 세트 1게임 뒤에 바꾼다")

        var o = Match(format: .삼세트)
        win(&o, .right, games: 1); win(&o, .left, games: 6)
        check(o.sets.last?.games == [6, 1] && o.changeEndsDue, "6-1 (홀수) 세트 끝에 바로 바꾼다")

        var t = Match(format: .삼세트, firstServer: .left)
        trade(&t, 6)
        check(!t.changeEndsDue, "6-6 (12게임) 타이브레이크 시작엔 안 바꾼다")
        play(&t, "NNNNNNN")
        check(t.sets.last?.games == [7, 6] && t.changeEndsDue, "7-6 (13게임) 세트 끝에 바꾼다")

        var z = Match(format: .단세트6게임)
        win(&z, .left, games: 6)
        check(!z.changeEndsDue, "경기가 끝나면 안 바꾼다")
    }

    group("슈퍼 타이브레이크 표시") {
        var s = Match(format: .삼세트슈퍼타이, firstServer: .left)
        win(&s, .left, games: 6); win(&s, .right, games: 6)
        play(&s, "NFNFNFNFNFNFNFNF")        // 8-8
        play(&s, "NN")                      // 10-8
        check(s.winner == .left, "10-8 종료")
        check(s.sets.last?.games == [10, 8], "세트 자리에 10-8 이 들어간다")
        check(s.setsText(for: .left) == "6 0 10" && s.setsText(for: .right) == "0 6 8",
              "표시는 6 0 10 / 0 6 8 — 괄호 없이")
        var t = Match(format: .단세트6게임, firstServer: .left)
        trade(&t, 6); play(&t, "NNNNNNN")
        check(t.setsText(for: .left) == "7(0)" && t.setsText(for: .right) == "6", "일반 7-6 은 7(0) / 6")

        var u = Match(format: .삼세트, firstServer: .left)
        trade(&u, 6)
        let tbFirst = u.currentServer
        play(&u, "NNNNNNN")
        check(u.currentServer == tbFirst.other, "타이브레이크 뒤 다음 세트 첫 서브는 타이 첫 서버의 상대")
    }

    return (passed, failed)
}

let r = runChecks()
let i = runInvariants()
print("\n결과: 시나리오 통과 \(r.passed) · 실패 \(r.failed)  |  불변식 통과 \(i.passed) · 실패 \(i.failed)")
exit(r.failed + i.failed == 0 ? 0 : 1)
