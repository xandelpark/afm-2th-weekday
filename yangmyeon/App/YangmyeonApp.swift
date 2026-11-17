import SwiftUI
import UIKit

/// 화면 이동. 홈에서 밀어 넣는 식이다.
enum Route: Hashable {
    case record, library, settings, guide
    case play(Recording)
}

@main
struct YangmyeonApp: App {
    @StateObject private var session = Session()
    @State private var path = NavigationPath()

    var body: some Scene {
        WindowGroup {
            NavigationStack(path: $path) {
                HomeView()
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .record:   ContentView()
                        case .library:  LibraryView()
                        case .settings: SettingsView()
                        case .guide:    GuideView()
                        case .play(let r): PlayerView(r: r)
                        }
                    }
            }
            .environmentObject(session)
            .tint(Theme.ball)
            #if targetEnvironment(simulator) || DEBUG
            // 스크린샷·검증용: `-demo-screen record|library|settings|guide|play|stitch` 로 바로 그 화면을 연다.
            // 폰(Debug 빌드)에서도 `devicectl device process launch --console ... -- -demo-screen play` 로 쓴다.
            .onAppear {
                let a = ProcessInfo.processInfo.arguments
                guard let i = a.firstIndex(of: "-demo-screen"), i + 1 < a.count else { return }
                switch a[i + 1] {
                case "record":   path.append(Route.record)
                case "library":  path.append(Route.library)
                case "settings": path.append(Route.settings)
                case "guide":    path.append(Route.guide)
                case "play":     if let r = Recordings.all().first { path.append(Route.play(r)) }
                // 검증용: 첫 경기를 절반 크기로 합쳐 폴더에 쓴다. 결과는 ffprobe 로 본다.
                case "stitch":
                    if let r = Recordings.all().first {
                        Task {
                            do {
                                let t0 = Date()
                                guard let s = await LibraryView.savedAlign(r) else { print("합본 실패: 맞춤 없음"); return }
                                let t1 = Date()
                                print(String(format: "[검증] 맞춤 %.1f초 merge=%@ scale=%.3f", t1.timeIntervalSince(t0), s.merge ? "Y" : "N", s.align.scale))
                                let q: Stitch.Quality = a.contains("-demo-full") ? .full : .half
                                let u = try await Stitch.export(folder: r.folder, videos: r.videos,
                                                                align: s.align, quality: q) { _ in }
                                print(String(format: "[검증] 합본 완료 %.1f초 %@", Date().timeIntervalSince(t1), u.path))
                            } catch { print("합본 실패 \(error)") }
                        }
                    }
                default: break
                }
            }
            #endif
            // 코트에 세워두고 쓰는 앱이다. 화면이 꺼지면 녹화 확인이 안 된다.
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .preferredColorScheme(.dark)
        }
    }
}
