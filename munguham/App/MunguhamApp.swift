import SwiftUI

@main
struct MunguhamApp: App {
    @StateObject private var lib = Library()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            root
                .environmentObject(lib)
                .tint(Theme.accent)
        }
        .onChange(of: phase) { _, p in
            // 키보드에서 쓴 횟수, 다른 곳에서 바뀐 파일을 다시 읽는다
            if p == .active { lib.load() }
        }
    }
}

extension MunguhamApp {
    @ViewBuilder private var root: some View {
        #if DEBUG
        if Demo.has("-demo-keyboard") { KeyboardDemoView() } else { HomeView() }
        #else
        HomeView()
        #endif
    }
}

enum Theme {
    static let accent = Color(red: 0.07, green: 0.62, blue: 0.53)
    static let page = Color(uiColor: .systemGroupedBackground)
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
}
