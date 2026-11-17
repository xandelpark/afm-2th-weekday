import SwiftUI
import UIKit

/// 앱에서 쓰는 문구함. 바뀔 때마다 바로 파일에 쓴다.
@MainActor
final class Library: ObservableObject {
    @Published private(set) var box = Box()
    /// 파일을 못 읽어 백업에서 되살렸을 때 알려 줄 말
    @Published var notice: String?

    init() { load() }

    func load() {
        switch Store.load() {
        case .ok(let b):
            box = b
        case .missing:
            box = .sample
            Store.save(box)
        case .unreadable:
            if let last = Store.backupList().first, let b = Store.read(last.url) {
                box = b
                notice = "문구 파일이 망가져서 \(last.day) 백업으로 되살렸어요"
            } else {
                notice = "문구 파일을 읽지 못했어요"
            }
        }
        mergeKeyboardUses()
    }

    /// 키보드에서 쓴 횟수를 합친다.
    func mergeKeyboardUses() {
        let log = Store.readUses()
        guard !log.entries.isEmpty else { return }
        box = Store.applying(log, to: box)
        if Store.save(box) { Store.clearUses() }
    }

    private func change(_ f: (inout Box) -> Void) {
        f(&box)
        Store.save(box)
    }

    // MARK: 문구

    func upsert(_ p: Phrase) {
        change { b in
            var p = p
            p.modified = Date()
            if let i = b.phrases.firstIndex(where: { $0.id == p.id }) { b.phrases[i] = p } else { b.phrases.insert(p, at: 0) }
        }
    }

    func delete(_ id: UUID) { change { $0.phrases.removeAll { $0.id == id } } }

    func duplicate(_ p: Phrase) {
        change { b in
            var c = p
            c.id = UUID(); c.title = p.title + " 사본"; c.shortcut = ""; c.uses = 0; c.lastUsed = nil
            c.created = Date(); c.modified = Date()
            let i = b.phrases.firstIndex { $0.id == p.id } ?? -1
            b.phrases.insert(c, at: i + 1)
        }
    }

    func toggleFavorite(_ id: UUID) {
        change { b in if let i = b.phrases.firstIndex(where: { $0.id == id }) { b.phrases[i].favorite.toggle() } }
    }

    func move(_ id: UUID, to folder: UUID?) {
        change { b in if let i = b.phrases.firstIndex(where: { $0.id == id }) { b.phrases[i].folder = folder } }
    }

    func copy(_ p: Phrase) {
        UIPasteboard.general.string = p.body
        change { b in
            if let i = b.phrases.firstIndex(where: { $0.id == p.id }) { b.phrases[i].uses += 1; b.phrases[i].lastUsed = Date() }
        }
    }

    /// 보이는 문구들 사이에서 순서를 바꾼다 (폴더로 거른 상태여도 전체 순서에 맞게 끼워 넣는다).
    func reorder(visible: [Phrase], from: IndexSet, to: Int) {
        var v = visible
        v.move(fromOffsets: from, toOffset: to)
        change { b in
            let ids = Set(visible.map(\.id))
            let slots = b.phrases.indices.filter { ids.contains(b.phrases[$0].id) }
            let byID = Dictionary(uniqueKeysWithValues: b.phrases.map { ($0.id, $0) })
            for (slot, p) in zip(slots, v) { b.phrases[slot] = byID[p.id] ?? p }
        }
    }

    func setSort(_ s: SortOrder) { change { $0.sort = s } }

    func replaceAll(_ b: Box) { change { $0 = b } }

    // MARK: 폴더

    @discardableResult
    func addFolder(_ name: String) -> UUID? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return nil }
        let f = Folder(name: n)
        change { $0.folders.append(f) }
        return f.id
    }

    func renameFolder(_ id: UUID, _ name: String) {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        change { b in if let i = b.folders.firstIndex(where: { $0.id == id }) { b.folders[i].name = n } }
    }

    /// 폴더만 지우고 안의 문구는 '폴더 없음'으로 남긴다.
    func deleteFolder(_ id: UUID) {
        change { b in
            b.folders.removeAll { $0.id == id }
            for i in b.phrases.indices where b.phrases[i].folder == id { b.phrases[i].folder = nil }
        }
    }

    func moveFolders(from: IndexSet, to: Int) { change { $0.folders.move(fromOffsets: from, toOffset: to) } }

    // MARK: 백업

    /// 내보낼 파일 (공유 시트로 카톡·메일·파일 앱에 보낸다)
    func exportFile() -> URL? {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd"
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("문구함_\(f.string(from: Date())).json")
        guard let d = try? Store.encoder.encode(box), (try? d.write(to: u, options: .atomic)) != nil else { return nil }
        return u
    }

    /// 다른 파일의 문구를 더한다 (같은 문구는 건너뛴다). 더한 수를 돌려준다.
    func merge(_ other: Box) -> Int {
        var added = 0
        change { b in
            var folderMap: [UUID: UUID] = [:]
            for f in other.folders {
                if let same = b.folders.first(where: { $0.id == f.id || $0.name == f.name }) { folderMap[f.id] = same.id } else { b.folders.append(f); folderMap[f.id] = f.id }
            }
            for var p in other.phrases where !b.phrases.contains(where: { $0.id == p.id || ($0.title == p.title && $0.body == p.body) }) {
                p.folder = p.folder.flatMap { folderMap[$0] }
                b.phrases.append(p)
                added += 1
            }
        }
        return added
    }

    /// 그날 백업으로 통째로 되돌린다 (되돌리기 전 지금 상태는 오늘 백업에 남는다).
    func restore(_ backup: Store.Backup) -> Bool {
        guard let b = Store.read(backup.url) else { return false }
        change { $0 = b }
        return true
    }
}
