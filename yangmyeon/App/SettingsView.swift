import SwiftUI
import MatchCore

/// 설정. 경기 형식·이름은 Session 에, 촬영 쪽은 CaptureEngine/UserDefaults 에 산다.
struct SettingsView: View {
    @EnvironmentObject private var s: Session
    @AppStorage("maxWidth") private var maxWidth: Int = 3840
    @AppStorage("guideOn") private var guideOn = true
    @AppStorage("saveToPhotos") private var saveToPhotos = true
    @AppStorage("seamOn") private var seamOn = true
    @State private var used: Int64 = 0
    @State private var free: Int64 = 0

    var body: some View {
        Form {
            Section {
                Picker("경기 형식", selection: $s.formatKey) {
                    ForEach(Session.formats, id: \.key) { Text($0.label).tag($0.key) }
                }
                TextField("경기 이름", text: $s.matchName)
                TextField("A 코트 이름 (왼쪽)", text: $s.nameA)
                TextField("B 코트 이름 (오른쪽)", text: $s.nameB)
                Picker("첫 서브", selection: $s.firstServer) {
                    Text(s.nameA).tag(0); Text(s.nameB).tag(1)
                }
            } header: { Text("경기") }
            footer: {
                Text(s.log.entries.isEmpty ? "형식을 바꾸면 점수가 0 에서 시작한다."
                                           : "지금 진행 중인 경기에 점수가 있어 형식은 바꿀 수 없다. 촬영 화면에서 '새 경기' 를 누른 뒤에.")
            }

            Section {
                Picker("거치 방식", selection: Binding(get: { s.camera.mount }, set: { s.camera.mount = $0 })) {
                    ForEach(CaptureEngine.Mount.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                Picker("최대 해상도", selection: $maxWidth) {
                    Text("4K (코트당 3840×2160)").tag(3840)
                    Text("1080p — 용량 절반, 발열 적음").tag(1920)
                }
                Toggle("화면 안내선", isOn: $guideOn)
                Toggle("겹치는 띠 잘라서 이어 붙이기", isOn: $seamOn)
                Toggle("왼쪽(A) = 뒷면 카메라", isOn: Binding(get: { s.camera.leftIsRear }, set: { s.camera.leftIsRear = $0 }))
            } header: { Text("촬영") }
            footer: { Text("해상도는 다음 촬영부터 적용된다. 양쪽 4K 는 시간당 약 15 GB, 1080p 는 약 8 GB.\n코트 옆 V자 거치에서는 두 카메라가 네트 쪽을 함께 보기 때문에 가운데가 겹친다. 켜 두면 접은 각도에서 겹친 폭을 계산해 화면과 다시 보기에서 잘라내고, 영상 파일은 원본 그대로 남긴다.") }

            Section {
                Toggle("녹화가 끝나면 사진 앱에도 저장", isOn: $saveToPhotos)
                LabeledContent("경기 영상", value: Fmt.gb(used))
                LabeledContent("남은 공간", value: Fmt.gb(free))
                NavigationLink(value: Route.library) { Text("경기 기록 관리") }
            } header: { Text("저장 공간 — 전부 이 폰 안에 있다") }
            footer: { Text("다시 보기용 원본은 파일 앱 → 나의 iPhone → 양면 에 있다. 사진 앱에 넣으면 복사본이 하나 더 생겨 용량을 두 배로 쓴다. 서버에는 아무것도 올라가지 않는다.") }

            Section {
                NavigationLink(value: Route.guide) { Label("설치 안내 · 진단", systemImage: "info.circle") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("설정")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.bg, for: .navigationBar)
        .onAppear { used = Recordings.usedBytes; free = Recordings.freeBytes }
    }
}
