import SwiftUI

/// "한 영상으로 합치기" 창. 크기를 고르고, 진행률을 보고, 끝나면 공유·사진 앱.
struct StitchSheet: View {
    let r: Recording
    /// 다시 보기에서 쓰는 맞춤 값 그대로. 화면에서 본 대로 나간다.
    let align: StitchAlign
    /// 겹쳐 합치기인가(아니면 나란히).
    let merge: Bool
    var onDone: (URL) -> Void = { _ in }
    @AppStorage("saveToPhotos") private var saveToPhotos = true
    @State private var quality: Stitch.Quality = .full
    @State private var progress: Double?
    @State private var result: URL?
    @State private var error: String?
    @State private var photosNote: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text(merge
                     ? "두 카메라 크기를 맞추고(B ×\(String(format: "%.2f", align.scale))), 겹친 곳은 위 영상(\(align.top == 0 ? "A" : "B"))만 보이게 포개 한 화면으로 만든다. 다시 보기에서 본 그대로다. 원본은 그대로 둔다."
                     : "A·B 를 나란히 붙인 영상 파일 하나를 만든다. 원본은 그대로 둔다.")
                    .font(.system(size: 14)).foregroundStyle(Theme.dim)

                if let result {
                    Label("완료 · \(result.lastPathComponent)", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ball)
                    if let photosNote { Text(photosNote).font(.system(size: 13)).foregroundStyle(Theme.dim) }
                    HStack(spacing: 12) {
                        ShareLink(item: result) { Label("공유", systemImage: "square.and.arrow.up") }
                            .buttonStyle(.borderedProminent).tint(Theme.ball).foregroundStyle(.black)
                        Button("닫기") { dismiss() }.buttonStyle(.bordered)
                    }
                } else if let progress {
                    ProgressView(value: progress) { Text("합치는 중 · \(Int(progress * 100))%") }
                        .tint(Theme.ball)
                    Text("4K 는 영상 길이만큼 또는 그 이상 걸린다. 화면을 꺼도 된다 — 앱만 닫지 말 것.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim)
                } else {
                    Picker("크기", selection: $quality) {
                        ForEach(Stitch.Quality.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Text(quality == .full ? "긴 변 3840. 4K 화질 그대로라 시간이 걸리고 용량도 크다."
                                          : "긴 변 1920. 공유용으로 충분하고 훨씬 빠르다.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim)
                    if saveToPhotos { Text("끝나면 사진 앱에도 넣는다 (설정에서 끌 수 있다).").font(.system(size: 12)).foregroundStyle(Theme.dim) }
                    HStack(spacing: 12) {
                        Button { run() } label: { Label("합치기 시작", systemImage: "rectangle.split.2x1.slash") }
                            .buttonStyle(.borderedProminent).tint(Theme.ball).foregroundStyle(.black)
                        Button("취소") { dismiss() }.buttonStyle(.bordered)
                    }
                }
                if let error { Text(error).font(.system(size: 13)).foregroundStyle(.orange) }
                Spacer()
            }
            .padding(22)
            .background(Theme.bg)
            .navigationTitle("한 영상으로 합치기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.bg, for: .navigationBar)
            .interactiveDismissDisabled(progress != nil && result == nil)
        }
        .preferredColorScheme(.dark)
    }

    private func run() {
        error = nil; progress = 0
        UIApplication.shared.isIdleTimerDisabled = true
        Task {
            do {
                let url = try await Stitch.export(folder: r.folder, videos: r.videos, align: align, quality: quality) { p in
                    Task { @MainActor in progress = p }
                }
                result = url
                onDone(url)
                if saveToPhotos {
                    switch await PhotosExport.save(files: [url], startedAt: r.log?.startedAt, folder: nil) {
                    case .saved: photosNote = "사진 앱에도 저장됨"
                    case .denied: photosNote = "사진 앱 권한이 꺼져 있어 넣지 못했다"
                    case .failed(let why): photosNote = "사진 앱 저장 실패 · \(why)"
                    }
                }
            } catch {
                self.error = error.localizedDescription; progress = nil
            }
        }
    }
}
