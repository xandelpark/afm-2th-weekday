import SwiftUI

struct EditorScreen: View {
    @StateObject private var ed: Editor
    @Environment(\.dismiss) private var dismiss

    init(id: UUID) {
        _ed = StateObject(wrappedValue: Editor(sketch: Store.load(id) ?? Sketch.blank(landscape: true)))
    }

    var body: some View {
        VStack(spacing: 0) {
            CanvasRep(ed: ed)
                .overlay(alignment: .bottom) {
                    if ed.showStamps {
                        StampPanel(ed: ed)
                            .padding(.horizontal, 12)
                            .padding(.bottom, 6)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
            ToolBar(ed: ed) {
                ed.close()
                dismiss()
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .animation(.spring(duration: 0.28), value: ed.showStamps)
        .onDisappear { ed.close() }
        .onAppear {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-demo-stamps") { ed.tool = .stamp; ed.showStamps = true }
            if ProcessInfo.processInfo.arguments.contains("-demo-animal") { ed.prefs.symbol = "art.rabbit"; ed.prefs.colors[.stamp] = RGBA(hex: 0xFF7EB6) }
            #endif
        }
    }
}

// MARK: 아래 도구 막대

struct ToolBar: View {
    @ObservedObject var ed: Editor
    let onHome: () -> Void
    @State private var sizeFor: Tool?
    @State private var askClear = false

    var body: some View {
        // 좁은 화면(세로로 든 폰)에선 최근 색 → 휴지통 순으로 뺀다.
        ViewThatFits(in: .horizontal) {
            row(recents: 5, trash: true)
            row(recents: 3, trash: true)
            row(recents: 0, trash: true)
            row(recents: 0, trash: true, compact: true)
            row(recents: 0, trash: false, compact: true)
            row(recents: 0, trash: false, compact: true, redo: false)
        }
        .frame(height: 78)
        .frame(maxWidth: .infinity)
        .background(Rectangle().fill(Theme.bar).shadow(color: .black.opacity(0.08), radius: 8, y: -2).ignoresSafeArea(edges: [.bottom, .horizontal]))
        .confirmationDialog("그림을 다 지울까요?", isPresented: $askClear, titleVisibility: .visible) {
            Button("다 지우기", role: .destructive) { ed.clearAll() }
            Button("그만두기", role: .cancel) {}
        } message: {
            Text("되돌리기(↩︎)로 다시 살릴 수 있어요")
        }
    }

    private func row(recents n: Int, trash: Bool, compact: Bool = false, redo: Bool = true) -> some View {
        let b: CGFloat = compact ? 40 : 46
        return HStack(spacing: compact ? 6 : 10) {
            RoundButton(symbol: "house.fill", size: b, action: onHome)
            RoundButton(symbol: "arrow.uturn.backward", enabled: ed.canUndo, size: b) { ed.undo() }
            if redo { RoundButton(symbol: "arrow.uturn.forward", enabled: ed.canRedo, size: b) { ed.redo() } }
            Spacer(minLength: compact ? 2 : 6)
            HStack(alignment: .top, spacing: compact ? 2 : 6) {
                ForEach(Tool.allCases) { t in toolButton(t, width: compact ? 44 : 48) }
            }
            Spacer(minLength: compact ? 2 : 6)
            if ed.tool != .eraser {
                ColorWell(color: ed.color(ed.tool).color, rainbow: ed.tool == .stamp && ed.prefs.rainbow, size: b) { pickColor() }
                if n > 0 {
                    HStack(spacing: 6) {
                        ForEach(Array(ed.prefs.recents.prefix(n).enumerated()), id: \.offset) { _, c in
                            Swatch(color: c, selected: !(ed.tool == .stamp && ed.prefs.rainbow) && c.near(ed.color(ed.tool))) {
                                ed.setColor(c, for: ed.tool)
                            }
                        }
                    }
                }
            }
            if trash { RoundButton(symbol: "trash", enabled: !ed.isBlank, size: b) { askClear = true } }
        }
        .padding(.horizontal, compact ? 8 : 14)
    }

    private func toolButton(_ t: Tool, width: CGFloat) -> some View {
        let on = ed.tool == t
        return Button { tap(t) } label: {
            ToolIcon(tool: t, color: ed.color(t).color, symbol: ed.prefs.symbol, rainbow: ed.prefs.rainbow)
                .offset(y: on ? 4 : 24)
                .frame(width: width, height: 78, alignment: .top)
                .clipped()
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(.spring(duration: 0.25, bounce: 0.35), value: on)
        .accessibilityLabel(t.name)
        .popover(isPresented: Binding(get: { sizeFor == t }, set: { if !$0 { sizeFor = nil } })) {
            SizePicker(ed: ed, tool: t).presentationCompactAdaptation(.popover)
        }
    }

    /// 다른 도구를 누르면 바꾸고, 고른 도구를 또 누르면 굵기. 도장은 누르면 도장 칸이 열린다.
    private func tap(_ t: Tool) {
        if t == .stamp {
            if ed.tool == .stamp { ed.showStamps.toggle() } else { ed.tool = .stamp; ed.showStamps = true }
            return
        }
        ed.showStamps = false
        if ed.tool == t { sizeFor = t } else { ed.tool = t }
    }

    private func pickColor() {
        let t = ed.tool
        ColorPickerPresenter.shared.present(ed.color(t).ui) { c in
            ed.setColor(RGBA(c), for: t)
        } onDone: { c in
            ed.setColor(RGBA(c), for: t)
            ed.remember(RGBA(c))
        }
    }
}

/// 굵기 세 가지
struct SizePicker: View {
    @ObservedObject var ed: Editor
    let tool: Tool
    var body: some View {
        HStack(spacing: 14) {
            ForEach(0..<3, id: \.self) { i in
                let on = (ed.prefs.sizes[tool] ?? 1) == i
                Button { ed.prefs.sizes[tool] = i } label: {
                    Circle()
                        .fill(tool == .eraser ? Color.gray.opacity(0.35) : ed.color(tool).color)
                        .frame(width: [12, 22, 34][i], height: [12, 22, 34][i])
                        .frame(width: 52, height: 52)
                        .background(Circle().fill(on ? Theme.pick : Theme.soft))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
    }
}

// MARK: 도장 고르는 칸

struct StampPanel: View {
    @ObservedObject var ed: Editor
    @State private var group = 0

    var body: some View {
        VStack(spacing: 8) {
            // 묶음: 동물 / 반짝 / 물건
            HStack(spacing: 8) {
                ForEach(Array(Stamps.groups.enumerated()), id: \.offset) { i, g in
                    Button { group = i } label: {
                        HStack(spacing: 6) {
                            StampMark(name: g.icon, color: i == group ? ed.color(.stamp) : RGBA(hex: 0x9A8F88), pt: 22)
                            Text(g.id).font(.system(size: 15, weight: .bold, design: .rounded))
                        }
                        .foregroundStyle(i == group ? Theme.ink : Theme.ink.opacity(0.5))
                        .padding(.horizontal, 14).frame(height: 38)
                        .background(Capsule().fill(i == group ? Theme.pick : Theme.soft))
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHGrid(rows: [GridItem(.fixed(62), spacing: 8), GridItem(.fixed(62), spacing: 8)], spacing: 8) {
                    ForEach(Array(Stamps.groups[group].names.enumerated()), id: \.element) { i, name in
                        Button {
                            ed.prefs.symbol = name
                            ed.showStamps = false
                        } label: {
                            StampMark(name: name, color: cellColor(i), pt: 44)
                                .frame(width: 62, height: 62)
                                .background(RoundedRectangle(cornerRadius: 16).fill(name == ed.prefs.symbol ? Theme.pick : Theme.soft))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 2)
            }
            .id(group)
            .frame(height: 132)

            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { i in
                    let on = (ed.prefs.sizes[.stamp] ?? 1) == i
                    Button { ed.prefs.sizes[.stamp] = i } label: {
                        StampMark(name: ed.prefs.symbol, color: cellColor(2), pt: [16, 24, 32][i])
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(on ? Theme.pick : Theme.soft))
                    }
                    .buttonStyle(.plain)
                }
                Divider().frame(height: 30).padding(.horizontal, 2)
                ColorWell(color: ed.color(.stamp).color, size: 44) { pickColor() }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(ed.prefs.recents.enumerated()), id: \.offset) { _, c in
                            Swatch(color: c, selected: !ed.prefs.rainbow && c.near(ed.color(.stamp))) {
                                ed.setColor(c, for: .stamp)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                // 알록달록: 찍을 때마다 색이 바뀐다
                Button { ed.prefs.rainbow.toggle() } label: {
                    Circle().fill(Theme.rainbow)
                        .padding(ed.prefs.rainbow ? 5 : 0)
                        .overlay(Circle().strokeBorder(ed.prefs.rainbow ? Theme.ink : .clear, lineWidth: 2.5))
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("알록달록")
            }
        }
        .padding(12)
        .frame(maxWidth: 720)
        .onAppear { group = Stamps.group(of: ed.prefs.symbol) }
        .background(RoundedRectangle(cornerRadius: 24).fill(.white).shadow(color: .black.opacity(0.14), radius: 14, y: 4))
    }

    /// 알록달록이면 칸마다 다른 색으로 보여 준다
    private func cellColor(_ i: Int) -> RGBA {
        ed.prefs.rainbow ? Palette.rainbow[i % Palette.rainbow.count] : ed.color(.stamp)
    }

    private func pickColor() {
        ColorPickerPresenter.shared.present(ed.color(.stamp).ui) { c in
            ed.setColor(RGBA(c), for: .stamp)
        } onDone: { c in
            ed.setColor(RGBA(c), for: .stamp)
            ed.remember(RGBA(c))
        }
    }
}
