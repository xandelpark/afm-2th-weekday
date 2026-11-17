"""매주 월요일 — 이번 주말 잔금 입금 확인하라는 알림 → 핸드폰(ntfy) + 맥 알림.

매주 월요일 10:00 launchd(com.marian.balance-remind)가 실행한다.
  python balance_remind.py          # 알림
  python balance_remind.py --dry    # 출력만

이번 주 토·일 마리안웨딩(schedulemanager05 + 대표님 psk1397의 마웨 일정)·오르비아트 예약 건수,
제목에 카드결제 표시된 건수만 센다. 고객 이름은 알림에 넣지 않는다(ntfy 는 외부 서버).
캘린더는 읽기만 한다.
"""
import datetime as dt
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

import videosheet as V
from iphone_check import NTFY_TOPIC

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = re.compile(r"\s*(예약변경|날짜변경|장소변경|예약취소|얘약취소)")
CALS = [("schedulemanager05@gmail.com", "마웨"), ("psk1397@gmail.com", "마웨"), ("orbiart01@gmail.com", "오르비")]


def this_weekend(today=None):
    today = today or dt.date.today()
    sat = today + dt.timedelta((5 - today.weekday()) % 7)
    return sat, sat + dt.timedelta(2)


def main():
    dry = "--dry" in sys.argv
    day = next((a.split("=")[1] for a in sys.argv if a.startswith("--date=")), None)
    sat, mon = this_weekend(dt.date.fromisoformat(day) if day else None)
    _, cal = V.services()
    cnt = {"마웨": 0, "오르비": 0}
    card = {"마웨": 0, "오르비": 0}
    seen = set()
    for cid, lab in CALS:
        res = cal.events().list(calendarId=cid, singleEvents=True, maxResults=250,
                                timeMin=f"{sat}T00:00:00+09:00", timeMax=f"{mon}T00:00:00+09:00").execute()
        for e in res.get("items", []):
            t = e.get("summary", "")
            if SKIP.match(t):
                continue
            if cid == "psk1397@gmail.com" and ".마웨." not in t:
                continue   # 대표님 캘린더는 마웨 예약 일정만
            if lab == "마웨" and ".마웨." not in t:
                continue
            if lab == "오르비" and ".오르비." not in t:
                continue
            key = re.sub(r"\s+", "", t.split("/")[0])
            if key in seen:
                continue
            seen.add(key)
            cnt[lab] += 1
            if "카드결제" in t:
                card[lab] += 1
    sun = sat + dt.timedelta(1)
    head = f"잔금 입금 확인 — 이번 주말 {sat.month}/{sat.day}(토)·{sun.month}/{sun.day}(일)"
    body = (f"마리안웨딩 {cnt['마웨']}건(카드결제 {card['마웨']}) · 오르비아트 {cnt['오르비']}건\n"
            "통장 파일 2개(마리안 법인통장 · 오르비 신한 601181) 받아서 Claude 에게 \"이번주말 입금확인\" 요청하기")
    print(head + "\n" + body)
    os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
    with open(os.path.join(HERE, "logs", "balance_remind.log"), "a") as f:
        f.write(f"\n[{dt.datetime.now():%Y-%m-%d %H:%M}] {head}\n{body}\n")
    if dry:
        return
    q = urllib.parse.urlencode({"title": head, "tags": "moneybag"})
    urllib.request.urlopen(urllib.request.Request(f"https://ntfy.sh/{NTFY_TOPIC}?{q}", data=body.encode(), method="POST"),
                           timeout=30)
    subprocess.run(["osascript", "-e", f'display notification "{cnt["마웨"]}+{cnt["오르비"]}건 — 통장 파일 받아서 확인" with title "잔금 입금 확인"'],
                   check=False)


if __name__ == "__main__":
    main()
