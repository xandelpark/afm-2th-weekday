"""실장별 전달 리스트를 캘린더에서 다시 만든다 (캘린더가 정답).

  python assign_lists.py [이름 ...]      # 기본: 전 실장

- 모든 캘린더에서 제목에 (M)/(m)/메인. 바로 뒤에 이름(또는 이름예정)이 있는 2027년 일정
- 예식시간·장소·신부·업체(제목 약칭→정식명)·스냅 연회(피로연) 추가 여부
- 같은 날 두 탕이면 시간 검증: 첫 건 종료 = 예식+1h(피로연 추가면 +2h), 둘째 촬영 시작 = 예식-1h
- 결과: ~/Downloads/실장전달_<이름>_2027.txt
"""
import datetime as dt
import os
import re
import sys

import videosheet as V

NAMES = sys.argv[1:] or ["이원준", "김민섭", "김상형", "함지안", "황순원", "박가혜", "송빛날"]
# 개인·가족 캘린더는 공개 저장소에 적지 않는다 — 한 줄에 하나씩 skip_calendars.txt(깃 제외)에
_SKIP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skip_calendars.txt")
SKIP = {"ko.south_korea#holiday@group.v.calendar.google.com"} | (
    {l.strip() for l in open(_SKIP_FILE) if l.strip()} if os.path.exists(_SKIP_FILE) else set())
BRAND = [("마웨", "마리안웨딩"), ("마리안", "마리안웨딩"), ("오르비", "오르비아트"), ("파피", "파피루스웨딩"),
         ("화려한", "더화려한날엔"), ("만행", "만원의행복스냅"), ("만디", "만원의행복스냅"), ("베웨", "베라모멘토"),
         ("미엘웨", "미엘라메멘토"), ("메엘웨", "미엘라메멘토"), ("미웨", "미엘라메멘토"), ("메웨", "메이브스냅"),
         ("러브", "러브어바웃"), ("러바웃", "러브어바웃"), ("더소날", "더소중한날"), ("더소중", "더소중한날"),
         ("위드", "위드유"), ("마론", "마론스냅")]
VENUE_NOTES = {"리버사이드": "박슬기 작가 주) 플라워샤워 때 역광이 매우 심한 곳입니다. 플래시 사용 필수!"}


def clean_hall(h):
    h = re.sub(r"\s+", " ", h).strip(" /")
    h = re.sub(r"\s*/\s*", " / ", h)
    return h


DEAD = re.compile(r"\s*(예약|장소|날짜)?(변경|취소)|\s*얘약취소")


def field(b, *labels):
    for lab in labels:
        m = re.search(lab + r"[^\n:]*[:：]?[ \t]*([^\n]+)", b)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return ""


NO = re.compile(r"^\s*(no|n\b|x\b|무|아니|없|해당\s*없|추가\s*안|추가하지|하지\s*않|미입력|-|$)", re.I)
YES = re.compile(r"^\s*(yes|y\b|o\b|유|예|네|추가|있|0\b)", re.I)


def opt(b, *labels):
    """첫 번째로 나오는 해당 옵션 칸(=스냅 칸)의 값으로 유무 판정. True/False/None(칸 없음)"""
    for lab in labels:
        m = re.search(lab + r"[^\n:：]*[:：][ \t]*([^\n]*)", b)
        if m:
            v = m.group(1).strip()
            if "스냅" in v or "영상" in v:
                return bool(re.search(r"스냅\s*유", v))
            if NO.match(v):
                return False
            if YES.match(v):
                return True
            return False
    return None


def hm(s):
    """'오후 2시 30분' '14:00' '12시30분' → 분. 못 읽으면 None"""
    s = s.replace(" ", "")
    m = re.search(r"(\d{1,2})(?::|시|;)(\d{2})?", s)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    if ("오후" in s or "pm" in s.lower()) and h < 12:
        h += 12
    if h < 8:
        h += 12
    return h * 60 + mi


def fmt(mins):
    h, m = divmod(mins, 60)
    ap = "오전" if h < 12 else "오후"
    h12 = h if h <= 12 else h - 12
    return f"{ap} {h12}:{m:02d}"


def title_time(t):
    s = t.split(".")[0].replace("시", "")
    try:
        h = int(s[:2]) if len(s) == 4 else int(s[0]) if len(s) == 3 else int(s)
        mi = int(s[-2:]) if len(s) >= 3 else 0
    except ValueError:
        return None
    return (h + 12 if h < 8 else h) * 60 + mi


def main():
    _, cal = V.services()
    cals = [c["id"] for c in cal.calendarList().list(maxResults=250).execute()["items"] if c["id"] not in SKIP]
    for name in NAMES:
        seen, rows = set(), []
        for cid in cals:
            r = cal.events().list(calendarId=cid, singleEvents=True, maxResults=500, q=name,
                                  timeMin="2027-01-01T00:00:00+09:00", timeMax="2028-01-01T00:00:00+09:00").execute()
            for e in r.get("items", []):
                t = e.get("summary", "")
                m = re.search(r"(\((?:M|m)\)\s*|메인\.)" + name + r"(예정)?", t)
                if not m or DEAD.match(t) or "취소" in t[:10]:
                    continue
                d = (e["start"].get("date") or e["start"].get("dateTime"))[:10]
                key = (d, re.sub(r"\s", "", t))
                if key in seen:
                    continue
                seen.add(key)
                b = V.html_text(e.get("description", "") or "")
                when = hm(field(b, "행사시간", "행사 시간", "예식\\s*시작\\s*시간", "예식시작시간", "시작시간",
                                "촬영시간", "본식\\(시작\\)시간", "행사날짜"))
                if when is None and title_time(t):
                    when = title_time(t) + 90
                hall = field(b, "베뉴명", "장소\\s*\\(웨딩홀", "장소명", "장  소  명", "예식장소", "예식장 및 홀",
                             "예식장", "결혼식장 이름", "촬영장소", "행사장소")
                bride = field(b, "신부님 성함", "신부님성함", "예약자 성함", "예약자 이름") or ""
                if not bride:
                    segs = [x for x in t.split("/")[0].split(".") if re.fullmatch(r"[가-힣]{2,5}(\([가-힣]+\))?", x)]
                    bride = segs[-1] if segs else ""
                code = t.split(".")[1] if "." in t else ""
                brand = next((v for k, v in BRAND if code.startswith(k)), code)
                after = t[m.end():m.end() + 6]
                first2bu = re.search(r"2부 or 연회장 추가[^\n]*[:：]\s*([^\n]*)", b)  # 첫 번째 = 스냅 칸
                party = bool(re.match(r"\((피|피추)", after)) or bool(
                    re.search(r"스냅\s*(영상\s*)?피로연\s*추가\s*\d|스냅 피로연 추가[^\n]*[:：]\s*Y\b", b)) or bool(
                    first2bu and re.match(r"\s*(yes|o|y)\b", first2bu.group(1), re.I))
                if not party:
                    party = bool(opt(b, r"폐백\s*및\s*피로연", r"폐백or피로연", r"연회 및 폐백", r"피로연 진행여부", r"스냅 피로연 추가"))
                pyebaek = bool(opt(b, r"(?<!DVD)\s폐백 추가", r"^폐백 추가", r"스냅 폐백 추가", r"폐백 진행여부", r"폐백 추가여부",
                                   r"폐백\s*및\s*피로연", r"폐백or피로연", r"연회 및 폐백"))
                makeup = bool(opt(b, r"메이크업샵 촬영", r"메이크업샵촬영", r"메이크업샵 추가", r"본식스냅\) 메이크업샵", r"메이크업샵 촬영 추가"))
                if re.search(r"\((폐|폐추)", after):
                    pyebaek = True
                notes = [v for k, v in VENUE_NOTES.items() if k in t or k in hall]
                if party:
                    notes.append("피로연(연회) 촬영 있음 — 예식 후 약 2시간까지")
                if re.search(r"초상권", t):
                    notes.append("초상권 비동의 — SNS·홈페이지 게시 금지")

                hall = clean_hall(hall)
                if re.match(r"^(지하|\d)", hall):  # 층·홀만 적혀 있으면 제목의 예식장 이름을 앞에 붙임
                    segs = t.split("/")[0].split(".")
                    if bride and re.sub(r"\s", "", bride) in segs:
                        hall = f"{segs[segs.index(re.sub(chr(92)+'s', '', bride)) - 1]} / {hall}"
                rows.append(dict(d=d, when=when, hall=clean_hall(hall) or t.split(".")[-1], bride=re.sub(r"\s", "", bride),
                                 brand=brand, party=party, pyebaek=pyebaek, makeup=makeup, notes=notes, title=t,
                                 out=(fmt(when - 60 - (60 if makeup else 0)) if when else "")))
        rows.sort(key=lambda x: (x["d"], x["when"] or 0))
        # 두 탕 검증
        warn = []
        for a, b in zip(rows, rows[1:]):
            if a["d"] == b["d"] and a["when"] and b["when"]:
                end = a["when"] + (120 if (a["party"] or a["pyebaek"]) else 60)
                start = b["when"] - (120 if b["makeup"] else 60)
                gap = start - end
                pass  # 이동 여유는 내부 점검용(아래 warn) — 실장 전달문에는 안 씀
                if gap < 60:
                    warn.append(f"{a['d']} {a['bride']}→{b['bride']} 여유 {gap}분")
        brands = "·".join(dict.fromkeys(x["brand"] for x in rows))
        out = [f"[{brands}] 2027년 촬영 일정 ({name} 실장님)", ""]
        for i, x in enumerate(rows, 1):
            wd = "월화수목금토일"[dt.date.fromisoformat(x["d"]).weekday()]
            out.append(f"{i}) {x['d'].replace('-', '.')}({wd}) {fmt(x['when']) if x['when'] else '시간 확인 필요'}")
            out.append(f"   장소: {x['hall']}")
            out.append(f"   신부님: {x['bride']}")
            out.append(f"   업체: {x['brand']}")
            if x["pyebaek"]:
                x["notes"].insert(0, "폐백 촬영 있음")
            if x["makeup"]:
                x["notes"].insert(0, "메이크업샵 촬영 있음 — 샵 시간 따로 확인")
            for n in x["notes"]:
                out.append(f"   ※ {n}")
            out.append("")
        path = os.path.expanduser(f"~/Downloads/실장전달_{name}_2027.txt")
        open(path, "w").write("\n".join(out))
        print(f"{name}: {len(rows)}건, 연회 {sum(x['party'] for x in rows)}건 → {path}" + (f"  ⚠ {warn}" if warn else ""))


if __name__ == "__main__":
    main()
