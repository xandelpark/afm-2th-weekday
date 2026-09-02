"""앨범 택배목록 ↔ 웨딩자동화시트 매칭 공통 로직."""
import datetime
import re
import unicodedata

# 웨딩자동화시트 '고객정보' 시트 컬럼 (1-based)
COL_예식일 = 1    # A
COL_종류 = 3      # C
COL_신부이름 = 4  # D
COL_연락처 = 5    # E
COL_Y = 25        # Y — 앨범발송확인차문자전송 ( + 7일후 )
COL_Z = 26        # Z — 엘범발송문자 발송완료여부
COL_상품주소 = 28  # AB

HEADER_ROW = 1  # 1행이 헤더, 데이터는 2행부터


def s(v):
    return "" if v is None else str(v).strip()


def norm_date(v):
    """예식일을 YYYY-MM-DD 로 정규화. 실패하면 '' 반환."""
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    t = s(v)
    if not t:
        return ""
    t = t.split(" ")[0]
    # 2024.05.26 / 2024,08.24 / 2024/05/26 → 2024-05-26
    t = re.sub(r"[.,/]", "-", t)
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        try:
            return datetime.date(y, mo, d).strftime("%Y-%m-%d")
        except ValueError:
            return ""
    # 260509 / 20260509 형식
    m = re.fullmatch(r"(\d{2})(\d{2})(\d{2})", t)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        try:
            return datetime.date(2000 + y, mo, d).strftime("%Y-%m-%d")
        except ValueError:
            return ""
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", t)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        try:
            return datetime.date(y, mo, d).strftime("%Y-%m-%d")
        except ValueError:
            return ""
    return ""


def norm_name(v):
    """공백/유니코드 정규화만. 시트에 '신연주1' 처럼 뒤에 숫자가 붙는 표기가 실제로 쓰이므로 숫자는 살린다."""
    t = unicodedata.normalize("NFC", s(v))
    return re.sub(r"\s+", "", t)


def base_name(v):
    """뒤에 붙은 일련번호를 뗀 이름. 완전일치 실패 시 보조 매칭용."""
    return re.sub(r"\d+$", "", norm_name(v))


def norm_phone(v):
    """숫자만 남긴 전화번호. 엑셀에서 1075509077.0 처럼 숫자로 저장된 경우도 처리."""
    t = s(v)
    if t.endswith(".0"):
        t = t[:-2]
    d = re.sub(r"\D", "", t)
    if d and not d.startswith("0") and len(d) == 10:
        d = "0" + d
    return d


def is_checked(v):
    """Y열 체크박스가 이미 체크(TRUE)인지."""
    if isinstance(v, bool):
        return v
    return s(v).upper() in ("TRUE", "T", "1", "Y", "예", "체크")


class SheetIndex:
    """고객정보 행들을 (예식일, 이름) 키로 색인."""

    def __init__(self, rows):
        """rows: [(sheet_row_number, [cell values...]), ...] — 값은 1-based 컬럼 순서 리스트."""
        self.rows = rows
        self.by_key = {}
        self.by_base = {}
        self.by_phone = {}
        for rn, vals in rows:
            name = norm_name(self._get(vals, COL_신부이름))
            if not name:
                continue
            date = norm_date(self._get(vals, COL_예식일))
            self.by_key.setdefault((date, name), []).append((rn, vals))
            self.by_base.setdefault((date, base_name(name)), []).append((rn, vals))
            phone = norm_phone(self._get(vals, COL_연락처))
            if phone:
                self.by_phone.setdefault(phone, []).append((rn, vals))

    @staticmethod
    def _get(vals, col):
        return vals[col - 1] if len(vals) >= col else None

    def get(self, vals, col):
        return self._get(vals, col)

    def lookup(self, date, name, phone=""):
        """(status, candidates) 반환.

        status: 'ok' | 'none' | 'ambiguous'
        """
        d, n, p = norm_date(date), norm_name(name), norm_phone(phone)

        for bucket, how in ((self.by_key.get((d, n)), "exact"),
                            (self.by_base.get((d, base_name(n))), "base")):
            if not bucket:
                continue
            cands = bucket
            if len(cands) > 1 and p:
                narrowed = [c for c in cands
                            if norm_phone(self._get(c[1], COL_연락처)) == p]
                if len(narrowed) == 1:
                    return "ok", narrowed, how + "+phone"
                if narrowed:
                    cands = narrowed
            if len(cands) == 1:
                return "ok", cands, how
            return "ambiguous", cands, how

        # 예식일/이름이 어긋난 경우의 최후 보루 — 전화번호. 오탈자를 잡아주지만
        # 같은 번호로 여러 건이 잡힐 수 있어 사람이 확인하도록 how 에 표시한다.
        if p and self.by_phone.get(p):
            cands = self.by_phone[p]
            if len(cands) == 1:
                return "ok", cands, "phone-only"
            return "ambiguous", cands, "phone-only"

        return "none", [], ""
