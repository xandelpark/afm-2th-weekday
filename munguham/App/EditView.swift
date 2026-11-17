import SwiftUI

/// 문구 넣기·고치기
struct EditView: View {
    @EnvironmentObject private var lib: Library
    @Environment(\.dismiss) private var dismiss
    @State var phrase: Phrase
    let isNew: Bool
    @State private var confirmDelete = false
    @FocusState private var focus: Field?
    enum Field { case title, body, key }

    init(phrase: Phrase, isNew: Bool) {
        _phrase = State(initialValue: phrase)
        self.isNew = isNew
    }

    private var autoKey: String { Hangul.initials(phrase.title) }
    private var canSave: Bool { !phrase.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("제목 (예: 가격 안내)", text: $phrase.title)
                        .font(.system(size: 17, weight: .semibold))
                        .focused($focus, equals: .title)
                        .submitLabel(.next)
                        .onSubmit { focus = .body }
                    HStack {
                        Text("단축어").foregroundStyle(.secondary)
                        TextField(autoKey.isEmpty ? "예: ㄱㄱ" : autoKey, text: $phrase.shortcut)
                            .focused($focus, equals: .key)
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(Theme.accent)
                    }
                } footer: {
                    Text(phrase.shortcut.isEmpty
                         ? (autoKey.isEmpty ? "키보드에서 누를 초성이에요. 비워 두면 제목 초성으로 찾아요." : "비워 두면 제목 초성 ‘\(autoKey)’로 찾아요. 더 짧게 정해도 돼요.")
                         : "키보드에서 ‘\(phrase.key)’를 누르면 맨 위에 나와요.")
                }

                Section {
                    TextEditor(text: $phrase.body)
                        .font(.system(size: 16))
                        .frame(minHeight: 220)
                        .focused($focus, equals: .body)
                    PasteButton(payloadType: String.self) { strings in
                        guard let s = strings.first else { return }
                        Task { @MainActor in
                            if phrase.body.isEmpty { phrase.body = s } else { phrase.body += s }
                        }
                    }
                    .labelStyle(.titleAndIcon)
                } header: {
                    Text("내용")
                } footer: {
                    let lines = phrase.body.isEmpty ? 0 : phrase.body.components(separatedBy: "\n").count
                    Text("\(phrase.body.count)자 · \(lines)줄 — 줄바꿈까지 그대로 들어가요")
                }

                Section {
                    Picker("폴더", selection: $phrase.folder) {
                        Text("폴더 없음").tag(UUID?.none)
                        ForEach(lib.box.folders) { f in Text(f.name).tag(Optional(f.id)) }
                    }
                    Toggle("즐겨찾기", isOn: $phrase.favorite)
                }

                if !isNew {
                    Section {
                        Button("이 문구 지우기", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(isNew ? "새 문구" : "문구 고치기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") { lib.upsert(phrase); dismiss() }.bold().disabled(!canSave)
                }
            }
            .confirmationDialog("이 문구를 지울까요?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("지우기", role: .destructive) { lib.delete(phrase.id); dismiss() }
            }
            .onAppear { if isNew { focus = .title } }
        }
        .interactiveDismissDisabled(phrase.body != (lib.box.phrases.first { $0.id == phrase.id }?.body ?? ""))
    }
}
