import SwiftUI
import AVFoundation
import Combine
import MatchCore

@MainActor
final class Session: ObservableObject {
    /// 경기 형식 프리셋. 설정 화면의 선택지이자 저장 키다.
    static let formats: [(key: String, label: String, format: Format)] = [
        ("set6",      "단세트 6게임",            .단세트6게임),
        ("set4noad",  "단세트 4게임 · 노애드",    .단세트4게임노애드),
        ("best3",     "3세트 (2선승)",           .삼세트),
        ("best3super","3세트 · 마지막은 슈퍼타이", .삼세트슈퍼타이),
    ]
    private static let d = UserDefaults.standard

    @Published var match: Match
    @Published var log: MatchLog
    @Published var nameA: String = d.string(forKey: "nameA") ?? "A 코트" { didSet { Self.d.set(nameA, forKey: "nameA") } }
    @Published var nameB: String = d.string(forKey: "nameB") ?? "B 코트" { didSet { Self.d.set(nameB, forKey: "nameB") } }
    @Published var matchName: String = d.string(forKey: "matchName") ?? "경기" {
        didSet { Self.d.set(matchName, forKey: "matchName"); log.matchName = matchName.isEmpty ? "경기" : matchName }
    }
    /// 첫 서브. 0 = A, 1 = B.
    @Published var firstServer: Int = d.integer(forKey: "firstServer") {
        didSet { Self.d.set(firstServer, forKey: "firstServer"); if log.entries.isEmpty { reset() } }
    }
    /// 형식을 바꾸면 경기를 다시 시작한다. 단, 이미 센 점이 있으면 바꾸지 않는다 —
    /// 중간에 바꾸면 기록이 날아가고, 그건 되돌릴 수 없다.
    @Published var formatKey: String = d.string(forKey: "formatKey") ?? "set6" {
        didSet {
            guard log.entries.isEmpty else { formatKey = oldValue; return }
            Self.d.set(formatKey, forKey: "formatKey")
            format = Self.formats.first { $0.key == formatKey }?.format ?? .단세트6게임
        }
    }
    @Published private(set) var format: Format = .단세트6게임 { didSet { reset() } }
    var formatLabel: String { Self.formats.first { $0.key == formatKey }?.label ?? "" }
    /// 마지막으로 저장된 폴더 이름.
    @Published var lastSaved: String?
    @Published var photosNote: String?
    /// 득점 탭 잠금. 거치하고 각도 맞추는 동안 화면을 만지면 점수가 들어간다.
    @Published var locked = true

    let camera = CaptureEngine()
    private var bag: [AnyCancellable] = []

    init() {
        let key = Self.d.string(forKey: "formatKey") ?? "set6"
        let f = Self.formats.first { $0.key == key }?.format ?? .단세트6게임
        let fs: Side = Self.d.integer(forKey: "firstServer") == 1 ? .right : .left
        match = Match(format: f, firstServer: fs)
        log = MatchLog(matchName: Self.d.string(forKey: "matchName") ?? "경기", format: f)
        log.videoFiles = camera.videoFileNames
        format = f
        // 중첩된 ObservableObject 의 변화는 바깥으로 전달되지 않는다.
        // 이 줄이 없으면 카메라 상태가 바뀌어도 화면은 "준비하는 중" 에 멈춘다.
        camera.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &bag)
        // 폴더를 "가장 최근 디렉터리" 로 추측하지 않는다. 엔진이 쓴 폴더를 그대로 받는다.
        camera.onRecordingFinished = { [weak self] folder, interrupted in
            guard let self else { return }
            self.log.interrupted = interrupted
            self.log.videoFiles = self.camera.videoFileNames
            if self.camera.isDual {
                self.log.hingeDegrees = self.camera.recordingHinge
                self.log.mount = self.camera.mount.rawValue
                let rear = self.camera.fovAcross(rear: true), front = self.camera.fovAcross(rear: false)
                self.log.fovAcross = self.camera.leftIsRear ? [rear, front] : [front, rear]
            }
            self.log.save(to: folder)
            self.lastSaved = folder.lastPathComponent
            self.exportToPhotosIfWanted(folder: folder)
        }
    }

    /// 설정 "사진 앱에도 저장" 이 켜져 있으면 녹화가 끝나는 즉시 사진 앱에 복사한다.
    func exportToPhotosIfWanted(folder: URL) {
        guard UserDefaults.standard.object(forKey: "saveToPhotos") as? Bool ?? true else { return }
        guard !camera.isSimulated else { return }
        photosNote = "사진 앱에 넣는 중…"
        let startedAt = log.startedAt
        Task { @MainActor in
            let out = await PhotosExport.save(folder: folder, startedAt: startedAt)
            switch out {
            case .saved(let n): photosNote = "사진 앱에 저장됨 · 영상 \(n)개"
            case .denied:       photosNote = "사진 앱 권한이 꺼져 있다 — 설정 앱에서 허용"
            case .failed(let why): photosNote = "사진 앱 저장 실패 · \(why)"
            }
            camera.say(photosNote ?? "")
            try? await Task.sleep(for: .seconds(8))
            if case .saved = out { photosNote = nil }
        }
    }

    var expectedMinutes: Int {
        Preflight.expectedMinutes(gamesPerSet: format.gamesPerSet, sets: format.totalSets)
    }

    /// 새 경기. 점수·기록을 비운다. 녹화 중에는 부르지 않는다.
    func reset() {
        match = Match(format: format, firstServer: firstServer == 1 ? .right : .left)
        log = MatchLog(matchName: matchName.isEmpty ? "경기" : matchName, format: format)
        log.videoFiles = camera.videoFileNames
        lastSaved = nil
    }

    func score(_ s: Side) {
        guard !locked, !match.isOver else { return }
        let before = match
        match.scorePoint(s)
        // 녹화 중이 아니어도 점수는 세어준다. 다만 타임코드는 없다고 적는다 —
        // 0 으로 적으면 영상 맨 앞을 가리키는 거짓말이 된다.
        log.record(at: camera.isRecording ? camera.elapsed : -1,
                   by: s, before: before, after: match)
    }

    func undo() {
        guard match.canUndo else { return }
        match.undo()
        log.removeLast()
    }

    #if targetEnvironment(simulator)
    /// 시뮬레이터 스크린샷용. `-demo NNNFF` 처럼 득점 순서를 넘기면 그 상황을 만든다.
    /// N = A(왼쪽) 득점, F = B(오른쪽) 득점. `-demo-record` 를 주면 녹화 중 상태로 만든다.
    func applyDemoArguments() {
        let args = ProcessInfo.processInfo.arguments
        print("[데모] 인자: \(args.dropFirst())")
        if args.contains("-demo-record") { camera.startRecording(matchName: log.matchName) }
        if let i = args.firstIndex(of: "-demo"), i + 1 < args.count {
            locked = false
            for c in args[i + 1] where c == "N" || c == "F" { score(c == "N" ? .left : .right) }
        }
    }
    #endif
}

struct ContentView: View {
    @EnvironmentObject private var s: Session
    @Environment(\.dismiss) private var dismiss
    @State private var showSetup = false
    @State private var showLog = false
    @State private var showPreflight = false
    @State private var preflight: [Preflight.Item] = []
    @State private var broadcast = false
    @AppStorage("guideOn") private var guideOn = true
    @State private var confirmNew = false
    /// 화면 안에서 영상이 차지하는 영역. 폴더블 화면(1.4:1)은 16:9 영상 위아래가 빈다.
    @State private var videoRect: CGRect?
    /// 힌지 상태. 바뀔 때마다 엔진 로그(진단.txt)에 남긴다.
    @State private var hinge = ""
    @State private var videoRectRear: CGRect?
    @State private var videoRectFront: CGRect?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch s.camera.state {
            case .idle:
                VStack(spacing: 14) {
                    ProgressView().tint(.white)
                    Text("카메라를 준비하는 중").foregroundStyle(.white.opacity(0.75))
                }
            case .unsupported(let why), .failed(let why):
                Blocked(reason: why, log: s.camera.log)
            case .ready, .recording:
                court
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .onDisappear { if !s.camera.isRecording { s.camera.stop() } }
        .task {
            // 권한을 먼저 받고 나서 설정한다. 순서가 뒤바뀌면 렌즈 목록이 비어 나온다.
            guard await AVCaptureDevice.requestAccess(for: .video) else {
                s.camera.markPermissionDenied(); return
            }
            _ = await AVCaptureDevice.requestAccess(for: .audio)
            if case .idle = s.camera.state { await s.camera.configure() }
            if !s.camera.isSimulated { s.camera.start() }
            #if DEBUG
            // 실기기 검증용: `-autorecord 10` 이면 2초 뒤 녹화를 시작해 10초 뒤 멈춘다.
            // 맥에서 케이블로 띄워 놓고 파일을 꺼내 보기 위한 것. 릴리스 빌드엔 없다.
            let a0 = ProcessInfo.processInfo.arguments
            if let i = a0.firstIndex(of: "-autorecord"), i + 1 < a0.count, let sec = Double(a0[i + 1]) {
                try? await Task.sleep(for: .seconds(2))
                s.locked = false
                s.camera.startRecording(matchName: "자동검증")
                Task {
                    try? await Task.sleep(for: .seconds(sec / 2)); s.score(.left)
                    try? await Task.sleep(for: .seconds(sec / 2)); s.score(.right)
                    s.camera.stopRecording()
                }
            }
            #endif
            #if targetEnvironment(simulator)
            s.applyDemoArguments()
            if ProcessInfo.processInfo.arguments.contains("-demo-broadcast") { broadcast = true }
            // `-demo-sheet setup|log|preflight` 로 시트를 바로 띄운다 (스크린샷용).
            let a = ProcessInfo.processInfo.arguments
            if let i = a.firstIndex(of: "-demo-sheet"), i + 1 < a.count {
                switch a[i + 1] {
                case "setup": showSetup = true
                case "log": showLog = true
                case "preflight":
                    preflight = s.camera.preflight(expectedMinutes: s.expectedMinutes)
                    showPreflight = true
                default: break
                }
            }
            #endif
        }
        .sheet(isPresented: $showSetup) { SetupSheet(engine: s.camera) }
        .sheet(isPresented: $showLog) { LogSheet(log: s.log) }
        .sheet(isPresented: $showPreflight) {
            PreflightSheet(items: preflight, blocked: Preflight.blocked(preflight)) {
                showPreflight = false
                s.lastSaved = nil
                s.camera.startRecording(matchName: s.log.matchName)
            }
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .background(HingeProbe(text: $hinge).frame(width: 0, height: 0))
        .onChange(of: hinge) { _, new in
            // "힌지: 반쯤 펼침 · 112°" 꼴. 각도만 뽑아 엔진에 넘긴다.
            guard !new.isEmpty else { return }
            let parts = new.replacingOccurrences(of: "힌지: ", with: "").components(separatedBy: " · ")
            let deg = parts.count > 1 ? Int(parts[1].replacingOccurrences(of: "°", with: "")) : nil
            s.camera.updateHinge(status: parts[0], degrees: deg)
        }
    }

    private var court: some View {
        ZStack {
            if s.camera.isDual {
                // 왼쪽 = A 코트, 오른쪽 = B 코트. 어느 카메라가 왼쪽인지는 엔진의 leftIsRear.
                HStack(spacing: 2) {
                    panel(rear: s.camera.leftIsRear, side: .left)
                    panel(rear: !s.camera.leftIsRear, side: .right)
                }
                .background(Color.black)
                .ignoresSafeArea()
            } else if s.camera.isSimulated {
                SimulatedCourt(videoRect: $videoRect).ignoresSafeArea()
            } else {
                CameraPreview(engine: s.camera, videoRect: $videoRect).ignoresSafeArea()
            }
            CourtGuide(active: !s.locked, showGuide: guideOn, videoRect: videoRect, dual: s.camera.isDual)
                .ignoresSafeArea()

            // 좌/우 탭 — 네트가 가운데라 화면 반이 그대로 코트 한쪽이다.
            HStack(spacing: 0) {
                tap(.left); tap(.right)
            }
            .ignoresSafeArea()

            VStack {
                topBar
                if let why = s.camera.interruption { banner(why) }
                if let why = s.camera.hingeWarning { banner(why) }
                Spacer()
                Scoreboard(match: s.match, nameA: s.nameA, nameB: s.nameB, large: broadcast)
                    .frame(maxWidth: broadcast ? 560 : 420)
                    .shadow(radius: 12, y: 3)
                if s.match.changeEndsDue { changeEnds }
                if s.locked { lockNote }
                if let saved = s.lastSaved { savedNote(saved) }
                if let p = s.photosNote { savedNote(p) }
                bottomBar
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
    }

    /// 양쪽 카메라 모드의 한 패널.
    @ViewBuilder
    private func panel(rear: Bool, side: Side) -> some View {
        if s.camera.isSimulated {
            SimulatedCourt(videoRect: rear ? $videoRectRear : $videoRectFront, half: side)
        } else {
            // 왼쪽 패널의 안쪽은 오른쪽 가장자리. 겹친 띠를 그만큼 잘라 두 영상이 이어지게.
            DualPreviewHalf(engine: s.camera, rear: rear, innerIsRight: side == .left,
                            crop: s.camera.seamCrop(rear: rear),
                            videoRect: rear ? $videoRectRear : $videoRectFront)
        }
    }

    private func tap(_ side: Side) -> some View {
        Rectangle()
            .fill(.clear)
            .contentShape(Rectangle())
            .onTapGesture { s.score(side) }
    }

    private var topBar: some View {
        HStack(spacing: 8) {
            if !s.camera.isRecording {
                Button { dismiss() } label: { icon("chevron.left") }
            }
            if case .recording = s.camera.state {
                pill("녹화 중", "record.circle.fill", .red)
            }
            if s.camera.thermal == .serious || s.camera.thermal == .critical {
                pill("기기 발열", "thermometer.high", .orange)
            }
            if case .ready(let l, let r) = s.camera.state {
                pill("\(l) · \(r)", "camera", .white.opacity(0.8))
            }
            if s.camera.isDual, let d = s.camera.hingeDegrees {
                let c = Int((s.camera.seamCrop(rear: true) * 100).rounded())
                pill("힌지 \(d)°" + (c > 0 ? " · 겹침 \(c)% 잘림" : ""), "angle",
                     s.camera.hingeWarning == nil ? .white.opacity(0.8) : .orange)
            }
            Spacer()
            Button { guideOn.toggle() } label: { icon(guideOn ? "grid" : "grid.circle") }
            if s.camera.isDual {
                // 어느 카메라가 A(왼쪽)인지. 거치 방향에 따라 바뀐다.
                Button { s.camera.leftIsRear.toggle() } label: { icon("arrow.left.arrow.right") }
                Button { s.camera.rotate() } label: { icon("rotate.right") }
            }
            Button { s.camera.flip() } label: { icon("arrow.trianglehead.2.clockwise") }
            Button { showSetup = true } label: { icon("info.circle") }
            Button { broadcast.toggle() } label: {
                icon(broadcast ? "arrow.down.right.and.arrow.up.left"
                               : "arrow.up.left.and.arrow.down.right")
            }
        }
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            Button { s.locked.toggle() } label: {
                icon(s.locked ? "lock.fill" : "hand.tap.fill")
            }
            Button { s.undo() } label: { icon("arrow.uturn.backward") }
                .disabled(!s.match.canUndo || s.locked)
            Button { showLog = true } label: { icon("list.bullet.rectangle") }
            if !s.camera.isRecording && !s.log.entries.isEmpty {
                Button { confirmNew = true } label: { icon("plus.circle") }
                    .confirmationDialog("새 경기를 시작할까?", isPresented: $confirmNew, titleVisibility: .visible) {
                        Button("점수를 0 으로 — 저장된 기록은 그대로", role: .destructive) { s.reset() }
                        Button("취소", role: .cancel) {}
                    }
            }
            Spacer()
            recordButton
        }
    }

    private var recordButton: some View {
        Group {
            if case .recording = s.camera.state {
                Button { s.camera.stopRecording() } label: {
                    Label("녹화 정지", systemImage: "stop.fill")
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(.red, in: Capsule())
                        .foregroundStyle(.white)
                }
            } else {
                Button {
                    // 점검을 먼저 보여준다. 경기 다 치르고 "공간이 없었다" 를 알면 늦다.
                    preflight = s.camera.preflight(expectedMinutes: s.expectedMinutes)
                    if preflight.contains(where: { $0.level != .ok }) {
                        showPreflight = true
                    } else {
                        s.lastSaved = nil
                        s.camera.startRecording(matchName: s.log.matchName)
                    }
                } label: {
                    Label("녹화", systemImage: "record.circle")
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 18).padding(.vertical, 10)
                        .background(.white, in: Capsule())
                        .foregroundStyle(.black)
                }
            }
        }
    }

    private func pill(_ t: String, _ n: String, _ c: Color) -> some View {
        Label(t, systemImage: n)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(c)
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(.black.opacity(0.6), in: Capsule())
    }

    private func banner(_ text: String) -> some View {
        HStack(spacing: 7) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(text).font(.system(size: 12, weight: .semibold))
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(.orange, in: Capsule())
        .foregroundStyle(.black)
        .padding(.top, 6)
    }

    private var changeEnds: some View {
        Text("코트 체인지")
            .font(.system(size: 13, weight: .bold))
            .padding(.horizontal, 14).padding(.vertical, 7)
            .background(Color(red: 0.85, green: 0.95, blue: 0.25), in: Capsule())
            .foregroundStyle(.black)
            .padding(.top, 8)
    }

    private var lockNote: some View {
        Text("탭 잠김 — 자물쇠를 눌러 득점 모드로")
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 11).padding(.vertical, 5)
            .background(.black.opacity(0.6), in: Capsule())
            .foregroundStyle(.white.opacity(0.7))
            .padding(.top, 8)
    }

    private func savedNote(_ name: String) -> some View {
        Text("저장됨 · \(name)")
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(.black.opacity(0.6), in: Capsule())
            .foregroundStyle(.white.opacity(0.85))
            .padding(.top, 6)
    }

    private func icon(_ n: String) -> some View {
        Image(systemName: n)
            .font(.system(size: 15, weight: .semibold))
            .frame(width: 38, height: 38)
            .background(.black.opacity(0.55), in: Circle())
            .foregroundStyle(.white)
    }
}

/// 카메라를 못 쓸 때. 왜 안 되는지를 숨기지 않고 그대로 보여준다.
private struct Blocked: View {
    let reason: String
    let log: [String]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("카메라를 쓸 수 없다").font(.system(size: 20, weight: .bold))
                Text(reason).font(.system(size: 14)).foregroundStyle(.white.opacity(0.8))
                if !log.isEmpty {
                    Text("시도한 내용")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.5))
                    ForEach(Array(log.enumerated()), id: \.offset) { _, l in
                        Text("· " + l)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.6))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(22)
        }
        .foregroundStyle(.white)
    }
}
