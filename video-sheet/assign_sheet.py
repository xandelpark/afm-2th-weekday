"""실장 배정 현황 스프레드시트를 캘린더에서 다시 만든다.

  python assign_sheet.py            # 시트가 없으면 만들고, 있으면 내용을 새로 채움

- 캘린더(마웨·오르비)가 정답이다. 사장님이 직접 바꾼 것도 그대로 반영된다.
- 탭: 요약 / 실장별 탭 / 변경기록(logs/assign_changes.md 내용)
- 시트 ID 는 logs/assign_sheet_id.txt 에 저장해 다음부터 같은 시트를 갱신한다.
"""
import datetime as dt
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "album-ship"))
import sheets  # noqa: E402
import videosheet as V  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ID_FILE = os.path.join(HERE, "logs", "assign_sheet_id.txt")
CHANGES = os.path.join(HERE, "logs", "assign_changes.md")
NAMES = ["황순원", "박가혜", "김민섭", "이원준", "함지안"]
CALS = [("schedulemanager05@gmail.com", "마리안웨딩"), ("orbiart01@gmail.com", "오르비아트")]
START, END = "2027-01-01", "2028-01-01"
DEAD = re.compile(r"\s*(예약|장소|날짜)?(변경|취소)|\s*얘약취소")


def field(body, *labels):
    for lab in labels:
        m = re.search(lab + r"[^\n:]*:?[ \t]*([^\n]+)", body)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return ""


def collect():
    _, cal = V.services()
    rows = {n: [] for n in NAMES}
    for cid, co in CALS:
        tok = None
        while True:
            r = cal.events().list(calendarId=cid, singleEvents=True, orderBy="startTime", maxResults=2500,
                                  pageToken=tok, timeMin=f"{START}T00:00:00+09:00",
                                  timeMax=f"{END}T00:00:00+09:00").execute()
            for e in r.get("items", []):
                t = e.get("summary", "")
                if DEAD.match(t) or "취소" in t[:10]:
                    continue
                for n in NAMES:
                    m = re.search(r"\(([MSDmsdi])\)\s*" + n, t)
                    if not m:
                        continue
                    b = V.html_text(e.get("description", "") or "")
                    d = (e["start"].get("date") or e["start"].get("dateTime"))[:10]
                    segs = t.split("/")[0].split(".")
                    bride = field(b, "신부님 성함", "예약자 성함") or (segs[-1] if segs else "")
                    rows[n].append([
                        d, "월화수목금토일"[dt.date.fromisoformat(d).weekday()], segs[0],
                        field(b, "행사시간", "시작시간", "촬영시간"),
                        co, field(b, "베뉴명", "예식장소", "촬영장소"), re.sub(r"\s", "", bride),
                        {"M": "메인", "S": "서브", "D": "DVD", "I": "아이폰"}.get(m.group(1).upper(), m.group(1)),
                        "초상권X" if re.search(r"초상권", t) else "", t,
                    ])
    return rows


def main():
    cfg = sheets.load_config()
    svc = sheets.service(cfg)
    rows = collect()
    sid = open(ID_FILE).read().strip() if os.path.exists(ID_FILE) else None
    tabs = ["요약"] + NAMES + ["변경기록"]
    if not sid:
        r = svc.spreadsheets().create(body={
            "properties": {"title": "실장 배정 현황", "locale": "ko_KR", "timeZone": "Asia/Seoul"},
            "sheets": [{"properties": {"title": t, "gridProperties": {"frozenRowCount": 1}}} for t in tabs],
        }).execute()
        sid = r["spreadsheetId"]
        open(ID_FILE, "w").write(sid)
    meta = svc.spreadsheets().get(spreadsheetId=sid).execute()
    have = {s["properties"]["title"] for s in meta["sheets"]}
    add = [{"addSheet": {"properties": {"title": t, "gridProperties": {"frozenRowCount": 1}}}} for t in tabs if t not in have]
    if add:
        svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": add}).execute()

    head = ["날짜", "요일", "제목시간(도착)", "예식시간", "업체", "장소/홀", "신부님", "역할", "초상권", "캘린더 제목"]
    data = []
    summ = [["실장", "배정 건수", "첫 일정", "마지막 일정", "갱신 시각"]]
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    for n in NAMES:
        rs = sorted(rows[n])
        data.append({"range": f"'{n}'!A1", "values": [head] + rs})
        summ.append([n, len(rs), rs[0][0] if rs else "", rs[-1][0] if rs else "", now])
    data.append({"range": "'요약'!A1", "values": summ + [[], ["※ 캘린더(마웨·오르비)가 기준입니다. 사장님이 캘린더에서 바꾼 내용이 그대로 반영됩니다."],
                                                         ["※ 다시 채우기: video-sheet/assign_sheet.py"]]})
    ch = [["기록일", "일정", "변경", "누가/이유"]]
    if os.path.exists(CHANGES):
        for line in open(CHANGES):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) == 4 and not cells[0].startswith(("기록일", "---")):
                ch.append(cells)
    data.append({"range": "'변경기록'!A1", "values": ch})
    for t in tabs:
        svc.spreadsheets().values().clear(spreadsheetId=sid, range=f"'{t}'!A1:Z2000").execute()
    svc.spreadsheets().values().batchUpdate(spreadsheetId=sid, body={"valueInputOption": "RAW", "data": data}).execute()
    print(f"https://docs.google.com/spreadsheets/d/{sid}")
    for s in summ[1:]:
        print(s[0], s[1], "건")


if __name__ == "__main__":
    main()
