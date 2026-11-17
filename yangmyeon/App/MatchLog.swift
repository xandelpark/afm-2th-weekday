import Foundation
import MatchCore

/// 포인트마다 영상 타임코드를 남긴다.
///
/// 이게 점수와 영상을 잇는 지점이다. 나중에 "3세트 5-4 에서 그 랠리" 를 찾으려면
/// 영상을 훑는 게 아니라 이 기록에서 초를 읽어 바로 점프하면 된다.
struct MatchLog: Codable, Sendable {

    struct Entry: Codable, Sendable, Identifiable {
        var id = UUID()
        /// 녹화 시작 이후 초. 영상에서 이 지점으로 바로 간다.
        /// 녹화 전에 센 점은 음수로 둔다 — 0 으로 적으면 영상 맨 앞을 가리키는 거짓말이 된다.
        var t: TimeInterval
        /// 득점한 쪽.
        var by: Side
        /// 그 점이 들어간 뒤의 점수 표시. "40-30", "6-6 타이 3-5" 처럼.
        var score: String
        /// 서브한 쪽.
        var server: Side
        /// 게임·세트가 여기서 끝났으면 표시.
        var note: String?

        var hasVideo: Bool { t >= 0 }
        var clock: String {
            guard hasVideo else { return "녹화전" }
            let s = Int(t.rounded())
            return String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
        }
    }

    var matchName: String
    var startedAt: Date
    var format: Format
    var entries: [Entry] = []
    /// 영상 파일 이름. 타임코드가 어느 파일 기준인지 남겨둔다.
    var videoFiles: [String] = ["코트.mov"]
    /// 중간에 끊긴 적이 있나. 있으면 영상과 타임코드가 어긋날 수 있다 —
    /// 기록에 남겨야 나중에 그 사실을 알 수 있다.
    var interrupted = false
    /// 녹화 시작 때의 폰 접힘 각도·거치 방식·(A, B 순) 짧은 축 화각. 다시 보기에서 겹침을 자를 기본값.
    var hingeDegrees: Int? = nil
    var mount: String? = nil
    var fovAcross: [Double]? = nil

    init(matchName: String, format: Format, startedAt: Date = Date()) {
        self.matchName = matchName
        self.format = format
        self.startedAt = startedAt
    }

    /// 한 점을 기록한다. `before` 는 점수가 들어가기 전 상태여야 한다.
    mutating func record(at t: TimeInterval, by side: Side,
                         before: Match, after: Match) {
        var note: String?
        if after.isOver {
            note = "경기 종료"
        } else if after.sets.count > before.sets.count {
            let s = after.sets.last!
            note = "세트 종료 \(s.games[0])-\(s.games[1])"
            // 다음 세트가 슈퍼 타이브레이크면 바로 시작된다.
            if after.inTiebreak { note! += " · 슈퍼 타이브레이크 시작" }
        } else if after.games != before.games {
            note = "게임 종료 \(after.games[0])-\(after.games[1])"
            // 6-6 이면 게임 종료와 타이브레이크 시작이 같은 점이다. 둘 다 적는다.
            if after.inTiebreak && !before.inTiebreak { note! += " · 타이브레이크 시작" }
        }
        entries.append(Entry(t: t, by: side,
                             score: Self.describe(after),
                             server: before.currentServer,
                             note: note))
    }

    mutating func removeLast() { if !entries.isEmpty { entries.removeLast() } }

    /// 점수를 한 줄로. 사람이 읽어서 영상의 그 지점을 알아볼 수 있을 만큼.
    static func describe(_ m: Match) -> String {
        var parts: [String] = []
        if !m.sets.isEmpty {
            parts.append(m.sets.map { "\($0.games[0])-\($0.games[1])" }.joined(separator: " "))
        }
        parts.append("\(m.games[0])-\(m.games[1])")
        if m.inTiebreak {
            parts.append("타이 \(m.label(.left).text)-\(m.label(.right).text)")
        } else if !m.isOver {
            parts.append("\(m.label(.left).text)-\(m.label(.right).text)")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: 내보내기

    /// 사람이 읽는 표. 메모·카톡으로 넘기기 좋게.
    var text: String {
        var out = "\(matchName)\n"
        out += Self.human.string(from: startedAt) + "\n"
        out += "영상: " + videoFiles.joined(separator: ", ") + "\n"
        out += "타임코드는 녹화 시작 기준이다.\n"
        if let h = hingeDegrees { out += "접은 각도: \(h)°" + (mount == "netTent" ? " · 네트 텐트" : mount == "sideV" ? " · 코트 옆 V자" : "") + "\n" }
        if interrupted {
            out += "※ 녹화 중 끊김이 있었다. 영상 길이와 타임코드가 어긋날 수 있으니 확인할 것.\n"
        }
        out += String(repeating: "─", count: 46) + "\n"
        for e in entries {
            let who = e.by.tag
            var line = "\(e.clock)  \(who) 득점  \(e.score)"
            if let n = e.note { line += "   ← \(n)" }
            out += line + "\n"
        }
        return out
    }

    /// 편집 프로그램에 바로 넣는 챕터 마커(초, 제목).
    var csv: String {
        var out = "초,타임코드,득점,점수,서브,비고\n"
        for e in entries {
            let who = e.by.tag
            let sv = e.server.tag
            // 영상이 없는 점은 초 칸을 비운다. 0 이면 편집기가 맨 앞으로 점프해버린다.
            let sec = e.hasVideo ? String(Int(e.t)) : ""
            out += "\(sec),\(e.clock),\(who),\"\(e.score)\",\(sv),\"\(e.note ?? "")\"\n"
        }
        return out
    }

    func save(to folder: URL) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        try? enc.encode(self).write(to: folder.appendingPathComponent("포인트기록.json"))
        try? text.data(using: .utf8)?.write(to: folder.appendingPathComponent("포인트기록.txt"))
        try? csv.data(using: .utf8)?.write(to: folder.appendingPathComponent("포인트기록.csv"))
    }

    private static let human: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.locale = Locale(identifier: "ko_KR")
        return f
    }()
}
