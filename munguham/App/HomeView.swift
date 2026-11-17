import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var lib: Library
    @State private var query = ""
    @State private var folder: FolderFilter = .all
    @State private var editing: Phrase?
    @State private var showSettings = false
    @State private var copied: Phrase?
    @State private var toastTask: Task<Void, Never>?
    @State private var reordering = false
    @State private var newFolder = false
    @State private var folderName = ""
    @State private var renaming: Folder?
    @State private var deleting: Phrase?

    private var results: [Phrase] { Finder.filter(lib.box, query: query, folder: query.isEmpty ? folder : .all) }
    private var canReorder: Bool { lib.box.sort == .manual && query.isEmpty }

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    folderBar
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                ForEach(results) { p in
                    row(p)
                        .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                .onMove(perform: canReorder ? { lib.reorder(visible: results, from: $0, to: $1) } : nil)
                if results.isEmpty { empty.listRowBackground(Color.clear).listRowSeparator(.hidden) }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.page)
            .environment(\.editMode, .constant(reordering ? .active : .inactive))
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "찾기 · 초성도 돼요 (예: ㄱㅈ)")
            .navigationTitle("문구함")
            .toolbar { toolbar }
            .overlay(alignment: .bottom) { toast }
            .sheet(item: $editing) { p in EditView(phrase: p, isNew: !lib.box.phrases.contains { $0.id == p.id }) }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .alert("새 폴더", isPresented: $newFolder) {
                TextField("폴더 이름", text: $folderName)
                Button("만들기") { if let id = lib.addFolder(folderName) { folder = .folder(id) } }
                Button("취소", role: .cancel) {}
            }
            .alert("폴더 이름 바꾸기", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("폴더 이름", text: $folderName)
                Button("바꾸기") { if let f = renaming { lib.renameFolder(f.id, folderName) } }
                Button("취소", role: .cancel) {}
            }
            .confirmationDialog("이 문구를 지울까요?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("지우기", role: .destructive) { if let d = deleting { lib.delete(d.id) } }
            } message: {
                Text("지워도 하루 한 번 남기는 자동 백업에서 되살릴 수 있어요")
            }
            .alert(lib.notice ?? "", isPresented: Binding(get: { lib.notice != nil }, set: { if !$0 { lib.notice = nil } })) {
                Button("확인", role: .cancel) {}
            }
        }
        #if DEBUG
        .onAppear(perform: Demo.home(lib: lib, edit: { editing = $0 }, settings: { showSettings = true }, query: { query = $0 }, folder: { folder = $0 }))
        #endif
    }

    // MARK: 폴더 줄

    private var folderBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("전체 \(lib.box.phrases.count)", .all)
                if lib.box.phrases.contains(where: \.favorite) { chip("★ 즐겨찾기", .favorites) }
                ForEach(lib.box.folders) { f in
                    chip(f.name, .folder(f.id))
                        .contextMenu {
                            Button("이름 바꾸기", systemImage: "pencil") { folderName = f.name; renaming = f }
                            Button("폴더 지우기 (문구는 남아요)", systemImage: "trash", role: .destructive) {
                                if folder == .folder(f.id) { folder = .all }
                                lib.deleteFolder(f.id)
                            }
                        }
                }
                Button { folderName = ""; newFolder = true } label: {
                    Image(systemName: "plus").font(.system(size: 14, weight: .bold))
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Theme.card))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
        }
    }

    private func chip(_ name: String, _ f: FolderFilter) -> some View {
        let on = folder == f
        return Button { withAnimation(.snappy) { folder = f } } label: {
            Text(name)
                .font(.system(size: 15, weight: on ? .bold : .medium))
                .foregroundStyle(on ? Color.white : Color.primary)
                .padding(.horizontal, 14).frame(height: 34)
                .background(Capsule().fill(on ? Theme.accent : Theme.card))
        }
        .buttonStyle(.plain)
    }

    // MARK: 문구 카드 — 누르면 복사

    private func row(_ p: Phrase) -> some View {
        Button { copy(p) } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    if p.favorite { Image(systemName: "star.fill").font(.system(size: 13)).foregroundStyle(.orange) }
                    Text(p.displayTitle).font(.system(size: 17, weight: .bold)).lineLimit(1)
                    Spacer(minLength: 8)
                    // 내가 정한 단축어는 진하게, 제목에서 따온 초성은 옅게
                    Text(p.key)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(p.shortcut.isEmpty ? Theme.accent.opacity(0.6) : Color.white)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(p.shortcut.isEmpty ? Theme.accent.opacity(0.08) : Theme.accent))
                        .lineLimit(1)
                }
                Text(p.body)
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack {
                    if case .all = folder, let n = lib.box.folderName(p.folder) {
                        HStack(spacing: 3) { Image(systemName: "folder"); Text(n) }
                            .font(.system(size: 12)).foregroundStyle(.tertiary)
                    }
                    if p.uses > 0 {
                        Text("\(p.uses)번 씀").font(.system(size: 12)).foregroundStyle(.tertiary)
                    }
                    Spacer()
                    Text("복사")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 16).frame(height: 32)
                        .background(Capsule().fill(Theme.accent.opacity(0.12)))
                }
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 18).fill(Theme.card))
            .contentShape(RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .leading) {
            Button { editing = p } label: { Label("수정", systemImage: "pencil") }.tint(.blue)
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { deleting = p } label: { Label("지우기", systemImage: "trash") }
        }
        .contextMenu {
            Button("복사", systemImage: "doc.on.doc") { copy(p) }
            Button("수정", systemImage: "pencil") { editing = p }
            Button(p.favorite ? "즐겨찾기 빼기" : "즐겨찾기", systemImage: p.favorite ? "star.slash" : "star") { lib.toggleFavorite(p.id) }
            Menu("폴더 옮기기", systemImage: "folder") {
                Button("폴더 없음") { lib.move(p.id, to: nil) }
                ForEach(lib.box.folders) { f in Button(f.name) { lib.move(p.id, to: f.id) } }
            }
            Button("복제", systemImage: "plus.square.on.square") { lib.duplicate(p) }
            Button("지우기", systemImage: "trash", role: .destructive) { deleting = p }
        }
    }

    private var empty: some View {
        VStack(spacing: 10) {
            Image(systemName: query.isEmpty ? "text.badge.plus" : "magnifyingglass")
                .font(.system(size: 34)).foregroundStyle(Theme.accent)
            Text(query.isEmpty ? "여기엔 문구가 없어요" : "‘\(query)’ 문구가 없어요").font(.headline)
            if query.isEmpty {
                Button("새 문구 넣기") { editing = newPhrase() }.buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private func newPhrase() -> Phrase {
        var p = Phrase(title: "", body: "")
        if case .folder(let id) = folder { p.folder = id }
        if case .favorites = folder { p.favorite = true }
        return p
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            if reordering {
                Button("완료") { reordering = false }.bold()
            } else {
                Menu {
                    Picker("정렬", selection: Binding(get: { lib.box.sort }, set: { lib.setSort($0) })) {
                        ForEach(SortOrder.allCases) { Text($0.label).tag($0) }
                    }
                    if lib.box.sort == .manual {
                        Button("순서 바꾸기", systemImage: "arrow.up.arrow.down") { query = ""; reordering = true }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down.circle")
                }
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { showSettings = true } label: { Image(systemName: "gearshape") }
            Button { editing = newPhrase() } label: { Image(systemName: "plus.circle.fill").font(.system(size: 20)) }
        }
    }

    // MARK: 복사 알림 + 카톡 열기

    private func copy(_ p: Phrase) {
        lib.copy(p)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        toastTask?.cancel()
        withAnimation(.snappy) { copied = p }
        toastTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            withAnimation { copied = nil }
        }
    }

    @ViewBuilder private var toast: some View {
        if let p = copied {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 22)).foregroundStyle(Theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("복사했어요").font(.system(size: 15, weight: .bold))
                    Text(p.body.contains("\n") ? "줄바꿈 그대로 붙여넣어져요" : p.displayTitle)
                        .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Button {
                    if let u = URL(string: "kakaotalk://") { UIApplication.shared.open(u) }
                } label: {
                    Text("카톡 열기")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color(red: 0.24, green: 0.12, blue: 0.12))
                        .padding(.horizontal, 14).frame(height: 36)
                        .background(Capsule().fill(Color(red: 1, green: 0.9, blue: 0)))
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 20).fill(.regularMaterial).shadow(color: .black.opacity(0.15), radius: 12, y: 4))
            .padding(.horizontal, 16).padding(.bottom, 12)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
