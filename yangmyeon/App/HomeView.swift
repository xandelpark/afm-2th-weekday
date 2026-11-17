import SwiftUI

/// 첫 화면. 가로 전용이라 왼쪽에 할 일, 오른쪽에 최근 경기.
struct HomeView: View {
    @EnvironmentObject private var s: Session
    @State private var recent: [Recording] = []
    @State private var free: Int64 = 0

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("양면")
                            .font(.system(size: 44, weight: .heavy, design: .rounded))
                            .foregroundStyle(Theme.text)
                        Text("양쪽 코트를 한 번에. 포인트마다 영상 위치를 남긴다.")
                            .font(.system(size: 14)).foregroundStyle(Theme.dim)
                    }
                    NavigationLink(value: Route.record) {
                        Label("촬영 시작", systemImage: "record.circle")
                    }
                    .buttonStyle(PrimaryButton())
                    // 좁은 화면(바깥 화면)에선 아이콘을 빼서 오른쪽 목록 자리를 낸다.
                    ViewThatFits(in: .horizontal) {
                        navButtons.labelStyle(.titleAndIcon)
                        navButtons.labelStyle(.titleOnly)
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 4) {
                        Text("지금 경기 형식 · \(s.formatLabel)").font(.system(size: 12)).foregroundStyle(Theme.dim)
                        Text("남은 공간 \(Fmt.gb(free)) · 4K 양쪽 녹화 약 \(Int(Double(free) / 1_048_576 / 300))분")
                            .font(.system(size: 12)).foregroundStyle(Theme.dim)
                    }
                }
                .frame(maxWidth: 400, alignment: .leading)

                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        SectionTitle(text: "최근 경기")
                        Spacer()
                        if !recent.isEmpty {
                            NavigationLink(value: Route.library) {
                                Text("전체 보기").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ball)
                            }
                        }
                    }
                    if recent.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "film.stack").font(.system(size: 30)).foregroundStyle(Theme.dim)
                            Text("아직 녹화한 경기가 없다").font(.system(size: 14)).foregroundStyle(Theme.dim)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .card()
                    } else {
                        ScrollView(showsIndicators: false) {
                            VStack(spacing: 10) {
                                ForEach(recent.prefix(4)) { r in
                                    NavigationLink(value: Route.play(r)) { RecordingRow(r: r) }
                                        .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
                // 목록 한 줄(썸네일 + 날짜)이 들어갈 최소 폭. 바깥 화면(가로 약 678pt)에서도 날짜가 세로로 쪼개지지 않게.
                .frame(minWidth: 250, maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(24)
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { recent = Recordings.all(); free = Recordings.freeBytes }
    }

    private var navButtons: some View {
        HStack(spacing: 10) {
            NavigationLink(value: Route.library) { Label("경기 기록", systemImage: "list.bullet.rectangle") }
            NavigationLink(value: Route.settings) { Label("설정", systemImage: "slider.horizontal.3") }
            NavigationLink(value: Route.guide) { Label("설치 안내", systemImage: "info.circle") }
        }
        .buttonStyle(SecondaryButton())
    }
}

/// 목록 한 줄. 썸네일 + 이름 + 날짜 + 스코어.
struct RecordingRow: View {
    let r: Recording
    @State private var thumb: UIImage?

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10).fill(Theme.card2)
                if let thumb {
                    Image(uiImage: thumb).resizable().scaledToFill()
                } else {
                    Image(systemName: r.isDual ? "rectangle.split.2x1" : "rectangle")
                        .foregroundStyle(Theme.dim)
                }
            }
            .frame(width: 84, height: 47)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 4) {
                Text(r.title).font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.text).lineLimit(1)
                Text(Fmt.date.string(from: r.date)).font(.system(size: 12)).foregroundStyle(Theme.dim)
                    .lineLimit(1).minimumScaleFactor(0.8)
                // 폭이 좁으면(바깥 화면) 덜 중요한 것부터 뺀다. 글자가 한 자씩 세로로 쪼개지지 않게.
                ViewThatFits(in: .horizontal) {
                    meta(full: true)
                    meta(full: false)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(Theme.dim)
        }
        .card(padding: 12)
        .task { thumb = await Recordings.thumbnail(r) }
    }

    private func meta(full: Bool) -> some View {
        HStack(spacing: 6) {
            let parts = (r.summary.isEmpty ? [] : [r.summary]) + (full ? [r.isDual ? "양쪽" : "단일", Fmt.gb(r.bytes)] : [])
            ForEach(Array(parts.enumerated()), id: \.offset) { i, t in
                if i > 0 { Text("·").foregroundStyle(Theme.dim) }
                Text(t).font(i == 0 && !r.summary.isEmpty ? .system(size: 13, weight: .semibold, design: .rounded) : .system(size: 12))
                    .foregroundStyle(i == 0 && !r.summary.isEmpty ? Theme.ball : Theme.dim)
            }
            if r.inPhotos {
                Image(systemName: "photo.on.rectangle").font(.system(size: 11)).foregroundStyle(Theme.sky)
            }
            if r.merged != nil {
                Text("합본").font(.system(size: 10, weight: .bold)).padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Theme.ball.opacity(0.2), in: Capsule()).foregroundStyle(Theme.ball)
            }
        }
        .lineLimit(1)
        // 다 들어가는 판만 제 크기로 고정. 짧은 판은 그래도 넘치면 끝을 … 로 줄인다.
        .fixedSize(horizontal: full, vertical: false)
    }
}
