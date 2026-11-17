import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject private var lib: Library
    @Environment(\.dismiss) private var dismiss
    @State private var practice = ""
    @State private var importing = false
    @State private var message: String?
    @State private var restoring: Store.Backup?
    @State private var backups: [Store.Backup] = []
    @State private var exportURL: URL?

    var body: some View {
        NavigationStack {
            Form {
                keyboardSection
                Section {
                    TextEditor(text: $practice)
                        .frame(minHeight: 110)
                        .overlay(alignment: .topLeading) {
                            if practice.isEmpty {
                                Text("여기를 누르고 🌐 지구본으로 문구함 키보드를 골라 보세요")
                                    .foregroundStyle(.tertiary).padding(.top, 8).padding(.leading, 5).allowsHitTesting(false)
                            }
                        }
                } header: {
                    Text("키보드 연습장")
                }

                Section {
                    if lib.box.folders.isEmpty {
                        Text("폴더가 없어요. 첫 화면 폴더 줄의 ＋ 로 만들어요").foregroundStyle(.secondary)
                    }
                    ForEach(lib.box.folders) { f in
                        HStack {
                            Image(systemName: "folder").foregroundStyle(Theme.accent)
                            Text(f.name)
                            Spacer()
                            Text("\(lib.box.phrases.filter { $0.folder == f.id }.count)개").foregroundStyle(.secondary)
                        }
                    }
                    .onMove { lib.moveFolders(from: $0, to: $1) }
                    .onDelete { idx in idx.map { lib.box.folders[$0].id }.forEach(lib.deleteFolder) }
                } header: {
                    Text("폴더")
                } footer: {
                    Text("왼쪽으로 밀어 지우면 폴더만 없어지고 문구는 남아요. 이름은 첫 화면에서 폴더를 꾹 눌러 바꿔요.")
                }

                Section {
                    if let u = exportURL {
                        ShareLink(item: u) { Label("백업 파일 보내기", systemImage: "square.and.arrow.up") }
                    }
                    Button { importing = true } label: { Label("백업 파일에서 가져오기", systemImage: "square.and.arrow.down") }
                } header: {
                    Text("백업")
                } footer: {
                    Text("문구는 이 폰 안에만 저장돼요. 백업 파일을 카톡 ‘나와의 채팅’이나 파일 앱에 보내 두면 폰을 바꿔도 옮길 수 있어요. 가져오면 지금 문구에 더해져요(같은 문구는 건너뜀).")
                }

                Section {
                    if backups.isEmpty { Text("아직 없어요 — 문구를 고친 날마다 하나씩 생겨요").foregroundStyle(.secondary) }
                    ForEach(backups) { b in
                        Button { restoring = b } label: {
                            HStack {
                                Text(b.day).foregroundStyle(Color.primary)
                                Spacer()
                                Text("문구 \(b.count)개").foregroundStyle(.secondary)
                                Image(systemName: "arrow.uturn.backward").foregroundStyle(Theme.accent)
                            }
                        }
                    }
                } header: {
                    Text("자동 백업 (최근 14일)")
                } footer: {
                    Text("그날 처음 고치기 전 상태가 남아요. 누르면 그날로 되돌려요.")
                }

                Section {
                    LabeledContent("문구", value: "\(lib.box.phrases.count)개")
                    LabeledContent("폴더", value: "\(lib.box.folders.count)개")
                    LabeledContent("버전", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
                }
            }
            .navigationTitle("설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() }.bold() } }
            .onAppear {
                backups = Store.backupList()
                exportURL = lib.exportFile()
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { r in
                guard case .success(let url) = r else { return }
                let ok = url.startAccessingSecurityScopedResource()
                defer { if ok { url.stopAccessingSecurityScopedResource() } }
                if let b = Store.read(url) {
                    let n = lib.merge(b)
                    message = n > 0 ? "문구 \(n)개를 더했어요" : "새로 더할 문구가 없었어요"
                } else {
                    message = "문구함 백업 파일이 아니에요"
                }
            }
            .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("확인", role: .cancel) {}
            }
            .confirmationDialog(restoring.map { "\($0.day) 상태로 되돌릴까요?" } ?? "", isPresented: Binding(get: { restoring != nil }, set: { if !$0 { restoring = nil } }), titleVisibility: .visible) {
                Button("되돌리기", role: .destructive) {
                    if let b = restoring { message = lib.restore(b) ? "\(b.day) 상태로 되돌렸어요" : "백업을 읽지 못했어요" }
                    backups = Store.backupList()
                }
            } message: {
                Text("지금 문구는 오늘 백업에 남아요")
            }
        }
    }

    private var keyboardSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                step(1, "아래 ‘설정 열기’ → 키보드 → ‘문구함’ 켜기")
                step(2, "같은 곳에서 ‘전체 접근 허용’ 켜기 (문구를 읽어 오려면 필요해요)")
                step(3, "카톡 입력창에서 🌐 지구본을 눌러 ‘문구함’으로 바꾸기")
                step(4, "자음을 눌러 찾고(예: ㄱㅈ), 문구를 누르면 줄바꿈 그대로 들어가요")
            }
            .padding(.vertical, 4)
            Button {
                if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
            } label: {
                Label("설정 열기", systemImage: "gear").bold()
            }
        } header: {
            Text("문구함 키보드 켜기")
        } footer: {
            Text("‘전체 접근 허용’을 켜도 문구함 키보드는 인터넷을 쓰지 않아요. 친 글자를 어디에도 보내지 않아요.")
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n)")
                .font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                .frame(width: 22, height: 22).background(Circle().fill(Theme.accent))
            Text(text).font(.system(size: 15))
        }
    }
}
