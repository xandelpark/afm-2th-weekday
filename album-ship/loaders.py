"""택배목록(입력) 읽기 — xlsx / csv / 붙여넣기 텍스트 모두 지원."""
import csv
import io
import os
import re

from common import norm_date, norm_name, norm_phone, s

# 헤더 이름 → 내부 필드
HEADER_ALIASES = {
    "예식일": "date", "예식일자": "date", "예식날짜": "date", "날짜": "date",
    "신부이름": "name", "신부": "name", "이름": "name", "신부명": "name",
    "전화번호": "phone", "연락처": "phone", "신부연락처": "phone", "휴대폰": "phone",
    "상품주소": "addr", "주소": "addr", "배송지": "addr",
    "순번": "no", "번호": "no",
}


def _map_header(cells):
    """헤더 행이면 {필드: 인덱스} 반환, 아니면 None."""
    m = {}
    for i, c in enumerate(cells):
        key = re.sub(r"\s+", "", s(c))
        if key in HEADER_ALIASES:
            m.setdefault(HEADER_ALIASES[key], i)
    return m if "date" in m and "name" in m else None


def _rows_to_items(rows, origin):
    """헤더를 찾아 그 아래 행들을 항목으로."""
    items = []
    hmap = None
    for rn, cells in rows:
        if hmap is None:
            hmap = _map_header(cells)
            continue
        get = lambda f: cells[hmap[f]] if f in hmap and len(cells) > hmap[f] else None
        date, name = norm_date(get("date")), norm_name(get("name"))
        if not date and not name:
            continue
        items.append({
            "origin": f"{origin}:{rn}",
            "date": date, "name": name,
            "phone": norm_phone(get("phone")),
            "addr": s(get("addr")),
            "raw_date": s(get("date")), "raw_name": s(get("name")),
        })
    if hmap is None:
        raise ValueError(f"{origin}: '예식일'/'신부이름' 헤더를 찾지 못했습니다.")
    return items


def load_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    items = []
    errors = []
    for ws in wb.worksheets:
        rows = [(i, list(r)) for i, r in
                enumerate(ws.iter_rows(values_only=True), start=1)]
        try:
            items += _rows_to_items(rows, f"{os.path.basename(path)}/{ws.title}")
        except ValueError as e:
            errors.append(str(e))
    if not items and errors:
        raise ValueError("\n".join(errors))
    return items


def load_delimited(text, origin, delim=None):
    if delim is None:
        delim = "\t" if text.count("\t") > text.count(",") else ","
    rows = [(i, r) for i, r in
            enumerate(csv.reader(io.StringIO(text), delimiter=delim), start=1)]
    return _rows_to_items(rows, origin)


# "260509.안윤진", "2026-05-09 안윤진", "20260509 안윤진 010-1234-5678"
FREE_RE = re.compile(
    r"^\s*(?:\d+[.)]\s*)?"                     # 앞 순번 (선택)
    r"(?P<date>\d{4}[-.,/]\d{1,2}[-.,/]\d{1,2}|\d{8}|\d{6})"
    r"\s*[.\s]\s*"
    r"(?P<name>[가-힣A-Za-z][가-힣A-Za-z0-9 ]*?)"
    r"(?:\s+(?P<phone>0?1[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}))?\s*$"
)


def load_freeform(text, origin="paste"):
    items, bad = [], []
    for i, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        m = FREE_RE.match(line)
        if not m:
            bad.append((i, line.strip()))
            continue
        d = norm_date(m.group("date"))
        if not d:
            bad.append((i, line.strip()))
            continue
        items.append({
            "origin": f"{origin}:{i}", "date": d,
            "name": norm_name(m.group("name")),
            "phone": norm_phone(m.group("phone")), "addr": "",
            "raw_date": m.group("date"), "raw_name": m.group("name").strip(),
        })
    return items, bad


def load_list(path):
    """확장자로 판단해서 택배목록을 읽는다. 반환: (items, unparsed_lines)"""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".xlsx":
        return load_xlsx(path), []
    text = open(path, encoding="utf-8-sig").read()
    if ext in (".csv", ".tsv"):
        return load_delimited(text, os.path.basename(path)), []
    # .txt 등 — 헤더가 있으면 표로, 없으면 자유형식으로
    try:
        return load_delimited(text, os.path.basename(path)), []
    except ValueError:
        return load_freeform(text, os.path.basename(path))
