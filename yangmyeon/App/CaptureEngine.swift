import AVFoundation
import Combine
import UIKit

/// 폴더블을 V 자로 반쯤 펼쳐 코트 옆에 세우고, 뒷면 카메라와 앞면(바깥 화면 쪽) 카메라로
/// 코트 양쪽을 **동시에** 찍는다. 각 카메라가 코트 반쪽을 맡고 파일도 둘이다(코트A.mov · 코트B.mov).
///
/// 멀티캠이 안 되는 기기에서는 카메라 하나로 코트 전체를 담는 단일 모드로 내려간다
/// (코트 옆 9 m, 울트라와이드). 이 경우 파일은 하나(코트.mov)다.
///
/// 코트에 두고 두 시간을 돌리는 앱이라 중단을 전제로 만들었다.
/// 전화·제어센터·다른 앱·과열은 반드시 한 번은 온다. 조용히 끊기면 경기가 날아가므로
/// 끊긴 사실을 화면에 띄우고 파일은 안전하게 닫는다.
@MainActor
final class CaptureEngine: NSObject, ObservableObject {

    enum Mode: String { case dual, single }

    /// 폰을 어디에 어떻게 세우나. 기본은 네트 가운데.
    enum Mount: String, CaseIterable {
        /// 네트 가운데, 힌지를 위로 한 텐트(∧). 뒷면 카메라가 한 코트, 앞면(바깥 화면 쪽)이 반대 코트.
        /// 두 반쪽이 서로 반대로 누워 있어 앞면 영상은 뒷면과 180° 다르게 돌린다.
        case netTent
        /// 코트 옆(네트 기둥~펜스), 힌지를 세운 V 자. 두 반쪽 다 세로.
        case sideV

        var label: String { self == .netTent ? "네트 가운데 (텐트)" : "코트 옆 (V자)" }
        /// 힌지가 쓸 만한 범위.
        /// 네트 텐트: 세로 화각 85.4° 라 카메라 축이 수직에서 30° 이하로 기울어야(힌지 120° 이상)
        /// 베이스라인 선수의 머리와 서브 토스가 들어온다. 110° 면 베이스라인 위 2.6 m 까지만 — 아슬아슬.
        var hingeRange: ClosedRange<Int> { self == .netTent ? 120...150 : 80...130 }
    }

    enum State: Equatable {
        case idle
        case unsupported(String)
        case ready(lens: String, resolution: String)
        case recording(lens: String, resolution: String)
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var mode: Mode = .dual
    @Published private(set) var log: [String] = []
    /// 녹화 시작 시각. 포인트 로그의 타임코드 기준점이다.
    @Published private(set) var recordingStartedAt: Date?
    @Published private(set) var thermal: ProcessInfo.ThermalState = .nominal
    /// 지금 세션이 끊겨 있으면 그 이유. 화면에 그대로 띄운다.
    @Published private(set) var interruption: String?
    /// 이번 녹화에서 실제로 끊겼던 적이 있나. 끝나고 알려줘야 한다.
    @Published private(set) var hadInterruption = false
    @Published private(set) var activeWidth: Int32 = 3840
    /// 고른 렌즈(단일 모드) 또는 뒷면 렌즈(듀얼 모드). 설치 안내를 이 값으로 계산한다.
    @Published private(set) var lens: CameraPick.Lens?
    /// 사용자가 더하는 회전(뒤집기·90° 돌리기). 바로 서는 각도는 iOS 의 회전 좌표가 중력으로 계산하고,
    /// 이 값은 그 위에 더해진다. 보통 0 이다.
    @Published var angle: Int = 0 { didSet { UserDefaults.standard.set(angle, forKey: angleKey); applyRotation() } }
    /// 거치 방식. 힌지 권장 범위와 설치 안내가 달라진다.
    @Published var mount: Mount = Mount(rawValue: UserDefaults.standard.string(forKey: "mount") ?? "") ?? .netTent {
        didSet { UserDefaults.standard.set(mount.rawValue, forKey: "mount"); say("거치: \(mount.label)") }
    }
    /// 듀얼 모드에서 왼쪽(A) 을 맡는 카메라. 책처럼 펼쳐 안쪽 화면을 볼 때 뒷면 카메라가 오른쪽 반에
    /// 있어서 기본은 '왼쪽 = 앞면'. 거치 방향에 따라 ⇄ 로 바꾼다.
    @Published var leftIsRear: Bool = UserDefaults.standard.object(forKey: "leftIsRear") as? Bool ?? false {
        didSet { UserDefaults.standard.set(leftIsRear, forKey: "leftIsRear") }
    }
    /// iOS 가 중력으로 계산한 카메라별 회전. 프리뷰/녹화가 조금 다를 수 있어 둘 다 둔다.
    private var autoRear: (preview: CGFloat, capture: CGFloat) = (0, 0)
    private var autoFront: (preview: CGFloat, capture: CGFloat) = (0, 0)
    /// 힌지. 듀얼 모드에서 80~130° 밖이면 경고한다.
    @Published var hingeDegrees: Int?
    /// 활성 포맷의 장축 화각(°). 듀얼 설정이 끝나면 채워진다.
    @Published private(set) var fovRear: Double = 0
    @Published private(set) var fovFront: Double = 0
    /// 녹화 시작 순간의 힌지. 기록에 남겨 다시 보기에서 겹침 기본값으로 쓴다.
    private(set) var recordingHinge: Int?
    /// 설정 "겹치는 띠 자르기".
    var seamOn: Bool { UserDefaults.standard.object(forKey: "seamOn") as? Bool ?? true }
    @Published var hingeStatus: String = ""

    private var angleKey: String { mode == .dual ? "angle.dual" : "angle.single" }
    private var defaultAngle: Int { 0 }

    /// 세션과 출력. 조작은 전부 `box.queue` 에서 한다 — 메인에서 하면 설정 중 화면이 멈춘다.
    private let box = SessionBox()
    var session: AVCaptureSession { box.session }
    /// 이번 녹화가 쓰는 폴더. 엔진이 들고 있어야 기록을 확실히 같은 곳에 둔다.
    private(set) var recordingFolder: URL?
    /// 파일이 닫히면 폴더를 넘긴다. 포인트 기록을 여기에 저장한다.
    var onRecordingFinished: ((URL, Bool) -> Void)?
    /// 단일 모드 프리뷰 레이어의 연결. 뒤집기를 녹화 파일과 프리뷰에 같이 적용해야
    /// 보이는 것과 저장되는 것이 같다.
    private weak var previewConnection: AVCaptureConnection?
    /// 아직 닫히지 않은 출력 수. 듀얼은 2 에서 시작한다. 0 이 되면 폴더를 넘긴다.
    private var pendingOutputs = 0

    private var observers: [AnyCancellable] = []

    func say(_ s: String) {
        log.append(s)
        #if DEBUG
        print("[촬영] \(s)")
        #endif
        Self.persist(log)
    }

    /// 바깥에서 넣는 기록(힌지 상태 등). 같은 로그에 쌓인다.
    func note(_ s: String) { say(s) }

    /// 로그를 Documents/진단.txt 에 쓴다. 파일 공유가 켜져 있어 맥에서 케이블로 꺼내 읽을 수 있다 —
    /// 화면을 읽어 옮길 필요가 없다.
    private static func persist(_ lines: [String]) {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let text = lines.joined(separator: "\n") + "\n"
        try? text.data(using: .utf8)?.write(to: docs.appendingPathComponent("진단.txt"))
    }

    /// 시뮬레이터에는 카메라가 없다. 화면·점수판·시트만 확인하려고 가짜로 '준비됨' 을 만든다.
    /// 실기기 빌드에서는 이 코드가 아예 컴파일되지 않는다.
    #if targetEnvironment(simulator)
    let isSimulated = true
    #else
    let isSimulated = false
    #endif

    var isDual: Bool { mode == .dual }

    /// 듀얼 모드의 프리뷰 레이어. 상자가 만들어 들고 있고, 뷰는 그걸 얹기만 한다.
    func previewLayer(rear: Bool) -> AVCaptureVideoPreviewLayer? { rear ? box.rearPreview : box.frontPreview }

    // MARK: 설정

    func configure() async {
        let dev = UIDevice.current
        say("기기: \(dev.systemName) \(dev.systemVersion)")
        if isSimulated {
            say("시뮬레이터 — 카메라 없이 화면만 확인한다")
            mode = .dual
            angle = UserDefaults.standard.object(forKey: angleKey) as? Int ?? defaultAngle
            state = .ready(lens: "시뮬레이터", resolution: "카메라 없음")
            watchSystem()
            return
        }
        for line in CameraPick.inventory() { say("카메라: \(line)") }
        for line in Diagnostics.multiCam() { say("진단: \(line)") }

        if let pair = CameraPick.dualPair() {
            mode = .dual
            angle = UserDefaults.standard.object(forKey: angleKey) as? Int ?? defaultAngle
            say("거치: \(mount.label)")
            lens = pair.rear
            let rearID = pair.rear.device.uniqueID, frontID = pair.front.device.uniqueID
            let box = self.box
            let result: Result<SessionBox.Built, Error> = await withCheckedContinuation { cont in
                box.queue.async {
                    do { cont.resume(returning: .success(try box.buildDual(rearID: rearID, frontID: frontID))) }
                    catch { cont.resume(returning: .failure(error)) }
                }
            }
            switch result {
            case .success(let b):
                activeWidth = b.width
                fovRear = b.rearFOV; fovFront = b.frontFOV
                say(String(format: "화각 — 뒷면 %.0f° · 앞면 %.0f° (장축)", b.rearFOV, b.frontFOV))
                say("설정 완료 — 듀얼 · 뒷면 \(pair.rear.name) + 앞면 \(pair.front.name) · \(b.label)")
                state = .ready(lens: "양쪽 카메라", resolution: b.label)
                watchSystem(); watchRotation(); applyRotation()
                return
            case .failure(let e):
                say("듀얼 세션 실패: \(e.localizedDescription) — 단일 카메라로 간다")
            }
        } else {
            say("멀티캠 조합이 없다 — 단일 카메라로 간다")
        }

        // ── 단일 모드 ──
        mode = .single
        angle = UserDefaults.standard.object(forKey: angleKey) as? Int ?? defaultAngle
        guard let pick = CameraPick.best() else {
            state = .unsupported("뒷면 카메라를 찾을 수 없다"); return
        }
        lens = pick
        if !pick.isUltraWide {
            // 메인 렌즈로는 17 m 가 필요해서 일반 코트에서는 코트가 다 안 들어온다.
            say("울트라와이드가 없다 — \(pick.name) 로 간다. "
                + "코트 전체를 담으려면 \(String(format: "%.1f", pick.minDistance)) m 가 필요하다.")
        }
        // AVCaptureDevice 는 Sendable 이 아니라서 큐로 넘기지 않는다. 식별자만 넘긴다.
        let deviceID = pick.device.uniqueID
        let box = self.box
        let result: Result<SessionBox.Built, Error> = await withCheckedContinuation { cont in
            box.queue.async {
                do { cont.resume(returning: .success(try box.buildSingle(deviceID: deviceID))) }
                catch { cont.resume(returning: .failure(error)) }
            }
        }
        switch result {
        case .success(let built):
            activeWidth = built.width
            say("설정 완료 — \(pick.name) · \(built.label)")
            state = .ready(lens: pick.name, resolution: built.label)
            watchSystem(); watchRotation()
            applyRotation()
        case .failure(let e):
            state = .failed(e.localizedDescription)
        }
    }

    /// 권한을 못 받았을 때. 스피너를 계속 돌리면 사용자는 왜 안 되는지 모른다.
    func markPermissionDenied() {
        state = .unsupported("카메라 권한이 거부됐다. 설정 → 양면 → 카메라를 켜고 앱을 다시 열 것.")
    }

    // MARK: 힌지

    func updateHinge(status: String, degrees: Int?) {
        if hingeStatus != status || hingeDegrees != degrees {
            hingeStatus = status; hingeDegrees = degrees
            say("힌지: \(status)" + (degrees.map { " · \($0)°" } ?? ""))
        }
    }

    /// 힌지에 수직인 축(폰의 짧은 축)의 화각. 겹침은 이 축에서 생긴다.
    func fovAcross(rear: Bool) -> Double { Seam.acrossFOV(longAxis: rear ? fovRear : fovFront) }

    /// 힌지를 세워(V자) 프레임이 세로로 나오는가. 설정의 거치 방식이 아니라 실제 회전으로 판단한다 —
    /// 2026-11-03 녹화는 설정이 '텐트' 인 채로 V자로 세워 찍혔다.
    var framesArePortrait: Bool { (((Int(autoRear.preview) + angle) % 180) + 180) % 180 == 90 }

    /// 지금 각도에서 이 카메라 프레임의 안쪽 가장자리를 잘라낼 비율. 프레임이 세로(V자)일 때만.
    /// 텐트(가로)는 겹침이 위(하늘) 쪽에 생겨 좌우로 자를 게 없다.
    func seamCrop(rear: Bool) -> Double {
        guard isDual, seamOn, framesArePortrait else { return 0 }
        let hinge = Double(hingeDegrees ?? Int(Seam.defaultHinge(mount: "sideV")))
        let fov = fovAcross(rear: rear)
        return Seam.crop(hinge: hinge, fovAcross: fov > 1 ? fov : Seam.measuredAcross)
    }

    /// 듀얼 모드에서 힌지가 쓸 만한 범위 밖인가. 범위는 거치 방식마다 다르다(`Mount.hingeRange`).
    var hingeWarning: String? {
        guard isDual, let d = hingeDegrees else { return nil }
        let r = mount.hingeRange
        if d < r.lowerBound { return "힌지 \(d)° — 너무 접혔다. \(r.lowerBound)~\(r.upperBound)° 로 펼칠 것" }
        if d > r.upperBound { return "힌지 \(d)° — 너무 펼쳤다. \(r.lowerBound)~\(r.upperBound)° 로 접을 것" }
        return nil
    }

    // MARK: 회전

    func register(preview conn: AVCaptureConnection) {
        guard previewConnection !== conn else { return }
        previewConnection = conn
        apply(angle: angle, to: conn)
    }

    /// iOS 의 회전 좌표를 구독한다. 폰을 어떻게 세우든 카메라마다 바로 서는 각도를 준다.
    private func watchRotation() {
        box.onRotation = { [weak self] rear, preview, capture in
            Task { @MainActor in
                guard let self else { return }
                if rear { self.autoRear = (preview, capture) } else { self.autoFront = (preview, capture) }
                self.say("자동 회전 \(rear ? "뒷면" : "앞면"): \(Int(preview))° (중력 기준 \(Int(capture))°)")
                self.applyRotation()
            }
        }
        box.startRotationCoordinators()
    }

    /// 녹화 파일은 **프리뷰와 같은 각도**로 돌린다. 사용자가 보는 그대로 찍혀야 한다.
    /// (iOS 가 주는 '녹화용' 각도는 중력 기준이라 폰을 눕히면 0° 가 되어 화면과 90° 어긋난다 —
    /// 2026-11-02 실기기에서 그렇게 찍혔다.)
    func applyRotation() {
        let r = Int(autoRear.preview) + angle, f = Int(autoFront.preview) + angle
        if let c = box.rearOutput.connection(with: .video) { apply(angle: r, to: c) }
        if let c = box.rearPreview?.connection { apply(angle: r, to: c) }
        if let c = box.frontOutput.connection(with: .video) { apply(angle: f, to: c) }
        if let c = box.frontPreview?.connection { apply(angle: f, to: c) }
        if let c = previewConnection { apply(angle: r, to: c) }
    }

    private func apply(angle: Int, to conn: AVCaptureConnection) {
        let a = CGFloat(((angle % 360) + 360) % 360)
        if conn.isVideoRotationAngleSupported(a), conn.videoRotationAngle != a {
            conn.videoRotationAngle = a
        }
    }

    /// 180° 뒤집는다. 거치가 거꾸로 됐을 때.
    func flip() { angle = (angle + 180) % 360 }
    /// 90° 씩 돌린다. 세워 둔 폰과 눕혀 둔 폰이 다르다.
    func rotate() { angle = (angle + 90) % 360 }

    // MARK: 구동

    func start() { box.startRunning() }
    func stop() { box.stopRunning() }

    // MARK: 녹화

    func preflight(expectedMinutes: Int) -> [Preflight.Item] {
        Preflight.check(width: activeWidth, streams: isDual ? 2 : 1, needMinutes: expectedMinutes)
    }

    /// 이번 녹화의 파일 이름. 포인트 기록에 같이 적는다.
    var videoFileNames: [String] { isDual ? ["코트A.mov", "코트B.mov"] : ["코트.mov"] }

    func startRecording(matchName: String) {
        guard case .ready(let l, let r) = state else { return }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let stamp = Self.stamp.string(from: Date())
        let safe = matchName.isEmpty ? "경기" : matchName
        let folder = docs.appendingPathComponent("\(stamp)_\(safe)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            say("폴더를 만들 수 없다: \(error.localizedDescription)"); return
        }

        hadInterruption = false
        recordingHinge = hingeDegrees
        recordingFolder = folder
        recordingStartedAt = Date()
        if isSimulated {
            pendingOutputs = 0
        } else if isDual {
            // A 는 왼쪽. 왼쪽을 맡은 카메라의 파일이 코트A 다.
            let rearFile = leftIsRear ? "코트A.mov" : "코트B.mov"
            let frontFile = leftIsRear ? "코트B.mov" : "코트A.mov"
            pendingOutputs = 2
            box.rearOutput.startRecording(to: folder.appendingPathComponent(rearFile), recordingDelegate: self)
            box.frontOutput.startRecording(to: folder.appendingPathComponent(frontFile), recordingDelegate: self)
        } else {
            pendingOutputs = 1
            box.rearOutput.startRecording(to: folder.appendingPathComponent("코트.mov"), recordingDelegate: self)
        }
        state = .recording(lens: l, resolution: r)
        say("녹화 시작 — \(folder.lastPathComponent) · \(videoFileNames.joined(separator: ", "))")
    }

    func stopRecording() {
        if isSimulated, case .recording(let l, let r) = state {
            // 시뮬레이터: 파일은 없지만 '닫힘' 흐름은 똑같이 태운다 — 포인트 기록 저장까지.
            say("시뮬레이터 — 녹화 파일 없이 마무리")
            recordingStartedAt = nil
            if let folder = recordingFolder { onRecordingFinished?(folder, hadInterruption) }
            state = .ready(lens: l, resolution: r)
            return
        }
        for o in [box.rearOutput, box.frontOutput] where o.isRecording { o.stopRecording() }
    }

    var isRecording: Bool { if case .recording = state { true } else { false } }

    var elapsed: TimeInterval {
        guard let t = recordingStartedAt else { return 0 }
        return Date().timeIntervalSince(t)
    }

    // MARK: 시스템 — 발열·중단·백그라운드

    private func watchSystem() {
        guard observers.isEmpty else { return }
        let c = NotificationCenter.default

        thermal = ProcessInfo.processInfo.thermalState
        c.publisher(for: ProcessInfo.thermalStateDidChangeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.handleThermal() }
            .store(in: &observers)

        c.publisher(for: AVCaptureSession.wasInterruptedNotification, object: session)
            .receive(on: RunLoop.main)
            .sink { [weak self] n in self?.handleInterrupted(n) }
            .store(in: &observers)

        c.publisher(for: AVCaptureSession.interruptionEndedNotification, object: session)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.interruption = nil
                self?.say("중단이 끝났다 — 다시 돌아간다")
            }
            .store(in: &observers)

        c.publisher(for: AVCaptureSession.runtimeErrorNotification, object: session)
            .receive(on: RunLoop.main)
            .sink { [weak self] n in self?.handleRuntimeError(n) }
            .store(in: &observers)

        // 백그라운드로 가면 iOS 가 카메라를 뺏는다. 파일이 깨지기 전에 우리가 닫는다.
        c.publisher(for: UIApplication.didEnterBackgroundNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                guard let self, self.isRecording else { return }
                self.hadInterruption = true
                self.say("앱이 백그라운드로 갔다 — 녹화를 안전하게 마무리한다")
                self.stopRecording()
            }
            .store(in: &observers)
    }

    private func handleThermal() {
        let t = ProcessInfo.processInfo.thermalState
        thermal = t
        switch t {
        case .serious:
            say("기기가 뜨겁다. 녹화는 이어가지만 화질이 떨어질 수 있다.")
        case .critical:
            // 여기서 멈추지 않으면 시스템이 세션을 죽인다. 파일을 잃는 쪽이 더 나쁘다.
            say("기기가 너무 뜨겁다 — 녹화를 안전하게 마무리한다.")
            if isRecording { hadInterruption = true }
            stopRecording()
        default: break
        }
    }

    private func handleInterrupted(_ n: Notification) {
        let raw = n.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int
        let reason = raw.flatMap(AVCaptureSession.InterruptionReason.init(rawValue:))
        let text: String = switch reason {
        case .videoDeviceNotAvailableInBackground: "앱이 가려져 카메라가 멈췄다"
        case .audioDeviceInUseByAnotherClient:     "다른 앱이 마이크를 쓰고 있다"
        case .videoDeviceInUseByAnotherClient:     "다른 앱이 카메라를 쓰고 있다"
        case .videoDeviceNotAvailableWithMultipleForegroundApps: "화면 분할 중에는 카메라를 쓸 수 없다"
        case .videoDeviceNotAvailableDueToSystemPressure: "기기 과열·전력 부담으로 카메라가 멈췄다"
        default: "알 수 없는 이유로 카메라가 멈췄다"
        }
        interruption = text
        say("중단: \(text)")
        if isRecording { hadInterruption = true; stopRecording() }
    }

    private func handleRuntimeError(_ n: Notification) {
        let err = n.userInfo?[AVCaptureSessionErrorKey] as? NSError
        say("세션 오류: \(err?.localizedDescription ?? "알 수 없음")")
        if isRecording { hadInterruption = true; stopRecording() }
        if err?.code == AVError.mediaServicesWereReset.rawValue {
            say("미디어 서비스가 재설정됐다 — 세션을 다시 시작한다")
            box.startRunning()
        }
    }

    private static let stamp: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyMMdd_HHmm"; return f
    }()
}

// MARK: - 세션 상자

/// 세션·출력을 한 큐에서만 만지기 위한 상자.
///
/// `AVCaptureSession` 은 Sendable 이 아니다. 메인 액터에서 큐로 넘기면 Swift 6 가 막는다.
/// 그래서 세션은 이 상자 안에 두고, 상자만 큐를 넘나든다. 세션 설정·시작·정지는
/// 전부 `queue` 에서 하므로 `@unchecked Sendable` 이 맞다. 다른 스레드에서 세션을
/// 직접 만지는 코드를 넣으면 이 전제가 깨진다.
final class SessionBox: @unchecked Sendable {
    /// 멀티캠이 되는 기기에서는 멀티캠 세션을 쓴다. 단일 모드로 내려가도 이 세션을 그대로 쓴다
    /// (멀티캠 세션은 카메라 하나로도 돈다).
    let session: AVCaptureSession = AVCaptureMultiCamSession.isMultiCamSupported
        ? AVCaptureMultiCamSession() : AVCaptureSession()
    let rearOutput = AVCaptureMovieFileOutput()
    let frontOutput = AVCaptureMovieFileOutput()
    let queue = DispatchQueue(label: "court.session", qos: .userInitiated)
    /// 듀얼 모드 프리뷰. 세션 설정 때 큐에서 만들어 연결까지 끝낸다. 뷰는 얹기만 한다.
    private(set) var rearPreview: AVCaptureVideoPreviewLayer?
    private(set) var frontPreview: AVCaptureVideoPreviewLayer?
    /// 설정에 쓴 기기. 회전 좌표를 만들 때 필요하다.
    private var rearDevice: AVCaptureDevice?
    private var frontDevice: AVCaptureDevice?
    /// 카메라별 회전 좌표. 중력으로 '바로 서는' 각도를 계산해 준다. KVO 로 바뀔 때마다 알린다.
    private var coordinators: [AVCaptureDevice.RotationCoordinator] = []
    private var kvo: [NSKeyValueObservation] = []
    /// (뒷면인가, 프리뷰 각도, 녹화 각도). 메인 액터로 넘겨 쓴다.
    var onRotation: (@Sendable (Bool, CGFloat, CGFloat) -> Void)?

    func startRotationCoordinators() {
        kvo = []; coordinators = []
        for (dev, layer, rear) in [(rearDevice, rearPreview, true), (frontDevice, frontPreview, false)] {
            guard let dev else { continue }
            let c = AVCaptureDevice.RotationCoordinator(device: dev, previewLayer: layer)
            coordinators.append(c)
            let report: @Sendable (AVCaptureDevice.RotationCoordinator) -> Void = { [onRotation] c in
                onRotation?(rear, c.videoRotationAngleForHorizonLevelPreview, c.videoRotationAngleForHorizonLevelCapture)
            }
            kvo.append(c.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.initial]) { c, _ in report(c) })
            kvo.append(c.observe(\.videoRotationAngleForHorizonLevelCapture) { c, _ in report(c) })
        }
    }

    struct Built {
        let width: Int32; let label: String
        /// 각 카메라 활성 포맷의 장축 화각(°). 겹침 계산용. 단일 모드면 0.
        var rearFOV: Double = 0; var frontFOV: Double = 0
    }

    enum Err: LocalizedError {
        case deviceGone, cannotAdd(String), noPreset, noFormat(String), tooExpensive
        var errorDescription: String? {
            switch self {
            case .deviceGone:       return "고른 카메라를 다시 찾을 수 없다"
            case .cannotAdd(let w): return "\(w)을 세션에 추가할 수 없다"
            case .noPreset:         return "쓸 수 있는 해상도가 없다"
            case .noFormat(let w):  return "\(w)에 멀티캠용 포맷이 없다"
            case .tooExpensive:     return "두 카메라를 같이 돌리기엔 하드웨어 예산이 모자란다"
            }
        }
    }

    /// 해상도는 높은 쪽부터 본다.
    private let presets: [(AVCaptureSession.Preset, Int32, String)] = [
        (.hd4K3840x2160, 3840, "4K"),
        (.hd1920x1080,   1920, "1080p"),
        (.hd1280x720,    1280, "720p"),
    ]
    /// 설정의 '최대 해상도' 이하만 본다. 기본 4K.
    private var tiers: [(Int32, Int32, String)] {
        let cap = Int32(UserDefaults.standard.object(forKey: "maxWidth") as? Int ?? 3840)
        return [(3840, 2160, "4K"), (1920, 1080, "1080p"), (1280, 720, "720p")].filter { $0.0 <= cap }
    }

    private func reset() {
        session.inputs.forEach(session.removeInput)
        session.outputs.forEach(session.removeOutput)
        session.connections.forEach(session.removeConnection)
        rearPreview = nil; frontPreview = nil
        rearDevice = nil; frontDevice = nil
        kvo = []; coordinators = []
    }

    // MARK: 단일

    /// `queue` 에서만 부른다.
    func buildSingle(deviceID: String) throws -> Built {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let device = AVCaptureDevice(uniqueID: deviceID) else { throw Err.deviceGone }

        session.beginConfiguration()
        defer { session.commitConfiguration() }
        reset()

        let vIn = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(vIn) else { throw Err.cannotAdd("카메라") }
        session.addInput(vIn)
        rearDevice = device

        if let mic = AVCaptureDevice.default(for: .audio) {
            let aIn = try AVCaptureDeviceInput(device: mic)
            if session.canAddInput(aIn) { session.addInput(aIn) }
        }

        guard session.canAddOutput(rearOutput) else { throw Err.cannotAdd("녹화 출력") }
        session.addOutput(rearOutput)

        if session is AVCaptureMultiCamSession {
            // 멀티캠 세션은 프리셋을 안 받는다. 포맷을 직접 고른다.
            let (w, label) = try pickFormat(device, multiCam: true, name: "카메라")
            return Built(width: w, label: label)
        }
        for (preset, width, label) in presets where session.canSetSessionPreset(preset) {
            session.sessionPreset = preset
            return Built(width: width, label: label)
        }
        throw Err.noPreset
    }

    // MARK: 듀얼

    /// 뒷면 + 앞면을 한 세션에 올린다. 멀티캠은 자동 연결이 없어서 입력·출력·연결을 전부 손으로 잇는다.
    /// `queue` 에서만 부른다.
    func buildDual(rearID: String, frontID: String) throws -> Built {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let multi = session as? AVCaptureMultiCamSession else { throw Err.cannotAdd("멀티캠 세션") }
        guard let rear = AVCaptureDevice(uniqueID: rearID),
              let front = AVCaptureDevice(uniqueID: frontID) else { throw Err.deviceGone }

        multi.beginConfiguration()
        defer { multi.commitConfiguration() }
        reset()

        let rearIn = try AVCaptureDeviceInput(device: rear)
        let frontIn = try AVCaptureDeviceInput(device: front)
        guard multi.canAddInput(rearIn) else { throw Err.cannotAdd("뒷면 카메라") }
        multi.addInputWithNoConnections(rearIn)
        guard multi.canAddInput(frontIn) else { throw Err.cannotAdd("앞면 카메라") }
        multi.addInputWithNoConnections(frontIn)
        rearDevice = rear; frontDevice = front

        guard multi.canAddOutput(rearOutput) else { throw Err.cannotAdd("뒷면 녹화 출력") }
        multi.addOutputWithNoConnections(rearOutput)
        guard multi.canAddOutput(frontOutput) else { throw Err.cannotAdd("앞면 녹화 출력") }
        multi.addOutputWithNoConnections(frontOutput)

        guard let rearPort = rearIn.ports(for: .video, sourceDeviceType: rear.deviceType,
                                          sourceDevicePosition: rear.position).first,
              let frontPort = frontIn.ports(for: .video, sourceDeviceType: front.deviceType,
                                            sourceDevicePosition: front.position).first
        else { throw Err.cannotAdd("비디오 포트") }

        let rearConn = AVCaptureConnection(inputPorts: [rearPort], output: rearOutput)
        let frontConn = AVCaptureConnection(inputPorts: [frontPort], output: frontOutput)
        guard multi.canAddConnection(rearConn) else { throw Err.cannotAdd("뒷면 연결") }
        multi.addConnection(rearConn)
        guard multi.canAddConnection(frontConn) else { throw Err.cannotAdd("앞면 연결") }
        multi.addConnection(frontConn)
        // 앞면은 기본이 거울상이다. 저장 파일은 거울상이면 안 된다 — 코트 좌우가 뒤집힌다.
        frontConn.automaticallyAdjustsVideoMirroring = false
        frontConn.isVideoMirrored = false

        // 마이크 — 양쪽 파일에 다 넣는다. 두 번째가 안 붙으면 한쪽만 소리가 있다.
        if let mic = AVCaptureDevice.default(for: .audio) {
            let aIn = try AVCaptureDeviceInput(device: mic)
            if multi.canAddInput(aIn) {
                multi.addInputWithNoConnections(aIn)
                if let aPort = aIn.ports(for: .audio, sourceDeviceType: mic.deviceType,
                                         sourceDevicePosition: .unspecified).first {
                    for out in [rearOutput, frontOutput] {
                        let c = AVCaptureConnection(inputPorts: [aPort], output: out)
                        if multi.canAddConnection(c) { multi.addConnection(c) }
                    }
                }
            }
        }

        // 프리뷰 — 레이어마다 연결을 따로 잇는다.
        let rp = AVCaptureVideoPreviewLayer(sessionWithNoConnection: multi)
        let fp = AVCaptureVideoPreviewLayer(sessionWithNoConnection: multi)
        rp.videoGravity = .resizeAspect; fp.videoGravity = .resizeAspect
        let rpc = AVCaptureConnection(inputPort: rearPort, videoPreviewLayer: rp)
        let fpc = AVCaptureConnection(inputPort: frontPort, videoPreviewLayer: fp)
        if multi.canAddConnection(rpc) { multi.addConnection(rpc) }
        if multi.canAddConnection(fpc) { multi.addConnection(fpc) }
        fpc.automaticallyAdjustsVideoMirroring = false
        fpc.isVideoMirrored = false
        rearPreview = rp; frontPreview = fp

        // 포맷 — 높은 쪽부터, 하드웨어 예산(≤ 1.0) 안에 들어오는 첫 단계.
        for (w, h, label) in tiers {
            guard (try? setFormat(rear, w: w, h: h, multiCam: true)) != nil,
                  (try? setFormat(front, w: w, h: h, multiCam: true)) != nil else { continue }
            if multi.hardwareCost <= 1.0 { return Built(width: w, label: "\(label)×2", rearFOV: fov(rear), frontFOV: fov(front)) }
        }
        // 앞면만 한 단계 내려서 다시 — 뒷면 4K + 앞면 1080p 같은 조합.
        for (w, h, label) in tiers {
            guard (try? setFormat(rear, w: w, h: h, multiCam: true)) != nil else { continue }
            for (fw, fh, flabel) in tiers where fw < w {
                guard (try? setFormat(front, w: fw, h: fh, multiCam: true)) != nil else { continue }
                if multi.hardwareCost <= 1.0 { return Built(width: w, label: "\(label)+\(flabel)", rearFOV: fov(rear), frontFOV: fov(front)) }
            }
        }
        throw Err.tooExpensive
    }

    private func fov(_ d: AVCaptureDevice) -> Double { Double(d.activeFormat.videoFieldOfView) }

    /// 기기에서 (w×h, 30fps 이상, 16:9) 포맷을 찾아 건다.
    private func setFormat(_ device: AVCaptureDevice, w: Int32, h: Int32, multiCam: Bool) throws {
        let f = device.formats.first { f in
            let d = f.dimensions
            return d.width == w && d.height == h && f.maxFrameRate >= 30
                && (!multiCam || f.isMultiCamSupported)
                && CMFormatDescriptionGetMediaSubType(f.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        } ?? device.formats.first { f in
            let d = f.dimensions
            return d.width == w && d.height == h && f.maxFrameRate >= 30 && (!multiCam || f.isMultiCamSupported)
        }
        guard let f else { throw Err.noFormat(device.localizedName) }
        try device.lockForConfiguration()
        device.activeFormat = f
        device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
        device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
        device.unlockForConfiguration()
    }

    private func pickFormat(_ device: AVCaptureDevice, multiCam: Bool, name: String) throws -> (Int32, String) {
        for (w, h, label) in tiers {
            if (try? setFormat(device, w: w, h: h, multiCam: multiCam)) != nil { return (w, label) }
        }
        throw Err.noFormat(name)
    }

    /// 회전을 걸 비디오 연결 — 뒷면 쪽(녹화 출력 + 프리뷰).
    func rearConnections() -> [AVCaptureConnection] {
        var out: [AVCaptureConnection] = []
        if let c = rearOutput.connection(with: .video) { out.append(c) }
        if let c = rearPreview?.connection { out.append(c) }
        return out
    }
    /// 앞면 쪽.
    func frontConnections() -> [AVCaptureConnection] {
        var out: [AVCaptureConnection] = []
        if let c = frontOutput.connection(with: .video) { out.append(c) }
        if let c = frontPreview?.connection { out.append(c) }
        return out
    }

    /// startRunning 은 수백 ms 걸린다. 메인에서 돌리면 화면이 멈추므로 큐에서 한다.
    func startRunning() { queue.async { if !self.session.isRunning { self.session.startRunning() } } }
    func stopRunning()  { queue.async { if  self.session.isRunning { self.session.stopRunning()  } } }
}

extension CaptureEngine: AVCaptureFileOutputRecordingDelegate {
    nonisolated func fileOutput(_ output: AVCaptureFileOutput,
                               didFinishRecordingTo outputFileURL: URL,
                               from connections: [AVCaptureConnection],
                               error: Error?) {
        Task { @MainActor in
            if let error {
                let e = error as NSError
                // 디스크가 찼거나 중단으로 끊긴 경우에도 그 지점까지는 보통 살아 있다.
                let salvaged = (e.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool) ?? false
                say("녹화 오류 \(outputFileURL.lastPathComponent): \(e.localizedDescription)" + (salvaged ? " (그 지점까지는 저장됨)" : ""))
                hadInterruption = true
            } else {
                let mb = (try? FileManager.default.attributesOfItem(atPath: outputFileURL.path)[.size] as? Int64).map { Double($0) / 1_048_576 } ?? 0
                say("저장됨 \(outputFileURL.lastPathComponent) · \(String(format: "%.0f", mb)) MB")
            }
            pendingOutputs = max(0, pendingOutputs - 1)
            guard pendingOutputs == 0 else { return }   // 다른 쪽 파일이 아직 닫히는 중
            recordingStartedAt = nil
            if let folder = recordingFolder { onRecordingFinished?(folder, hadInterruption) }
            if case .recording(let l, let r) = state { state = .ready(lens: l, resolution: r) }
        }
    }
}
