import Foundation
import AVFoundation
import UIKit
import MatchCore

/// 폰에 저장된 경기 하나. Documents/<날짜_이름>/ 폴더 하나가 경기 하나다.
/// 서버는 없다. 전부 이 폴더에 있고, 파일 앱에서도 보인다.
struct Recording: Identifiable, Hashable {
    let id: URL                // 폴더
    let name: String
    let date: Date
    let videos: [URL]          // 코트A.mov, 코트B.mov (또는 코트.mov)
    /// 합쳐 놓은 영상(합본.mov). 없으면 nil.
    var merged: URL? = nil
    let log: MatchLog?
    let bytes: Int64

    var folder: URL { id }
    static func == (a: Recording, b: Recording) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
    var title: String { log?.matchName ?? name }
    /// "6-4 7-5" 처럼 끝난 세트. 없으면 포인트 수.
    var summary: String {
        guard let log else { return "기록 없음" }
        var m = Match(format: log.format)
        for e in log.entries { m.scorePoint(e.by) }
        if !m.sets.isEmpty {
            return m.sets.map { "\($0.games[0])-\($0.games[1])" }.joined(separator: "  ")
        }
        if m.games != [0, 0] { return "\(m.games[0])-\(m.games[1]) 진행 중" }
        return log.entries.isEmpty ? "점수 없음" : "\(log.entries.count) 포인트"
    }
    var isDual: Bool { videos.count >= 2 }
    var inPhotos: Bool { PhotosExport.isExported(folder) }
}

enum Recordings {
    static var root: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// 최신순.
    static func all() -> [Recording] {
        let fm = FileManager.default
        guard let dirs = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey, .creationDateKey])
        else { return [] }
        var out: [Recording] = []
        for d in dirs {
            guard (try? d.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
            let files = (try? fm.contentsOfDirectory(at: d, includingPropertiesForKeys: [.fileSizeKey])) ?? []
            let movs = files.filter { $0.pathExtension.lowercased() == "mov" }
            let videos = movs.filter { $0.lastPathComponent != Stitch.fileName }
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
            let merged = movs.first { $0.lastPathComponent == Stitch.fileName }
            let logURL = d.appendingPathComponent("포인트기록.json")
            let log = (try? Data(contentsOf: logURL)).flatMap { try? JSONDecoder().decode(MatchLog.self, from: $0) }
            guard !videos.isEmpty || log != nil else { continue }
            let bytes = files.reduce(Int64(0)) { $0 + Int64((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
            let date = log?.startedAt
                ?? (try? d.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? Date.distantPast
            // 폴더 이름 "261102_1725_경기" 에서 이름만
            let name = d.lastPathComponent.split(separator: "_", maxSplits: 2).dropFirst(2).joined()
            out.append(Recording(id: d, name: name.isEmpty ? d.lastPathComponent : name,
                                 date: date, videos: videos, merged: merged, log: log, bytes: bytes))
        }
        return out.sorted { $0.date > $1.date }
    }

    static func delete(_ r: Recording) {
        try? FileManager.default.removeItem(at: r.folder)
    }

    /// 썸네일 — 첫 영상의 3초 지점. 느리니까 비동기로.
    static func thumbnail(_ r: Recording) async -> UIImage? {
        guard let v = r.videos.first else { return nil }
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: v))
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 640, height: 640)
        let t = CMTime(seconds: 3, preferredTimescale: 600)
        guard let (img, _) = try? await gen.image(at: t) else { return nil }
        return UIImage(cgImage: img)
    }

    static func duration(_ r: Recording) async -> TimeInterval {
        guard let v = r.videos.first else { return 0 }
        let d = try? await AVURLAsset(url: v).load(.duration)
        return d.map { CMTimeGetSeconds($0) } ?? 0
    }

    /// 남은 공간.
    static var freeBytes: Int64 { Preflight.freeBytes }
    /// 경기 폴더 전체 용량.
    static var usedBytes: Int64 { all().reduce(0) { $0 + $1.bytes } }
}
