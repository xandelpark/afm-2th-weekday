import Foundation

/// 초성 찾기. 갤럭시 키보드처럼 "ㄱㄱ" 만 쳐도 "가격 안내" 가 나오게.
enum Hangul {
    static let choseong: [Character] = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"]
    /// 키보드 자음판에 놓는 14개 (쌍자음은 같은 자음으로 친다)
    static let pad: [Character] = ["ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"]
    private static let consonants = Set(choseong)
    private static let loose: [Character: Character] = ["ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ"]

    static func isConsonant(_ c: Character) -> Bool { consonants.contains(c) }

    /// 완성된 한 글자(가~힣)의 번호. 아니면 nil.
    private static func syllable(_ c: Character) -> Int? {
        guard let s = c.unicodeScalars.first, c.unicodeScalars.count == 1 else { return nil }
        let v = Int(s.value) - 0xAC00
        return (0..<11172).contains(v) ? v : nil
    }

    /// 글자의 초성 (쌍자음은 홑자음으로). 한글이 아니면 글자 그대로(소문자).
    static func head(_ c: Character) -> Character {
        if let v = syllable(c) { let h = choseong[v / 588]; return loose[h] ?? h }
        if let h = loose[c] { return h }
        return Character(c.lowercased())
    }

    /// "가격 안내" → "ㄱㄱㅇㄴ". 띄어쓰기·기호는 뺀다.
    static func initials(_ s: String) -> String {
        String(s.filter { $0.isLetter || $0.isNumber }.map(head))
    }

    /// 검색어 한 글자가 본문 한 글자와 맞는지. 자음은 초성끼리, 나머지는 같은 글자.
    /// last 가 참이면 아직 치는 중인 글자로 보고 "가" 가 "각" 에도 맞게 한다.
    private static func same(_ q: Character, _ t: Character, last: Bool) -> Bool {
        if q == t { return true }
        if isConsonant(q) { return head(q) == head(t) }
        if let qv = syllable(q), let tv = syllable(t) {
            return last && qv % 28 == 0 && qv / 28 == tv / 28
        }
        return Character(q.lowercased()) == Character(t.lowercased())
    }

    /// 검색어가 글 안 어디서 시작해 맞는지 (띄어쓰기는 건너뛴다). 안 맞으면 nil.
    static func find(_ query: String, in text: String) -> Int? {
        let q = Array(query.filter { !$0.isWhitespace })
        let t = Array(text.filter { !$0.isWhitespace })
        guard !q.isEmpty, q.count <= t.count else { return q.isEmpty ? 0 : nil }
        for i in 0...(t.count - q.count) {
            var ok = true
            for j in 0..<q.count where !same(q[j], t[i + j], last: j == q.count - 1) { ok = false; break }
            if ok { return i }
        }
        return nil
    }
}
