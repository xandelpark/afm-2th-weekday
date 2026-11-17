"""드라이브 폴더 이름(날짜+이름)으로 캘린더를 찾아 장소와 본식/리허설을 알려 준다.

  python venue_lookup.py "1101 이나라" "261014_김경민" "10.22 김성희"

캘린더에는 '리허설'이라고 적지 않는다. 제목 끝 표시와 장소로 가른다.
  .cm / .c         → 본식
  .m               → 리허설 (야외·스튜디오)
  장소가 공원·궁·스튜디오 등 → 끝 표시가 없어도 리허설
  .m 인데 예식장 이름 → 애매하므로 사람에게 묻는다
"""
import datetime as dt
import json
import re
import sys

from videosheet import CALENDARS, html_text, services

GALLERY = "/Users/craw/marianwedding-site/src/data/gallery.json"
OUTDOOR = re.compile(r"스튜디오|촬영장|공원|궁|잠수교|반포대교|행궁동|습지|민속촌|제주|한옥")
HALL = re.compile(r"웨딩|컨벤션|호텔|예식|아트홀|채플|wi", re.I)
DEAD = re.compile(r"(예약|날짜)?(변경|취소)")
NO_PHOTO = "초상권"  # 금지·비동의·미동의·x 등 적는 법이 제각각이라 글자만 있어도 멈춘다


def parse_folder(folder, today):
    """'260905.이가현신부님10서준' → (날짜, 이름). 날짜 바로 뒤 한글이 손님 이름이다.
    그 뒤 숫자·이름은 리터칭 장수와 리터처라 버린다. 연도가 없으면 오늘 이전 가장 가까운 날짜."""
    s = re.sub(r"본식|리허설", " ", folder).strip()
    m = re.match(r"\s*(?:(\d{8}|\d{6}|\d{4})|(?:(\d{2,4})[.\-/년 ]+)?(\d{1,2})[.\-/월 ]+(\d{1,2})일?)", s)
    name = re.match(r"[\s._\-]*([가-힣]+)", s[m.end():]) if m else None
    if not name:
        return None, None
    name = re.sub(r"(신부|신랑)?님$", "", name.group(1))
    name = re.sub(r"(신부|신랑)$", "", name)
    if m.group(1):
        d = m.group(1)
        y, mo, da = (d[:-4] or None), int(d[-4:-2]), int(d[-2:])
    else:
        y, mo, da = m.group(2), int(m.group(3)), int(m.group(4))
    if y:
        return dt.date(int(y) + (2000 if len(y) == 2 else 0), mo, da), name
    day = dt.date(today.year, mo, da)
    return (day if day <= today else day.replace(year=today.year - 1)), name


def split_title(title, name):
    """제목에서 이름 칸을 찾아 바로 앞 칸을 장소로 읽는다. 예식장·신부 순서로 적혀 있다."""
    # 작가 메모 (피추"/인추") 안의 / 에서 잘리면 뒤의 이름을 놓친다. 먼저 걷어 낸다.
    title = re.sub(r"\([^()]*/[^()]*\)", "", title)
    segs = [x.strip() for x in title.split("/")[0].split(".")]
    for i, seg in enumerate(segs):
        if i >= 2 and name in seg:
            return re.sub(r"^[pP](?=\S)", "", segs[i - 1]).strip(), segs
    return None, segs


def classify(venue, segs):
    """(본식|리허설|None). None 이면 사람에게 물어야 한다."""
    tail = next((x for x in reversed(segs) if x.lower() in ("cm", "c", "m")), "").lower()
    if tail in ("cm", "c"):
        return "본식"
    if OUTDOOR.search(venue) and not HALL.search(venue):
        return "리허설"
    if tail == "m":
        return None
    return "본식" if HALL.search(venue) else None


def gallery_match(venue, kind):
    """이미 있는 장소 이름 후보. 같은 곳이 둘로 갈라지지 않도록 사람이 대조한다."""
    g = json.load(open(GALLERY))
    keys = ["venues"] if kind == "본식" else ["outdoorPlaces", "studioPlaces"]
    names = {x["name"] for k in keys for x in g[k]}
    norm = lambda s: re.sub(r"[\s·]", "", s).lower()
    v = norm(venue)
    return sorted(n for n in names if norm(n) in v or v in norm(n))


def lookup(cal, folder, today):
    day, name = parse_folder(folder, today)
    if not day:
        return dict(folder=folder, status="이름을 못 읽음")
    hits = []
    for cid, label in CALENDARS:
        r = cal.events().list(
            calendarId=cid, singleEvents=True, maxResults=250,
            timeMin=f"{day}T00:00:00+09:00",
            timeMax=f"{day + dt.timedelta(days=1)}T00:00:00+09:00").execute()
        for e in r.get("items", []):
            title = e.get("summary", "")
            if e.get("status") == "cancelled" or DEAD.match(title):
                continue
            venue, segs = split_title(title, name)
            if venue:
                hits.append((label, title, venue, segs, html_text(e.get("description", ""))))
    base = dict(folder=folder, date=str(day), name=name)
    if not hits:
        return dict(base, status="캘린더에 없음")
    if len(hits) > 1:
        return dict(base, status="같은 날 같은 이름 여러 건", titles=[h[1] for h in hits])
    label, title, venue, segs, body = hits[0]
    kind = classify(venue, segs)
    out = dict(base, calendar=label, title=title, venue=venue, kind=kind,
               status="확인 필요" if kind is None else "확인")
    if kind:
        out["new_folder"] = f"{kind}_{venue}"
        out["gallery_candidates"] = gallery_match(venue, kind)
    if NO_PHOTO in title:
        out["status"] = "초상권 금지 — 올리면 안 됨"
    elif NO_PHOTO in body:
        # 제목에 안 옮겨 적힌 비동의가 있다 (2026-11-02 마리안 10건). 사람이 읽고 정한다.
        i = body.index(NO_PHOTO)
        out["status"] = "예약 글에 초상권 언급 — 확인 필요"
        out["consent_note"] = " ".join(body[max(0, i - 30):i + 40].split())
    elif label != "마리안웨딩":
        out["status"] = "오르비 일정 — 확인 필요"
    return out


def main():
    _, cal = services()
    today = dt.date.today()
    print(json.dumps([lookup(cal, f, today) for f in sys.argv[1:]], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
