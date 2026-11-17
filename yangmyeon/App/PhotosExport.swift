import Foundation
import Photos

/// 사진 앱에 넣기. 앱 폴더의 영상은 그대로 두고 사진 앱에 복사본을 만든다.
/// '추가 전용' 권한만 쓴다 — 사용자의 사진을 읽지 않는다.
enum PhotosExport {
    enum Outcome: Equatable {
        case saved(Int)       // 넣은 영상 수
        case denied           // 권한 없음
        case failed(String)
    }

    /// 폴더에 남기는 표식. 두 번 넣는 걸 막고, 목록에 "사진 앱" 배지를 띄운다.
    static let markerName = "사진앱.txt"

    static func isExported(_ folder: URL) -> Bool {
        FileManager.default.fileExists(atPath: folder.appendingPathComponent(markerName).path)
    }

    /// 폴더의 코트 영상(코트A·코트B 또는 코트)을 사진 앱에 넣는다. 같은 시각으로 넣어 A·B 가 나란히 보이게 한다.
    static func save(folder: URL, startedAt: Date?) async -> Outcome {
        let fm = FileManager.default
        let videos = ((try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension.lowercased() == "mov" && $0.lastPathComponent.hasPrefix("코트") }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        guard !videos.isEmpty else { return .failed("영상 파일이 없다") }
        return await save(files: videos, startedAt: startedAt, folder: folder)
    }

    /// 파일 몇 개를 사진 앱에 넣는다. folder 를 주면 표식을 남긴다.
    static func save(files videos: [URL], startedAt: Date?, folder: URL?) async -> Outcome {
        guard !videos.isEmpty else { return .failed("영상 파일이 없다") }
        let folder = folder ?? videos[0].deletingLastPathComponent()
        let leaveMarker = folder != videos[0].deletingLastPathComponent() ? false : true

        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { return .denied }

        let when = startedAt ?? (try? folder.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? Date()
        var ids: [String] = []
        do {
            try await PHPhotoLibrary.shared().performChanges {
                for (i, v) in videos.enumerated() {
                    let req = PHAssetCreationRequest.forAsset()
                    let opt = PHAssetResourceCreationOptions()
                    opt.shouldMoveFile = false                 // 앱 폴더 원본은 다시 보기에 쓴다
                    opt.originalFilename = "\(folder.lastPathComponent)_\(v.lastPathComponent)"
                    req.addResource(with: .video, fileURL: v, options: opt)
                    // A 는 0초, B 는 1초 — 사진 앱 정렬에서 A 가 먼저 오게.
                    req.creationDate = when.addingTimeInterval(Double(i))
                    if let id = req.placeholderForCreatedAsset?.localIdentifier { ids.append(id) }
                }
            }
        } catch {
            return .failed(error.localizedDescription)
        }
        if leaveMarker, videos.contains(where: { $0.lastPathComponent.hasPrefix("코트") }) {
            let marker = "사진 앱에 저장함 \(ISO8601DateFormatter().string(from: Date()))\n" + ids.joined(separator: "\n") + "\n"
            try? marker.write(to: folder.appendingPathComponent(markerName), atomically: true, encoding: .utf8)
        }
        return .saved(videos.count)
    }
}
