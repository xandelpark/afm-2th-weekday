import AVFoundation

/// 도장 소리 '퐁'. 무음 모드면 안 난다(ambient), 다른 앱 음악은 끊지 않는다.
@MainActor
final class Sfx {
    static let shared = Sfx()
    private var players: [AVAudioPlayer] = []
    private var next = 0

    private init() {
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        guard let url = Bundle.main.url(forResource: "stamp", withExtension: "wav") else { return }
        // 빠르게 연달아 찍어도 겹쳐 나도록 몇 개를 돌려 쓴다
        players = (0..<4).compactMap { _ in
            let p = try? AVAudioPlayer(contentsOf: url)
            p?.enableRate = true
            p?.prepareToPlay()
            return p
        }
    }

    func thump(volume: Float = 1) {
        guard !players.isEmpty else { return }
        let p = players[next % players.count]
        next += 1
        p.currentTime = 0
        p.volume = volume
        p.rate = Float.random(in: 0.9...1.15)   // 찍을 때마다 살짝 다른 소리
        p.play()
    }
}
