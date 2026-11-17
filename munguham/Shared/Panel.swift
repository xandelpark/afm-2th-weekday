import SwiftUI

/// 키보드가 글을 넣는 곳. 진짜 키보드에서는 textDocumentProxy, 앱 안 미리보기에서는 글상자.
@MainActor
protocol KeyTarget: AnyObject {
    func insert(_ text: String)
    func deleteBackward()
    func nextKeyboard()
    func click()
}

@MainActor
final class Panel: ObservableObject {
    enum State: Equatable { case ready, needsAccess, empty }

    @Published var box = Box()
    @Published var state: State = .ready
    @Published var query = ""
    @Published var folder: FolderFilter = .all
    @Published var flash: String?
    @Published var showGlobe = false
    weak var target: KeyTarget?
    private var flashTask: Task<Void, Never>?

    /// 문구 파일을 다시 읽는다. 전체 접근이 꺼져 있으면 App Group 폴더를 못 읽는다.
    func reload(hasAccess: Bool) {
        switch Store.load() {
        case .ok(let b):
            box = Store.applying(Store.readUses(), to: b)
            state = b.phrases.isEmpty ? .empty : .ready
        case .missing, .unreadable:
            box = Box()
            state = hasAccess ? .empty : .needsAccess
        }
    }

    var results: [Phrase] {
        Finder.filter(box, query: query, folder: query.isEmpty ? folder : .all)
    }

    func type(_ c: Character) {
        target?.click()
        query.append(c)
    }

    /// 초성을 치는 중이면 초성을 지우고, 아니면 글을 지운다.
    func back() {
        target?.click()
        if !query.isEmpty { query.removeLast() } else { target?.deleteBackward() }
    }

    func pick(_ p: Phrase) {
        target?.click()
        target?.insert(p.body)
        Store.noteUse(p.id)
        if let i = box.phrases.firstIndex(where: { $0.id == p.id }) {
            box.phrases[i].uses += 1
            box.phrases[i].lastUsed = Date()
        }
        query = ""
        flashTask?.cancel()
        withAnimation(.easeOut(duration: 0.15)) { flash = p.displayTitle }
        flashTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.4))
            guard !Task.isCancelled else { return }
            withAnimation { self.flash = nil }
        }
    }
}

/// 키보드 색 — 아이폰 기본 키보드와 비슷하게.
enum KeyColor {
    static let back = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.13, alpha: 1) : UIColor(red: 0.82, green: 0.835, blue: 0.86, alpha: 1) })
    static let key = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.36, alpha: 1) : .white })
    static let fn = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.24, alpha: 1) : UIColor(red: 0.67, green: 0.69, blue: 0.73, alpha: 1) })
    static let accent = Color(red: 0.07, green: 0.62, blue: 0.53)
}

/// 문구함 키보드 화면: 위 = 찾은 문구, 아래 = 초성 자음판.
struct KeyboardPanel: View {
    @ObservedObject var panel: Panel

    var body: some View {
        VStack(spacing: 6) {
            topBar.frame(height: 34)
            content.frame(maxHeight: .infinity)
            consonants
            bottomRow
        }
        .padding(.horizontal, 4)
        .padding(.top, 6)
        .padding(.bottom, 4)
        .background(KeyColor.back)
    }

    // MARK: 위 줄 — 폴더 고르기 / 친 초성 / 넣었다는 알림

    @ViewBuilder private var topBar: some View {
        if let f = panel.flash {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(KeyColor.accent)
                Text("넣었어요 · \(f)").font(.system(size: 15, weight: .semibold)).lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 8)
            .transition(.opacity)
        } else if !panel.query.isEmpty {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                Text(panel.query).font(.system(size: 22, weight: .bold))
                Text("\(panel.results.count)개").font(.system(size: 13)).foregroundStyle(.secondary)
                Spacer()
                Button { panel.query = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 22)).foregroundStyle(.secondary)
                        .frame(width: 44, height: 34)
                }
            }
            .padding(.leading, 8)
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    chip("전체", .all)
                    if panel.box.phrases.contains(where: \.favorite) { chip("★ 즐겨찾기", .favorites) }
                    ForEach(panel.box.folders) { f in chip(f.name, .folder(f.id)) }
                }
                .padding(.horizontal, 4)
            }
        }
    }

    private func chip(_ name: String, _ f: FolderFilter) -> some View {
        let on = panel.folder == f
        return Button { panel.folder = f } label: {
            Text(name)
                .font(.system(size: 14, weight: on ? .bold : .medium))
                .foregroundStyle(on ? Color.white : Color.primary)
                .padding(.horizontal, 12).frame(height: 30)
                .background(Capsule().fill(on ? KeyColor.accent : KeyColor.key))
        }
        .buttonStyle(.plain)
    }

    // MARK: 문구 칸

    @ViewBuilder private var content: some View {
        switch panel.state {
        case .needsAccess:
            notice("lock.open", "‘전체 접근 허용’을 켜 주세요", "설정 → 일반 → 키보드 → 키보드 → 문구함\n→ 전체 접근 허용")
        case .empty:
            notice("text.badge.plus", "문구가 아직 없어요", "문구함 앱에서 자주 쓰는 문구를 넣어 주세요")
        case .ready:
            let list = panel.results
            if list.isEmpty {
                notice("magnifyingglass", "‘\(panel.query)’ 문구가 없어요", "⌫ 로 초성을 지우고 다시 찾아 보세요")
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 6)], spacing: 6) {
                        ForEach(list) { p in card(p) }
                    }
                    .padding(.horizontal, 2)
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    private func card(_ p: Phrase) -> some View {
        Button { panel.pick(p) } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    if p.favorite { Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(.orange) }
                    Text(p.displayTitle).font(.system(size: 15, weight: .bold)).lineLimit(1)
                    Spacer(minLength: 2)
                    Text(p.key).font(.system(size: 11, weight: .semibold)).foregroundStyle(KeyColor.accent).lineLimit(1)
                }
                Text(p.body.replacingOccurrences(of: "\\s*\\n\\s*", with: " ↵ ", options: .regularExpression))
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 8).fill(KeyColor.key).shadow(color: .black.opacity(0.18), radius: 0, y: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func notice(_ icon: String, _ title: String, _ detail: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 24)).foregroundStyle(KeyColor.accent)
            Text(title).font(.system(size: 16, weight: .bold))
            Text(detail).font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: 자음판

    private var consonants: some View {
        VStack(spacing: 6) {
            ForEach(0..<2, id: \.self) { row in
                HStack(spacing: 5) {
                    ForEach(Hangul.pad[(row * 7)..<(row * 7 + 7)], id: \.self) { c in
                        Key(fill: KeyColor.key) { panel.type(c) } label: {
                            Text(String(c)).font(.system(size: 21, weight: .regular))
                        }
                    }
                }
            }
        }
    }

    private var bottomRow: some View {
        HStack(spacing: 5) {
            if panel.showGlobe {
                Key(fill: KeyColor.fn, width: 46) { panel.target?.nextKeyboard() } label: {
                    Image(systemName: "globe").font(.system(size: 19))
                }
            }
            RepeatKey(fill: KeyColor.fn, width: 56) { panel.back() } label: {
                Image(systemName: "delete.left").font(.system(size: 19))
            }
            Key(fill: KeyColor.key) { panel.target?.click(); panel.target?.insert(" ") } label: {
                Text("띄어쓰기").font(.system(size: 15))
            }
            Key(fill: KeyColor.fn, width: 84) { panel.target?.click(); panel.target?.insert("\n") } label: {
                Text("줄바꿈").font(.system(size: 15))
            }
        }
    }
}

/// 키 하나 (눌렀을 때 살짝 어두워진다)
struct Key<L: View>: View {
    var fill: Color
    var width: CGFloat? = nil
    let action: () -> Void
    @ViewBuilder let label: () -> L
    var body: some View {
        Button(action: action) {
            label()
                .foregroundStyle(Color.primary)
                .frame(maxWidth: width ?? .infinity, minHeight: 40, maxHeight: 40)
                .frame(width: width)
                .background(RoundedRectangle(cornerRadius: 6).fill(fill).shadow(color: .black.opacity(0.22), radius: 0, y: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(KeyPress())
    }
}

struct KeyPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.55 : 1)
    }
}

/// 꾹 누르고 있으면 계속 지워지는 지우기 키
struct RepeatKey<L: View>: View {
    var fill: Color
    var width: CGFloat
    let action: () -> Void
    @ViewBuilder let label: () -> L
    @State private var pressed = false
    @State private var timer: Task<Void, Never>?

    var body: some View {
        label()
            .foregroundStyle(Color.primary)
            .frame(width: width, height: 40)
            .background(RoundedRectangle(cornerRadius: 6).fill(fill).shadow(color: .black.opacity(0.22), radius: 0, y: 1))
            .opacity(pressed ? 0.55 : 1)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !pressed else { return }
                    pressed = true
                    action()
                    timer = Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(450))
                        while !Task.isCancelled {
                            action()
                            try? await Task.sleep(for: .milliseconds(90))
                        }
                    }
                }
                .onEnded { _ in
                    pressed = false
                    timer?.cancel()
                    timer = nil
                })
    }
}
