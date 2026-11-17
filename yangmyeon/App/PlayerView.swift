import SwiftUI
import AVKit
import MatchCore

/// 경기 다시 보기. 두 코트 영상을 한 화면으로 합쳐(또는 나란히) 돌리고, 포인트를 누르면 그 랠리로 간다.
///
/// 두 영상은 한 타임라인(AVComposition)에 같이 올라가 프레임 단위로 붙어 움직인다. 프레임마다
/// `StitchCompositor` 가 합본 파일과 똑같은 방식으로 그린다 — 화면에서 본 그대로 "한 영상으로" 나간다.
/// 합치기: 두 카메라 크기를 맞추고, 겹친 띠는 위 영상만 보이게 포갠다(같은 사람이 두 번 안 나온다).
struct PlayerView: View {
    let r: Recording
    @State private var player: AVPlayer?
    @State private var src: Stitch.Sources?
    @State private var prefs = StitchPrefs(merge: false)
    @State private var playing = false
    @State private var time: TimeInterval = 0
    @State private var duration: TimeInterval = 0
    @State private var observer: Any?
    @State private var selected: UUID?
    /// 자동 맞춤 중. 그동안은 나란히 보여 준다.
    @State private var aligning = false
    @State private var note: String?
    @State private var tuning = false
    @State private var applyTask: Task<Void, Never>?
    @State private var showStitch = false
    @State private var merged: URL?
    @Environment(\.dismiss) private var dismiss

    /// 겹쳐 맞출 수 있는 녹화인가: 두 영상이 세로(힌지 세움, 코트 옆 V자). 가로(텐트)는 겹침이 위쪽이라 나란히만.
    private var canMerge: Bool { guard let s = src else { return false }; return s.a.height > s.a.width }
    private var merging: Bool { prefs.merge && canMerge && prefs.align != nil }
    /// 지금 화면에 쓰는 맞춤 값.
    private var shown: StitchAlign? {
        guard let s = src else { return nil }
        if merging, let a = prefs.align { return a }
        return .sideBySide(a: s.a, b: s.b)
    }
    /// 화면 비율(가로/세로).
    private var aspect: CGFloat {
        guard let s = src, let a = shown else { return 9.0 / 16.0 }
        let c = s.layout(a).canvas
        return c.height > 0 ? c.width / c.height : 1
    }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            HStack(spacing: 0) {
                VStack(spacing: 10) {
                    screen.layoutPriority(1)
                    controls
                }
                .padding(16)

                // 맞춤을 여는 동안은 포인트 목록 자리에 조절판을 둔다 — 영상 높이를 뺏지 않게.
                Group {
                    if tuning && merging { tunePanel } else { pointList }
                }
                .frame(width: 250)
                .background(Theme.card)
            }
        }
        .navigationTitle(r.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.bg, for: .navigationBar)
        .toolbar {
            if r.isDual && src != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showStitch = true } label: {
                        Label(merged == nil ? "한 영상으로" : "다시 합치기", systemImage: "film")
                            .labelStyle(.titleAndIcon)
                    }
                    .disabled(aligning)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(items: (merged.map { [$0] } ?? r.videos) + [r.folder.appendingPathComponent("포인트기록.txt")]) {
                    Image(systemName: "square.and.arrow.up")
                }
            }
        }
        .sheet(isPresented: $showStitch) {
            if let a = shown { StitchSheet(r: r, align: a, merge: merging) { merged = $0 } }
        }
        .onAppear(perform: setup)
        .onDisappear { teardown() }
    }

    private var screen: some View {
        ZStack {
            Color.black
            ZStack(alignment: .top) {
                if let player { PlayerLayerView(player: player) }
                if r.isDual {
                    HStack {
                        badge(0)
                        Spacer()
                        badge(1)
                    }
                    .padding(8)
                }
            }
            .aspectRatio(aspect, contentMode: .fit)
            if aligning {
                VStack(spacing: 10) {
                    ProgressView().tint(Theme.ball)
                    Text("두 카메라 크기·위치 맞추는 중…").font(.system(size: 13, weight: .semibold))
                }
                .padding(16)
                .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                .foregroundStyle(.white)
            }
        }
        .overlay(alignment: .bottom) {
            if let note {
                Text(note)
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(.black.opacity(0.75), in: Capsule())
                    .foregroundStyle(Theme.ball)
                    .padding(10)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func badge(_ i: Int) -> some View {
        let onTop = merging && (prefs.align?.top ?? 0) == i
        return Text((i == 0 ? "A" : "B") + (onTop ? " 위" : ""))
            .font(.system(size: 12, weight: .heavy, design: .rounded))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(.black.opacity(0.6), in: Capsule())
            .foregroundStyle(Theme.side(i))
    }

    /// 재생 바는 한 줄을 다 쓴다. 버튼과 보기 방식은 그 아래 줄.
    private var controls: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Text(Fmt.clock(time)).font(.system(size: 13, design: .monospaced)).frame(width: 52, alignment: .trailing)
                Slider(value: Binding(get: { time }, set: { seek($0) }), in: 0...max(1, duration))
                    .tint(Theme.ball)
                Text(Fmt.clock(duration)).font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.dim).frame(width: 52, alignment: .leading)
            }
            HStack(spacing: 12) {
                Button { seek(time - 10) } label: { Image(systemName: "gobackward.10") }
                Button { toggle() } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: 22))
                        .frame(width: 44, height: 44).background(Theme.ball, in: Circle()).foregroundStyle(.black)
                }
                Button { seek(time + 10) } label: { Image(systemName: "goforward.10") }
                Spacer(minLength: 8)
                if canMerge {
                    Picker("보기", selection: Binding(get: { prefs.merge }, set: { setMerge($0) })) {
                        Text("나란히").tag(false)
                        Text("합치기").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 120)
                    .disabled(aligning)
                    if merging {
                        pill("맞춤", icon: "slider.horizontal.3", on: tuning) { tuning.toggle() }
                    }
                }
            }
            .font(.system(size: 18, weight: .semibold))
        }
        .foregroundStyle(.white)
    }

    private func pill(_ text: String, icon: String, on: Bool, strong: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(text, systemImage: icon)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(on ? (strong ? Theme.ball : Theme.sky.opacity(0.3)) : Theme.card2, in: Capsule())
                .foregroundStyle(on && strong ? .black : Theme.text)
        }
        .buttonStyle(.plain)
    }

    // MARK: 맞춤 — 자동 값을 손으로 다듬는다

    private var tunePanel: some View {
        let a = prefs.align ?? StitchAlign(scale: 1, x: 1, y: 0)
        let sa = src?.a ?? CGSize(width: 9, height: 16), sb = src?.b ?? sa
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                SectionTitle(text: "맞춤")
                Spacer()
                Button { tuning = false } label: { Image(systemName: "xmark").font(.system(size: 14, weight: .bold)) }
                    .buttonStyle(.plain).foregroundStyle(Theme.dim)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider().background(Theme.line)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 8) {
                        Text("위에 올릴 화면").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                            .fixedSize()
                        Picker("위", selection: Binding(get: { a.top }, set: { v in edit { $0.top = v; $0.seam = 0 } })) {
                            Text("A").tag(0)
                            Text("B").tag(1)
                        }
                        .pickerStyle(.segmented)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        pill("이 장면으로 자동 맞춤", icon: "wand.and.stars", on: false) { autoAlign(at: time) }
                        if prefs.auto != nil && prefs.auto != prefs.align {
                            pill("처음 값", icon: "arrow.uturn.backward", on: false) {
                                prefs.align = prefs.auto; prefs.save(r.folder); applyLayout()
                            }
                        }
                    }
                    tuneRow("크기", value: Binding(get: { a.scale }, set: { v in edit { $0 = $0.withScale(v, a: sa) } }),
                            range: 0.5...2.5, text: String(format: "B ×%.2f", a.scale))
                    tuneRow("좌우", value: Binding(get: { a.x }, set: { v in edit { $0.x = v } }),
                            range: 0.2...1.05, text: String(format: "%.1f%%", a.x * 100))
                    tuneRow("위아래", value: Binding(get: { a.y - a.centeredY(a: sa, b: sb) },
                                                  set: { v in edit { $0.y = $0.centeredY(a: sa, b: sb) + v } }),
                            range: -0.15...0.15, text: String(format: "%+.1f%%", (a.y - a.centeredY(a: sa, b: sb)) * 100))
                    tuneRow("경계", value: Binding(get: { a.seam }, set: { v in edit { $0.seam = v } }),
                            range: 0...0.4, text: "\(Int((a.seam * 100).rounded()))%")
                    Text("""
                    겹친 곳은 위 영상만 보인다. 이음매에서
                    · 같은 사람·물건이 크기가 다르면 → 크기
                    · 옆으로 밀려 있으면 → 좌우
                    · 선이 위아래로 어긋나면 → 위아래
                    · 이음매를 네트 쪽으로 옮기려면 → 경계
                    """)
                    .font(.system(size: 11)).foregroundStyle(Theme.dim)
                }
                .padding(16)
            }
        }
        .foregroundStyle(.white)
    }

    private func tuneRow(_ name: String, value: Binding<Double>, range: ClosedRange<Double>, text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(name).font(.system(size: 13, weight: .semibold))
                Spacer()
                Text(text).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.sky)
            }
            Slider(value: value, in: range) { editing in if !editing { prefs.save(r.folder) } }
                .tint(Theme.sky)
        }
    }

    /// 맞춤 값을 고치고 화면에 반영한다. 손으로 바꾼 값은 일치도가 없다.
    private func edit(_ f: (inout StitchAlign) -> Void) {
        guard var a = prefs.align else { return }
        f(&a)
        a.score = nil
        prefs.align = a
        scheduleApply()
    }

    private func setMerge(_ on: Bool) {
        prefs.merge = on
        if !on { tuning = false }
        prefs.save(r.folder)
        applyLayout()
        if on && prefs.align == nil { autoAlign(at: nil) }
    }

    private func autoAlign(at t: Double?) {
        aligning = true
        pause()
        Task {
            let res = await StitchAligner.estimate(videos: r.videos, at: t, scaleHint: StitchPrefs.cameraScale)
            aligning = false
            if let res {
                prefs.align = res.align
                prefs.auto = res.align
                prefs.merge = true
                prefs.save(r.folder)
                if res.trusted { StitchPrefs.cameraScale = res.align.scale }
                show(res.trusted ? "맞췄다 · B ×\(String(format: "%.2f", res.align.scale))" : "확실하지 않다 — 어긋나 보이면 아래 조절로 다듬어 달라")
            } else {
                show("이 장면으론 못 맞췄다 — 사람·선이 잘 보이는 장면에서 다시 해 달라")
            }
            applyLayout()
        }
    }

    private func show(_ text: String) {
        note = text
        Task {
            try? await Task.sleep(for: .seconds(6))
            if note == text { note = nil }
        }
    }

    private var pointList: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                SectionTitle(text: "포인트")
                Spacer()
                Text("\(r.log?.entries.count ?? 0)개").font(.system(size: 12)).foregroundStyle(Theme.dim)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider().background(Theme.line)
            if let log = r.log, !log.entries.isEmpty {
                ScrollViewReader { proxy in
                    List {
                        ForEach(log.entries) { e in
                            Button { selected = e.id; seek(max(0, e.t - 3)); play() } label: {
                                HStack(spacing: 10) {
                                    Text(e.clock)
                                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(e.hasVideo ? Theme.dim : Theme.dim.opacity(0.5))
                                        .frame(width: 58, alignment: .leading)
                                    Text(e.by.tag)
                                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                                        .foregroundStyle(Theme.side(e.by.rawValue)).frame(width: 16)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(e.score).font(.system(size: 13)).foregroundStyle(.white)
                                        if let n = e.note { Text(n).font(.system(size: 11)).foregroundStyle(Theme.ball) }
                                    }
                                    Spacer()
                                }
                                .padding(.vertical, 2)
                            }
                            .listRowBackground(selected == e.id ? Theme.card2 : Color.clear)
                            .disabled(!e.hasVideo)
                            .id(e.id)
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .onChange(of: selected) { _, id in if let id { withAnimation { proxy.scrollTo(id, anchor: .center) } } }
                }
            } else {
                Text("이 경기엔 포인트 기록이 없다").font(.system(size: 13)).foregroundStyle(Theme.dim).padding(16)
                Spacer()
            }
            if r.log?.interrupted == true {
                Text("※ 녹화 중 끊김이 있었다. 타임코드가 어긋날 수 있다.")
                    .font(.system(size: 11)).foregroundStyle(.orange).padding(12)
            }
        }
    }

    // MARK: 재생 — 두 영상이 한 타임라인

    private func setup() {
        merged = r.merged
        #if targetEnvironment(simulator) || DEBUG
        if ProcessInfo.processInfo.arguments.contains("-demo-tune") { tuning = true }
        #endif
        guard r.isDual else {
            if let v = r.videos.first { attach(AVPlayerItem(url: v)) }
            return
        }
        Task {
            guard let s = try? await Stitch.Sources.load(r.videos) else {
                if let v = r.videos.first { attach(AVPlayerItem(url: v)) }
                return
            }
            src = s
            duration = CMTimeGetSeconds(s.duration)
            // 맞춤 값이 아직 없으면 자동으로 찾는다. 몇 초 걸리니 그동안 나란히 먼저 보여 준다.
            let saved = StitchPrefs.load(r.folder)
            if let saved { prefs = saved }
            let item = AVPlayerItem(asset: s.comp)
            item.videoComposition = s.videoComposition(align: shown ?? .sideBySide(a: s.a, b: s.b), maxSide: 1920)
            attach(item)
            if saved?.align == nil {
                aligning = canMerge
                let t0 = Date()
                let (p, n) = await StitchPrefs.resolve(folder: r.folder, videos: r.videos)
                print(String(format: "[검증] 자동 맞춤 %.1f초 scale=%.3f note=%@", Date().timeIntervalSince(t0), p.align?.scale ?? 0, n ?? "-"))
                aligning = false
                prefs = p
                if let n { show(n) }
                applyLayout()
            }
        }
    }

    private func attach(_ item: AVPlayerItem) {
        let p = AVPlayer(playerItem: item)
        p.automaticallyWaitsToMinimizeStalling = false
        player = p
        if duration == 0 {
            Task { if let d = try? await item.asset.load(.duration) { duration = CMTimeGetSeconds(d) } }
        }
        observer = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { t in
            Task { @MainActor in
                time = CMTimeGetSeconds(t)
                if duration > 0, time >= duration - 0.05 { playing = false }
            }
        }
    }

    /// 맞춤 값을 화면에 반영. 멈춰 있으면 같은 자리로 다시 찾아가 새로 그리게 한다.
    private func applyLayout() {
        guard let s = src, let a = shown, let p = player, let item = p.currentItem else { return }
        item.videoComposition = s.videoComposition(align: a, maxSide: 1920)
        if !playing { p.seek(to: p.currentTime(), toleranceBefore: .zero, toleranceAfter: .zero) }
    }

    /// 슬라이더를 끄는 동안 너무 자주 다시 그리지 않게 묶는다.
    private func scheduleApply() {
        applyTask?.cancel()
        applyTask = Task {
            try? await Task.sleep(for: .milliseconds(90))
            if !Task.isCancelled { applyLayout() }
        }
    }

    private func teardown() {
        applyTask?.cancel()
        player?.pause()
        if let o = observer { player?.removeTimeObserver(o) }
        observer = nil; player = nil
    }
    private func toggle() { playing ? pause() : play() }
    private func play() { player?.play(); playing = true }
    private func pause() { player?.pause(); playing = false }
    private func seek(_ t: TimeInterval) {
        let c = CMTime(seconds: max(0, min(t, duration)), preferredTimescale: 600)
        player?.seek(to: c, toleranceBefore: .zero, toleranceAfter: .zero)
        time = CMTimeGetSeconds(c)
    }
}


/// AVPlayerLayer 를 그대로 얹는다. 비율은 지킨다(.resizeAspect).
/// SwiftUI 의 VideoPlayer 는 안쪽 여백·덧그림을 제어할 수 없다.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    func makeUIView(context: Context) -> Host { let v = Host(); v.playerLayer.player = player; return v }
    func updateUIView(_ v: Host, context: Context) { if v.playerLayer.player !== player { v.playerLayer.player = player } }
    final class Host: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
        override init(frame: CGRect) { super.init(frame: frame); playerLayer.videoGravity = .resizeAspect; backgroundColor = .black }
        required init?(coder: NSCoder) { fatalError() }
    }
}
