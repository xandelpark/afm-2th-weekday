#if DEBUG
import SwiftUI

/// 시뮬레이터 화면 확인·자체 검사용. 실행 인자로 켠다 (Debug 빌드에만 있다).
@MainActor
enum Demo {
    static func has(_ a: String) -> Bool { ProcessInfo.processInfo.arguments.contains(a) }
    static func value(_ a: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: a), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
    static var report: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("검증.txt") }
    static func write(_ lines: [String]) { try? lines.joined(separator: "\n").write(to: report, atomically: true, encoding: .utf8) }

    /// 본식스냅 상담에서 쓸 법한 문구들 (화면 확인용)
    static var box: Box {
        let a = Folder(name: "상담"), b = Folder(name: "예약·입금"), c = Folder(name: "촬영 안내")
        let now = Date()
        return Box(folders: [a, b, c], phrases: [
            Phrase(title: "첫 인사", body: "안녕하세요 :)\n문의 주셔서 감사합니다.\n\n예식 날짜와 장소를 알려 주시면\n가능 여부부터 바로 확인해 드릴게요!", shortcut: "ㅇㄴ", folder: a.id, favorite: true, uses: 42, lastUsed: now),
            Phrase(title: "가격 안내", body: "상품 구성 안내드릴게요.\n\n· 기본 : 작가 1인 / 원본 전체\n· 추천 : 작가 2인 / 원본 + 보정 50장\n\n자세한 금액은 아래 링크에서 확인해 주세요.", folder: a.id, uses: 30),
            Phrase(title: "가능 날짜 확인", body: "확인해 보니 그날 촬영 가능합니다!\n\n예약금 입금 순으로 확정되니\n원하시면 계좌 안내드릴게요.", folder: a.id, uses: 18),
            Phrase(title: "계좌 안내", body: "예약금 입금 계좌 안내드립니다.\n\n[은행] 000-0000-0000\n[예금주] 홍길동\n\n입금 후 성함 남겨 주시면 확인해 드릴게요.", shortcut: "ㄱㅈ", folder: b.id, favorite: true, uses: 25),
            Phrase(title: "입금 확인", body: "입금 확인되었습니다 🎉\n예약이 확정되었어요.\n\n촬영 2주 전에 다시 연락드릴게요.\n감사합니다!", folder: b.id, uses: 21),
            Phrase(title: "잔금 안내", body: "예식 일주일 전까지 잔금 부탁드립니다.\n\n같은 계좌로 보내 주시면 되고\n카드 결제도 가능해요.", folder: b.id, uses: 7),
            Phrase(title: "촬영 전 체크", body: "예식 당일 체크리스트예요.\n\n1. 신부 대기실 입장 시간\n2. 가족 사진 명단\n3. 꼭 찍고 싶은 장면\n\n미리 알려 주시면 놓치지 않을게요!", folder: c.id, uses: 12),
            Phrase(title: "원본 전달", body: "원본 사진 전달드립니다 📷\n\n링크 : \n비밀번호 : \n\n2주 안에 받아 주세요!", folder: c.id, uses: 9),
        ])
    }

    static func home(lib: Library, edit: @escaping (Phrase) -> Void, settings: @escaping () -> Void,
                     query: @escaping (String) -> Void, folder: @escaping (FolderFilter) -> Void) -> () -> Void {
        {
            if has("-selftest") { selfTest() }
            if has("-demo") { lib.replaceAll(box) }
            if let q = value("-demo-search") { query(q) }
            if let f = value("-demo-folder"), let fo = lib.box.folders.first(where: { $0.name == f }) { folder(.folder(fo.id)) }
            if has("-demo-edit"), lib.box.phrases.count > 3 { edit(lib.box.phrases[3]) }
            if has("-demo-new") { edit(Phrase(title: "", body: "")) }
            if has("-demo-settings") { settings() }
        }
    }

    /// 초성 찾기·줄바꿈 자체 검사. 결과는 Documents/검증.txt
    static func selfTest() {
        var out: [String] = []
        var fails = 0
        func check(_ name: String, _ ok: Bool) { out.append("\(ok ? "OK " : "FAIL") \(name)"); if !ok { fails += 1 } }
        check("초성 가격 안내 = ㄱㄱㅇㄴ", Hangul.initials("가격 안내") == "ㄱㄱㅇㄴ")
        check("초성 쌍자음 까치 = ㄱㅊ", Hangul.initials("까치") == "ㄱㅊ")
        check("ㄱㅇ ⊂ 가격 안내", Hangul.find("ㄱㅇ", in: "가격 안내") == 1)
        check("치는 중 '가' 가 '각' 에 맞음", Hangul.find("가", in: "각") == 0)
        check("'가' 가 '감사' 앞에서 맞음", Hangul.find("감", in: "감사") == 0)
        check("ㄲ 검색이 '까' 에 맞음", Hangul.find("ㄲ", in: "까") == 0)
        check("영문 대소문자", Hangul.find("abc", in: "ABC 안내") == 0)
        let b = box
        let top = { (q: String) in Finder.filter(b, query: q, folder: .all).first?.title ?? "-" }
        check("ㄱㅈ → 계좌 안내 (단축어)", top("ㄱㅈ") == "계좌 안내")
        check("ㅇㄴ → 첫 인사 (단축어)", top("ㅇㄴ") == "첫 인사")
        check("ㄱㄱ → 가격 안내 (제목 초성)", top("ㄱㄱ") == "가격 안내")
        check("ㅇㄱㅎ → 입금 확인", top("ㅇㄱㅎ") == "입금 확인")
        check("잔금 → 잔금 안내", top("잔금") == "잔금 안내")
        check("비밀번호 (본문) → 원본 전달", top("비밀번호") == "원본 전달")
        check("없는 말 → 0개", Finder.filter(b, query: "ㅋㅋㅋㅋ", folder: .all).isEmpty)
        let all = Finder.filter(b, query: "", folder: .all)
        check("검색 없으면 정한 순서", all.map(\.title) == b.phrases.map(\.title))
        out.append("ㄱ 결과: " + Finder.filter(b, query: "ㄱ", folder: .all).map(\.title).joined(separator: ", "))
        out.append(fails == 0 ? "[검증] 모두 통과" : "[검증] 실패 \(fails)")
        write(out)
    }
}

/// 키보드를 앱 안에 띄워 보는 화면: 위 글상자에 실제로 들어간 글을 보여 준다.
@MainActor
final class FakeField: ObservableObject, KeyTarget {
    @Published var text = "고객님 메시지에 답장 중…\n"
    func insert(_ s: String) { text += s }
    func deleteBackward() { if !text.isEmpty { text.removeLast() } }
    func nextKeyboard() {}
    func click() {}
}

struct KeyboardDemoView: View {
    @StateObject private var field = FakeField()
    @StateObject private var panel = Panel()

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                Text(field.text)
                    .font(.system(size: 16))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 14).fill(Color(red: 1, green: 0.92, blue: 0.2).opacity(0.85)))
                    .padding(16)
            }
            .frame(maxHeight: .infinity)
            .background(Color(red: 0.73, green: 0.81, blue: 0.87))
            KeyboardPanel(panel: panel).frame(height: 300)
        }
        .onAppear {
            Store.save(Demo.box)
            panel.target = field
            panel.reload(hasAccess: true)
            if let q = Demo.value("-demo-query") { for c in q { panel.type(c) } }
            if Demo.has("-demo-pick"), let p = panel.results.first {
                panel.pick(p)
                let ok = field.text.hasSuffix(p.body) && field.text.contains("\n\n")
                Demo.write(["[검증] 넣은 문구: \(p.title)", "[검증] 줄바꿈 그대로: \(ok ? "예" : "아니오")",
                            "[검증] 줄 수: \(p.body.components(separatedBy: "\n").count)", field.text])
            }
        }
    }
}
#endif
