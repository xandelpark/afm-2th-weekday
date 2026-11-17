"""지난 주말(토·일) 마리안웨딩 (I) 아이폰스냅 촬영 보고 → 핸드폰 알림(ntfy).

매주 월요일 09:00 launchd(com.marian.iphone-check)가 실행한다.
  python iphone_check.py          # 보고 + 알림
  python iphone_check.py --dry    # 출력만

마리안웨딩 캘린더(schedulemanager05) 제목에 (I)/(i) 가 있는 정상 일정만.
보고: 날짜·시간·장소·신부님·아이폰 작가. 캘린더는 읽기만 한다.
알림은 외부 서버(ntfy.sh)를 거치므로 신부님 이름은 가운데 글자를 가린다(김*정).
전체 이름은 logs/iphone_check.log 에 남긴다.
"""
import datetime as dt
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

import videosheet as V

NTFY_TOPIC = "marian-764ea2de9900"
HERE = os.path.dirname(os.path.abspath(__file__))
CAL = "schedulemanager05@gmail.com"
SKIP = re.compile(r"\s*(예약변경|날짜변경|장소변경|예약취소)")
ROLE = re.compile(r"\(([MSDImsdi])\)\s*([^().]*)")
IPH = re.compile(r"\([Ii]\)\s*([^().]*)")
WD = "월화수목금토일"


def last_weekend(today=None):
    today = today or dt.date.today()
    sat = today - dt.timedelta((today.weekday() - 5) % 7 or 7)
    return sat, sat + dt.timedelta(2)


def clean(name):
    name = re.split(r"->|>", name)[-1].replace("✔️", "").strip()
    m = re.match(r"[가-힣]{2,4}", name)
    return m.group(0) if m else name


def mask(n):
    n = re.sub(r"\d+$", "", n)
    return n if len(n) < 2 else n[0] + "*" + n[2:] if len(n) > 2 else n[0] + "*"


def parse(e):
    t = e.get("summary", "")
    parts = [p.strip() for p in t.split(".")]
    last = max([i for i, p in enumerate(parts) if ROLE.search(p)], default=1)
    place = parts[last + 1] if last + 1 < len(parts) else ""
    bride = parts[last + 2] if last + 2 < len(parts) else ""
    st = e["start"].get("dateTime")
    if st:
        tm = st[11:16]
    else:  # 종일 일정이면 제목 앞 시간(0930, 11시, 130)
        h = parts[0]
        m = re.match(r"(\d{1,2})시", h) or None
        if m:
            tm = f"{int(m.group(1)):02d}:00"
        elif re.fullmatch(r"\d{3,4}", h):
            tm = f"{int(h[:-2]):02d}:{h[-2:]}"
        else:
            tm = h
    d = dt.date.fromisoformat((st or e["start"]["date"])[:10])
    ph = [clean(x) for x in IPH.findall(t) if x.strip()]
    return dict(date=d, time=tm, place=place, bride=bride, iphone=", ".join(ph) or "미정", title=t)


def main():
    dry = "--dry" in sys.argv
    sat, mon = last_weekend()
    _, cal = V.services()
    items = cal.events().list(
        calendarId=CAL, singleEvents=True, orderBy="startTime", maxResults=500,
        timeMin=f"{sat}T00:00:00+09:00", timeMax=f"{mon}T00:00:00+09:00").execute()["items"]
    rows = []
    for e in items:
        t = e.get("summary", "")
        if SKIP.match(t) or "취소" in t or not IPH.search(t):
            continue
        rows.append(parse(e))
    rows.sort(key=lambda r: (r["date"], r["time"]))
    sun = sat + dt.timedelta(1)
    head = f"{sat.month}/{sat.day}·{sun.month}/{sun.day} 아이폰스냅(I)"

    def line(r, full):
        d = r["date"]
        b = r["bride"] if full else mask(r["bride"])
        return f"{d.month}/{d.day}({WD[d.weekday()]}) {r['time']} {r['place']} · {b} · 작가 {r['iphone']}"

    body = "\n".join(line(r, False) for r in rows) if rows else "지난 주말 아이폰스냅 촬영 없음"
    full = "\n".join(line(r, True) for r in rows) if rows else body
    print(f"{head} {len(rows)}건\n{full}")
    os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
    with open(os.path.join(HERE, "logs", "iphone_check.log"), "a") as f:
        f.write(f"\n[{dt.datetime.now():%Y-%m-%d %H:%M}] {head} {len(rows)}건\n{full}\n")
    if dry:
        return
    q = urllib.parse.urlencode({"title": f"{head} {len(rows)}건", "tags": "iphone"})
    req = urllib.request.Request(f"https://ntfy.sh/{NTFY_TOPIC}?{q}", data=body.encode(), method="POST")
    urllib.request.urlopen(req, timeout=30)
    subprocess.run(["osascript", "-e", f'display notification "{len(rows)}건 — 핸드폰 확인" with title "아이폰스냅 보고"'],
                   check=False)


if __name__ == "__main__":
    main()
