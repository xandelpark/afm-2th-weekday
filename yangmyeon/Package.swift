// swift-tools-version:6.0
import PackageDescription

// 경기 규칙만 떼어낸 패키지다. 카메라·UI 와 섞지 않는다 —
// 규칙은 기기 없이 터미널에서 `swift test` 로 검증할 수 있어야 한다.
let package = Package(
    name: "MatchCore",
    products: [.library(name: "MatchCore", targets: ["MatchCore"])],
    targets: [.target(name: "MatchCore")]
)
