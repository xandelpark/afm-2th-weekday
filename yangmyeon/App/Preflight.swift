import Foundation
import UIKit
import AVFoundation

/// 녹화를 누르기 전에 막아야 하는 것들.
///
/// 코트에 세워놓고 경기를 다 치른 뒤에 "저장 공간이 없었다"를 알게 되면
/// 그 경기는 없어진다. 그래서 시작 전에 계산해서 먼저 말해준다.
struct Preflight {

    enum Level { case ok, warn, stop }

    struct Item: Identifiable {
        let id = UUID()
        let level: Level
        let title: String
        let detail: String
    }

    /// 대략적인 분당 용량. 인수인계 §3 의 2시간 측정치에서 역산한 값이다 —
    /// 4K 17.6 GB → 약 147 MB/분, 1080p 10.0 GB → 83, 720p 6.4 GB → 53. 넉넉하게 올려 잡았다.
    static func megabytesPerMinute(width: Int32) -> Double {
        switch width {
        case 1920...: return 150
        case 1280..<1920: return 85
        default: return 55
        }
    }

    static var freeBytes: Int64 {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        let v = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return v?.volumeAvailableCapacityForImportantUsage ?? 0
    }

    /// 지금 남은 공간으로 몇 분을 찍을 수 있나.
    static func minutesAvailable(width: Int32) -> Int {
        let mb = Double(freeBytes) / 1_048_576
        return Int(mb / megabytesPerMinute(width: width))
    }

    /// 경기 하나에 필요한 시간. 형식에 따라 다르다.
    static func expectedMinutes(gamesPerSet: Int, sets: Int) -> Int {
        // 동호인 경기 기준 한 게임 약 5분. 넉넉하게 본다.
        gamesPerSet * 2 * sets * 5
    }

    /// UIDevice 는 메인 액터에서만 읽을 수 있다.
    @MainActor
    static func check(width: Int32, streams: Int = 1, needMinutes: Int) -> [Item] {
        var out: [Item] = []

        // ── 저장 공간 ── 양쪽 동시 녹화는 파일이 둘이라 두 배 든다.
        let can = minutesAvailable(width: width) / max(1, streams)
        let freeGB = Double(freeBytes) / 1_073_741_824
        if freeBytes < 500 * 1_048_576 {
            out.append(Item(level: .stop, title: "저장 공간이 거의 없다",
                            detail: String(format: "남은 공간 %.1f GB. 녹화를 시작할 수 없다.", freeGB)))
        } else if can < needMinutes {
            out.append(Item(level: .warn, title: "공간이 경기를 다 못 담는다",
                            detail: String(format: "남은 공간 %.1f GB = 약 %d분. 이 형식은 약 %d분 걸린다.",
                                           freeGB, can, needMinutes)))
        } else {
            out.append(Item(level: .ok, title: "저장 공간",
                            detail: String(format: "%.1f GB · 약 %d분 녹화 가능", freeGB, can) + (streams > 1 ? " (파일 \(streams)개 기준)" : "")))
        }

        // ── 배터리 ──
        UIDevice.current.isBatteryMonitoringEnabled = true
        let pct = Int(UIDevice.current.batteryLevel * 100)
        let charging = UIDevice.current.batteryState == .charging
            || UIDevice.current.batteryState == .full
        if charging {
            out.append(Item(level: .ok, title: "전원 연결됨", detail: "\(pct)% · 충전 중"))
        } else if pct < 0 {
            out.append(Item(level: .warn, title: "배터리를 읽을 수 없다", detail: "보조배터리를 연결해 두는 게 안전하다."))
        } else {
            // 카메라 + 화면 상시 점등은 대략 분당 0.6%씩 먹는다고 본다 (2시간 ≒ 72%).
            let mins = Int(Double(pct) / 0.6)
            let level: Level = mins < needMinutes ? .warn : .ok
            out.append(Item(level: level,
                            title: level == .warn ? "배터리가 경기를 못 버틴다" : "배터리",
                            detail: "\(pct)% · 약 \(mins)분. 카메라와 화면을 계속 켜두면 빨리 준다."
                                + (level == .warn ? " 보조배터리를 연결할 것." : "")))
        }

        // ── 발열 ──
        switch ProcessInfo.processInfo.thermalState {
        case .serious:
            out.append(Item(level: .warn, title: "기기가 이미 뜨겁다",
                            detail: "그늘로 옮기고 잠시 식힌 뒤 시작하는 게 좋다."))
        case .critical:
            out.append(Item(level: .stop, title: "기기가 너무 뜨겁다",
                            detail: "지금 시작하면 중간에 녹화가 끊긴다."))
        default:
            break
        }

        return out
    }

    static func blocked(_ items: [Item]) -> Bool { items.contains { $0.level == .stop } }
}
