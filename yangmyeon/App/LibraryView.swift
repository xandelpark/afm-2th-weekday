import SwiftUI

/// 녹화한 경기 전부. 폰 안의 폴더가 곧 목록이다.
struct LibraryView: View {
    @State private var items: [Recording] = []
    @State private var toDelete: Recording?
    @State private var note: String?
    @State private var toStitch: Recording?
    @State private var stitchAlign: (align: StitchAlign, merge: Bool)?

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if items.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "film.stack").font(.system(size: 36)).foregroundStyle(Theme.dim)
                    Text("아직 녹화한 경기가 없다").foregroundStyle(Theme.dim)
                }
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12)], spacing: 12) {
                        ForEach(items) { r in
                            NavigationLink(value: Route.play(r)) { RecordingRow(r: r) }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    if r.isDual {
                                        Button { prepareStitch(r) } label: {
                                            Label(r.merged == nil ? "한 영상으로 합치기" : "다시 합치기", systemImage: "rectangle.split.2x1.slash")
                                        }
                                    }
                                    Button { export(r) } label: {
                                        Label(r.inPhotos ? "사진 앱에 다시 저장" : "사진 앱에 저장", systemImage: "photo.on.rectangle")
                                    }
                                    ShareLink(items: (r.merged.map { [$0] } ?? r.videos) + [r.folder.appendingPathComponent("포인트기록.txt")]) {
                                        Label("공유", systemImage: "square.and.arrow.up")
                                    }
                                    Button(role: .destructive) { toDelete = r } label: { Label("삭제", systemImage: "trash") }
                                }
                        }
                    }
                    .padding(20)
                }
            }
        }
        .navigationTitle("경기 기록")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.bg, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Text("\(items.count)경기 · \(Fmt.gb(items.reduce(0) { $0 + $1.bytes }))")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
            }
        }
        .onAppear { items = Recordings.all() }
        .sheet(item: $toStitch) { r in
            if let s = stitchAlign {
                StitchSheet(r: r, align: s.align, merge: s.merge) { _ in items = Recordings.all() }
            }
        }
        .overlay(alignment: .bottom) {
            if let note {
                Text(note)
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(Theme.card2, in: Capsule())
                    .foregroundStyle(Theme.text)
                    .padding(.bottom, 16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .confirmationDialog("이 경기를 지울까?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }),
                            titleVisibility: .visible) {
            Button("영상과 기록을 모두 삭제", role: .destructive) {
                if let r = toDelete { Recordings.delete(r); items = Recordings.all() }
                toDelete = nil
            }
            Button("취소", role: .cancel) { toDelete = nil }
        } message: { Text(toDelete.map { "\($0.title) · \(Fmt.gb($0.bytes))" } ?? "") }
    }

    /// 다시 보기에서 고른 보기 방식과 맞춤 값. 처음이면 자동으로 맞춘다(몇 초).
    static func savedAlign(_ r: Recording) async -> (align: StitchAlign, merge: Bool)? {
        let (p, _) = await StitchPrefs.resolve(folder: r.folder, videos: r.videos)
        guard let src = try? await Stitch.Sources.load(r.videos) else { return nil }
        if p.merge, src.a.height > src.a.width, let a = p.align { return (a, true) }
        return (.sideBySide(a: src.a, b: src.b), false)
    }

    private func prepareStitch(_ r: Recording) {
        withAnimation { note = "두 카메라 크기·위치 맞추는 중…" }
        Task {
            let s = await Self.savedAlign(r)
            withAnimation { note = s == nil ? "영상을 읽지 못했다" : nil }
            guard let s else { return }
            stitchAlign = s
            toStitch = r
        }
    }

    private func export(_ r: Recording) {
        withAnimation { note = "\(r.title) — 사진 앱에 넣는 중…" }
        Task {
            let out = await PhotosExport.save(folder: r.folder, startedAt: r.log?.startedAt)
            let text: String
            switch out {
            case .saved(let n): text = "사진 앱에 저장됨 · 영상 \(n)개"
            case .denied:       text = "사진 앱 권한이 꺼져 있다 — 설정 앱 → 양면 에서 허용"
            case .failed(let why): text = "저장 실패 · \(why)"
            }
            withAnimation { note = text; items = Recordings.all() }
            try? await Task.sleep(for: .seconds(5))
            withAnimation { if note == text { note = nil } }
        }
    }
}
