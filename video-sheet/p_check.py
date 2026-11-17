"""이번 주말(토·일) 촬영 캘린더 제목 점검 → 핸드폰 알림(ntfy).

매주 금요일 19:00 launchd(com.marian.p-check)가 실행한다.
  python p_check.py          # 점검 + 알림
  python p_check.py --dry    # 출력만

점검: 작가 이름 뒤 p 누락, 제목 끝 cm(잔금안내 c·통화 m) 누락, 업체 오타.
'예정'은 대부분 확정이라 지적하지 않는다. 캘린더는 읽기만 한다.
알림에는 신부님 이름을 넣지 않는다(외부 서버를 거치므로) — 날짜·시간·업체·장소·작가만.
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
SKIP = re.compile(r"\s*(예약변경|날짜변경|장소변경|예약취소)")
ROLE = re.compile(r"\(([MSDImsdi])\)\s*([^().]*)")
OWNER = "박슬기"


def weekend():
    today = dt.date.today()
    sat = today + dt.timedelta((5 - today.weekday()) % 7)
    return sat, sat + dt.timedelta(2)


def check(title):
    probs = []
    for role, raw in ROLE.findall(title):
        raw = raw.strip()
        if not raw:
            continue
        name = re.split(r"->|>", raw)[-1].replace("✔️", "").strip()
        if "예정" in name:  # 예정 = 대부분 확정, 지적 안 함
            continue
        m = re.match(r"[가-힣]{2,4}", name)
        if not m or m.group(0) == "미정":
            continue
        n = m.group(0)
        rest = name[len(n):]
        if not rest.startswith("p") and not rest.startswith("P"):
            probs.append(f"({role}){n}" + (" (사장님)" if n == OWNER else ""))
    if not re.search(r"\.\s*cm\b", title):
        probs.append("cm 없음")
    if "마뭬" in title:
        probs.append("'마뭬' 오타")
    if re.search(r"[가-힣]\.p", title):
        probs.append("'.p' 위치")
    return probs


def main():
    dry = "--dry" in sys.argv
    sat, mon = weekend()
    _, cal = V.services()
    lines = []
    for cid, lab in V.CALENDARS:
        items = cal.events().list(
            calendarId=cid, singleEvents=True, orderBy="startTime", maxResults=500,
            timeMin=f"{sat}T00:00:00+09:00", timeMax=f"{mon}T00:00:00+09:00").execute()["items"]
        for e in items:
            t = e.get("summary", "")
            if SKIP.match(t) or "취소" in t:
                continue
            probs = check(t)
            if probs:
                ds = dt.date.fromisoformat(e["start"].get("dateTime", e["start"].get("date"))[:10])
                d = f"{ds.month}/{ds.day}"
                parts = t.split(".")
                last = max([i for i, p in enumerate(parts) if ROLE.search(p)], default=1)
                place = parts[last + 1] if last + 1 < len(parts) else ""
                lines.append(f"{d} {lab} {parts[0]} {place[:10]}: {', '.join(probs)}")
    head = f"{sat.month}/{sat.day}·{sat.month if (sat + dt.timedelta(1)).month == sat.month else mon.month}/{(sat + dt.timedelta(1)).day} 일정 점검"
    body = "\n".join(lines) if lines else "p·cm 빠진 일정 없음 ✅"
    msg = f"{head} — {len(lines)}건\n{body}" if lines else f"{head}\n{body}"
    print(msg)
    os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
    with open(os.path.join(HERE, "logs", "p_check.log"), "a") as f:
        f.write(f"\n[{dt.datetime.now():%Y-%m-%d %H:%M}]\n{msg}\n")
    if dry:
        return
    q = urllib.parse.urlencode({"title": f"{head} {len(lines)}건", "tags": "calendar"})
    req = urllib.request.Request(f"https://ntfy.sh/{NTFY_TOPIC}?{q}", data=body.encode(), method="POST")
    urllib.request.urlopen(req, timeout=30)
    subprocess.run(["osascript", "-e", f'display notification "{len(lines)}건 — 핸드폰 확인" with title "일정 p 점검"'],
                   check=False)


if __name__ == "__main__":
    main()
