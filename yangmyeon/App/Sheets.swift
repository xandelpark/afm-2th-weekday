import SwiftUI
import UIKit
import MatchCore

/// 설치 안내. 9 m 떨어진 곳에 걸어야 하니 숫자가 필요하다 —
/// 고른 렌즈의 실제 화각으로 계산해서 보여준다.
struct SetupSheet: View {
    @ObservedObject var engine: CaptureEngine
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            SetupContent(engine: engine)
                .navigationTitle("설치 안내")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("닫기") { dismiss() } }
        }
    }
}

/// 홈 → 설치 안내 로 들어왔을 때. 카메라를 안 켠 상태라 진단은 멀티캠 조합만 나온다.
struct GuideView: View {
    @EnvironmentObject private var s: Session
    var body: some View {
        SetupContent(engine: s.camera)
            .navigationTitle("설치 안내")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.bg, for: .navigationBar)
    }
}

struct SetupContent: View {
    @ObservedObject var engine: CaptureEngine
    @State private var hinge = "힌지: 읽는 중"
    private let multiCam = Diagnostics.multiCam()
    private var lens: CameraPick.Lens? { engine.lens }
    private var log: [String] { engine.log }

    var body: some View {
            List {
                if engine.isDual {
                    Section {
                        Picker("거치 방식", selection: $engine.mount) {
                            ForEach(CaptureEngine.Mount.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        ForEach(CameraPick.dualGuidance(mount: engine.mount), id: \.0) { k, v in
                            LabeledContent(k) { Text(v).multilineTextAlignment(.trailing) }
                        }
                    } header: { Text("양쪽 카메라 설치") }
                    footer: {
                        Text("왼쪽 화면이 A 코트다. 카메라가 반대로 보이면 상단 ⇄ 버튼으로 바꾼다. 영상 방향은 자동으로 바로 서고, 틀리면 회전·뒤집기 버튼으로 더한다.")
                    }
                }
                // 실기기에서만 답이 나오는 것들. V 자 양쪽 카메라 안의 전제 조건이다.
                Section {
                    Text(hinge).font(.system(size: 12, design: .monospaced))
                    ForEach(Array(multiCam.enumerated()), id: \.offset) { _, l in
                        Text(l).font(.system(size: 12, design: .monospaced))
                    }
                } header: { Text("진단 — 폴더블·멀티캠") }
                footer: {
                    Text("뒷면 카메라와 앞면 카메라가 '동시 가능' 한 조합에 같이 있어야 V 자 양쪽 녹화를 만들 수 있다.")
                }
                .background(HingeProbe(text: $hinge).frame(width: 0, height: 0))
                if let lens, !engine.isDual {
                    Section {
                        ForEach(CameraPick.guidance(lens), id: \.0) { k, v in
                            LabeledContent(k) {
                                Text(v).multilineTextAlignment(.trailing)
                            }
                        }
                    } header: { Text("설치") }
                    footer: {
                        Text(lens.isUltraWide
                             ? "울트라와이드다. 일반 코트 측면 펜스(중앙선에서 약 9.1 m)에서 코트 전체가 들어온다."
                             : "울트라와이드가 아니다. 이 렌즈로 코트 전체를 담으려면 \(String(format: "%.1f", lens.minDistance)) m 가 필요해서 일반 코트에서는 어렵다.")
                    }

                    Section {
                        Text("네트가 화면 가운데 점선에 맞게")
                        Text("양쪽 베이스라인이 좌우 흰 점선 안에")
                        Text("높을수록 선수가 겹쳐 보이지 않는다")
                    } header: { Text("화면 안내선 보는 법") }
                    footer: {
                        Text("안내선은 상단 격자 버튼으로 끈다.")
                    }

                    Section {
                        LabeledContent("가까운 쪽 네트 앞", value: "약 270 px")
                        LabeledContent("가까운 쪽 베이스라인", value: "약 169 px")
                        LabeledContent("먼 쪽 네트 앞", value: "약 125 px")
                        LabeledContent("먼 쪽 베이스라인", value: "약 108 px")
                    } header: { Text("선수가 화면에서 차지하는 높이") }
                    footer: {
                        Text("키 1.75 m · 4K 세로 2160 px 기준. 가까운 코트와 먼 코트가 약 2.5배 차이 난다 — 측면 한 대로 찍는 구조상 생기는 차이다.")
                    }
                }

                if !log.isEmpty {
                    Section {
                        ForEach(Array(log.enumerated()), id: \.offset) { _, l in
                            Text(l).font(.system(size: 11, design: .monospaced))
                        }
                    } header: { Text("기록") }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
    }
}

/// 녹화 시작 전 점검. 막는 게 아니라 알고 시작하게 하는 화면이다.
struct PreflightSheet: View {
    let items: [Preflight.Item]
    let blocked: Bool
    let onStart: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(items) { i in
                    HStack(alignment: .top, spacing: 11) {
                        Image(systemName: icon(i.level))
                            .foregroundStyle(color(i.level))
                            .font(.system(size: 16)).frame(width: 20)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(i.title).font(.system(size: 14, weight: .semibold))
                            Text(i.detail).font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            .navigationTitle(blocked ? "시작할 수 없다" : "시작 전 점검")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if blocked {
                        Text("위 항목을 해결해야 녹화를 시작할 수 있다.")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                        Button("닫기") { dismiss() }.font(.system(size: 15, weight: .semibold))
                    } else {
                        Button { onStart() } label: {
                            Text("알고 시작한다")
                                .font(.system(size: 16, weight: .bold))
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .background(.white, in: Capsule())
                                .foregroundStyle(.black)
                        }
                        Button("취소") { dismiss() }
                            .font(.system(size: 14)).foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 20).padding(.bottom, 12)
                .background(.bar)
            }
        }
    }

    private func icon(_ l: Preflight.Level) -> String {
        switch l {
        case .ok:   "checkmark.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .stop: "xmark.octagon.fill"
        }
    }
    private func color(_ l: Preflight.Level) -> Color {
        switch l { case .ok: .green; case .warn: .orange; case .stop: .red }
    }
}

/// 포인트 기록. 영상에서 그 지점으로 찾아가는 데 쓴다.
struct LogSheet: View {
    let log: MatchLog
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            List {
                if log.entries.isEmpty {
                    Text("아직 기록된 포인트가 없다").foregroundStyle(.secondary)
                }
                ForEach(log.entries.reversed()) { e in
                    HStack(spacing: 12) {
                        Text(e.clock)
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                            .foregroundStyle(e.hasVideo ? .secondary : .tertiary)
                        Text(e.by.tag)
                            .font(.system(size: 13, weight: .bold)).frame(width: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(e.score).font(.system(size: 13))
                            if let n = e.note {
                                Text(n).font(.system(size: 11)).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("포인트 \(log.entries.count)개")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(copied ? "복사됨" : "표 복사") {
                        UIPasteboard.general.string = log.text
                        copied = true
                    }
                }
                ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } }
            }
        }
    }
}
