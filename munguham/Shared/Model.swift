import Foundation

/// 문구 하나. 줄바꿈까지 그대로 저장한다.
struct Phrase: Codable, Identifiable, Hashable, Sendable {
    var id = UUID()
    var title: String
    var body: String
    /// 내가 정한 단축어 (예: "ㄱㄱ"). 비어 있으면 제목 초성을 쓴다.
    var shortcut: String = ""
    var folder: UUID?
    var favorite = false
    var uses = 0
    var lastUsed: Date?
    var created = Date()
    var modified = Date()

    /// 실제로 쓰는 단축어
    var key: String { shortcut.isEmpty ? Hangul.initials(title) : shortcut.filter { !$0.isWhitespace } }
    var displayTitle: String {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { return t }
        return body.split(separator: "\n").first.map(String.init) ?? "제목 없음"
    }
}

struct Folder: Codable, Identifiable, Hashable, Sendable {
    var id = UUID()
    var name: String
}

enum SortOrder: String, Codable, CaseIterable, Identifiable, Sendable {
    case manual, uses, recent, name
    var id: String { rawValue }
    var label: String {
        switch self {
        case .manual: "내가 정한 순서"
        case .uses: "많이 쓴 순"
        case .recent: "최근 쓴 순"
        case .name: "이름순"
        }
    }
}

/// 문구함 전체. 파일 하나(JSON)로 저장한다.
struct Box: Codable, Sendable {
    var version = 1
    var folders: [Folder] = []
    var phrases: [Phrase] = []
    var sort: SortOrder = .manual

    func folderName(_ id: UUID?) -> String? { folders.first { $0.id == id }?.name }

    /// 처음 열었을 때 보여 줄 예시. 줄바꿈이 그대로 들어가는 걸 보여 준다.
    static var sample: Box {
        let f = Folder(name: "상담")
        return Box(folders: [f], phrases: [
            Phrase(title: "첫 인사", body: "안녕하세요 :)\n문의 주셔서 감사합니다.\n\n예식 날짜와 장소를 알려 주시면\n가능 여부부터 바로 확인해 드릴게요!", folder: f.id),
            Phrase(title: "계좌 안내", body: "예약금 입금 계좌 안내드립니다.\n\n[은행] 000-0000-0000\n[예금주] 홍길동\n\n입금 후 성함 남겨 주시면 확인해 드릴게요.", shortcut: "ㄱㅈ", folder: f.id, favorite: true),
            Phrase(title: "예약 확정", body: "예약이 확정되었습니다 🎉\n\n· 예식일 : \n· 장소 : \n\n촬영 2주 전에 다시 연락드릴게요.\n감사합니다!", folder: f.id),
        ])
    }
}

/// 찾기와 정렬. 앱과 키보드가 같이 쓴다.
enum Finder {
    /// 점수가 높을수록 위. nil 이면 안 맞음.
    static func score(_ p: Phrase, _ query: String) -> Int? {
        let q = query.filter { !$0.isWhitespace }
        if q.isEmpty { return 0 }
        let key = Hangul.initials(p.key), qk = Hangul.initials(q)
        let allConsonant = q.allSatisfy(Hangul.isConsonant)
        if allConsonant {
            if key == qk { return 100 }
            if key.hasPrefix(qk) { return 90 }
            let tk = Hangul.initials(p.title)
            if tk.hasPrefix(qk) { return 80 }
            if tk.contains(qk) { return 60 }
            if key.contains(qk) { return 55 }
            if q.count >= 3, Hangul.initials(p.body).contains(qk) { return 10 }
            return nil
        }
        if let i = Hangul.find(q, in: p.title) { return i == 0 ? 75 : 65 }
        if p.shortcut.localizedCaseInsensitiveContains(q) { return 50 }
        if Hangul.find(q, in: p.body) != nil { return 30 }
        return nil
    }

    static func sorted(_ list: [Phrase], by order: SortOrder) -> [Phrase] {
        switch order {
        case .manual: return list
        case .uses: return list.enumerated().sorted { ($0.element.uses, -$0.offset) > ($1.element.uses, -$1.offset) }.map(\.element)
        case .recent: return list.sorted { ($0.lastUsed ?? .distantPast) > ($1.lastUsed ?? .distantPast) }
        case .name: return list.sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
        }
    }

    /// 검색어가 있으면 맞는 정도 순, 없으면 정한 순서.
    static func filter(_ box: Box, query: String, folder: FolderFilter) -> [Phrase] {
        let inFolder = box.phrases.filter { p in
            switch folder {
            case .all: true
            case .favorites: p.favorite
            case .folder(let id): p.folder == id
            }
        }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return sorted(inFolder, by: box.sort) }
        let base = sorted(inFolder, by: box.sort == .manual ? .uses : box.sort)
        return base.enumerated()
            .compactMap { i, p in score(p, q).map { (p, $0, i) } }
            .sorted { ($0.1, -$0.2) > ($1.1, -$1.2) }
            .map(\.0)
    }
}

enum FolderFilter: Hashable, Sendable {
    case all, favorites, folder(UUID)
}

/// 문구 파일. 앱과 키보드가 함께 보는 App Group 폴더에 둔다.
/// 덮어쓰기 전에 하루 한 벌씩 옛 파일을 남긴다(최근 14일) — 실수로 지워도 되살릴 수 있게.
enum Store {
    static let group = "group.app.munguham"
    static let fileName = "문구함.json"

    static var shared: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) }
    static var dir: URL {
        shared ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    static var file: URL { dir.appendingPathComponent(fileName) }
    static var backups: URL {
        let d = dir.appendingPathComponent("백업", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }()
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    enum LoadResult { case ok(Box), missing, unreadable }

    static func load() -> LoadResult {
        guard FileManager.default.fileExists(atPath: file.path) else { return .missing }
        guard let d = try? Data(contentsOf: file), let b = try? decoder.decode(Box.self, from: d) else { return .unreadable }
        return .ok(b)
    }

    @discardableResult
    static func save(_ b: Box) -> Bool {
        guard let d = try? encoder.encode(b) else { return false }
        dailyBackup()
        do { try d.write(to: file, options: .atomic); return true } catch { return false }
    }

    private static func day(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// 오늘 첫 저장이면 지금 파일을 백업/날짜.json 으로 남긴다.
    private static func dailyBackup() {
        let fm = FileManager.default
        guard fm.fileExists(atPath: file.path) else { return }
        let target = backups.appendingPathComponent("\(day(Date())).json")
        if fm.fileExists(atPath: target.path) { return }
        try? fm.copyItem(at: file, to: target)
        let old = backupList().dropFirst(14)
        for u in old { try? fm.removeItem(at: u.url) }
    }

    struct Backup: Identifiable, Hashable { let url: URL; let day: String; let count: Int; var id: URL { url } }

    /// 최근 것부터
    static func backupList() -> [Backup] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: backups, includingPropertiesForKeys: nil)) ?? []
        return urls.filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
            .map { u in
                let n = (try? Data(contentsOf: u)).flatMap { try? decoder.decode(Box.self, from: $0) }?.phrases.count ?? 0
                return Backup(url: u, day: u.deletingPathExtension().lastPathComponent, count: n)
            }
    }

    static func read(_ url: URL) -> Box? {
        guard let d = try? Data(contentsOf: url) else { return nil }
        return try? decoder.decode(Box.self, from: d)
    }
}

/// 키보드에서 쓴 기록. 키보드는 문구 파일을 직접 고치지 않고 이 작은 파일에만 적는다
/// (앱과 키보드가 같은 파일을 동시에 덮어써 문구가 날아가는 일이 없게). 앱이 열릴 때 합친다.
struct UseLog: Codable, Sendable {
    struct Entry: Codable, Sendable { var count: Int; var last: Date }
    var entries: [UUID: Entry] = [:]
}

extension Store {
    static var useFile: URL { dir.appendingPathComponent("키보드기록.json") }

    static func readUses() -> UseLog {
        guard let d = try? Data(contentsOf: useFile), let l = try? decoder.decode(UseLog.self, from: d) else { return UseLog() }
        return l
    }

    static func noteUse(_ id: UUID) {
        var l = readUses()
        var e = l.entries[id] ?? .init(count: 0, last: Date())
        e.count += 1
        e.last = Date()
        l.entries[id] = e
        if let d = try? encoder.encode(l) { try? d.write(to: useFile, options: .atomic) }
    }

    static func clearUses() { try? FileManager.default.removeItem(at: useFile) }

    /// 키보드 기록을 문구에 더한다 (파일은 그대로).
    static func applying(_ log: UseLog, to b: Box) -> Box {
        var b = b
        for i in b.phrases.indices {
            if let e = log.entries[b.phrases[i].id] {
                b.phrases[i].uses += e.count
                if (b.phrases[i].lastUsed ?? .distantPast) < e.last { b.phrases[i].lastUsed = e.last }
            }
        }
        return b
    }
}
