"""영상일정관리(이지연) 시트 자동 채우기.

마리안웨딩·오르비아트 캘린더에서 영상 촬영자 (D) 가 붙은 본식만 골라
날짜별로 미리 만들어 둔 빈 줄의 C~I 열을 채운다.
편집자(K)는 직원 작가(STAFF)가 찍은 건만 그 사람으로 채우고,
나머지 편집자·현재상태(J)·발송 쪽(L~O)은 건드리지 않는다.

  python videosheet.py auth              # 구글 승인 1회 (시트 + 캘린더 읽기)
  python videosheet.py run [--dry]       # 지난 채움 이후 ~ 어제까지 채우고, 직전 2주 변경 점검
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_PATH = os.path.join(HERE, "token.json")
CLIENT_PATH = os.path.join(HERE, "client_secret.json")
LOG_DIR = os.path.join(HERE, "logs")
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar.readonly",
]
SPREADSHEET_ID = "1JOMcwejeub5rUc62bes0DuaHeVEzuqmEore-cgqGFtw"
SHEET = "Sheet1"
SHEET_GID = 454626065
CALENDARS = [("orbiart01@gmail.com", "오르비"), ("schedulemanager05@gmail.com", "마리안웨딩")]
CHECK_DAYS = 14  # 이미 채운 줄 중 캘린더와 다시 맞춰 볼 기간
# 직원 작가 — 자기가 찍은 건 자기가 편집한다. 그 외 편집자는 사장님이 정한다.
STAFF = {"노시진", "유진환", "이지연", "배지현", "김희채", "박혜지", "김재형"}


# ---------- 구글 연결 ----------

def creds():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    c = None
    if os.path.exists(TOKEN_PATH):
        c = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    if c and c.valid:
        return c
    if c and c.expired and c.refresh_token:
        c.refresh(Request())
    else:
        flow = InstalledAppFlow.from_client_secrets_file(CLIENT_PATH, SCOPES)
        c = flow.run_local_server(port=0, prompt="consent", open_browser=False,
                                   authorization_prompt_message="AUTH_URL {url}")
    with open(TOKEN_PATH, "w") as f:
        f.write(c.to_json())
    os.chmod(TOKEN_PATH, 0o600)
    return c


def services():
    from googleapiclient.discovery import build
    c = creds()
    return (build("sheets", "v4", credentials=c, cache_discovery=False),
            build("calendar", "v3", credentials=c, cache_discovery=False))


# ---------- 캘린더 ----------

def html_text(s):
    s = re.sub(r"</td>\s*<td[^>]*>", " : ", s or "")
    s = re.sub(r"<br\s*/?>|</p>|</tr>|</div>", "\n", s)
    s = re.sub(r"</?[a-zA-Z][^<>]*>", "", s)  # 진짜 태그만 (본문의 '<<<<<' 는 남긴다)
    return html.unescape(s).replace("\xa0", " ")


def field(text, label):
    """'라벨 : 값' 한 줄이거나, 라벨 다음 줄에 값이 오는 두 양식 모두 읽는다."""
    m = re.search(rf"{label}[ \t]*:[ \t]*([^\n]*)", text)
    if m and m.group(1).strip():
        return m.group(1).strip()
    m = re.search(rf"{label}[ \t]{{2,}}([^\n]+)", text)  # '라벨  값' (콜론 없이 칸 띄움)
    if m:
        return m.group(1).strip()
    m = re.search(rf"(?m)^[ \t]*{label}[ \t]*\n+[ \t]*([^\n]+)", text)
    return m.group(1).strip() if m else ""


def clean_phone(raw):
    """번호만 뽑는다. '->' 로 고쳐 적었으면 고친 번호를 쓴다."""
    nums = re.findall(r"01[0-9][\s\-.]?\d{3,4}[\s\-.]?\d{4}", raw)
    if not nums:
        return raw.strip()
    return nums[-1] if "->" in raw else nums[0]


def time_key(t):
    m = re.match(r"(\d+)", t or "")
    if not m:
        return 9999
    n = m.group(1)
    if "시" in t.split("(")[0] or len(n) <= 2:
        h, mi = int(n), 0
    else:
        h, mi = int(n[:-2]), int(n[-2:])
    if h < 9:
        h += 12
    return h * 60 + mi


def title_parts(title):
    segs = [x.strip() for x in title.split(".")]
    i = 2
    while i < len(segs) and (segs[i].startswith("(") or segs[i] == "테스트"):
        i += 1
    name = segs[i + 1] if i + 1 < len(segs) else ""
    d = re.search(r"\([dD]\)\s*([가-힣]{2,4})", title)
    return segs[0], name, d.group(1) if d else ""


def wanted(title):
    t = title.strip()
    if re.match(r"(예약변경|날짜변경|예약취소)", t):
        return False
    if not re.search(r"\([dD]\)", t):
        return False
    return not t.endswith(".m")  # 야외·데이트 제외


def fetch(cal, start, end):
    """[start, end] (날짜 포함) 사이의 본식 (D) 건."""
    out = []
    for cid, label in CALENDARS:
        token = None
        while True:
            r = cal.events().list(
                calendarId=cid, singleEvents=True, maxResults=250, pageToken=token,
                timeMin=f"{start}T00:00:00+09:00",
                timeMax=f"{end + dt.timedelta(days=1)}T00:00:00+09:00").execute()
            for e in r.get("items", []):
                title = e.get("summary", "")
                if e.get("status") == "cancelled" or not wanted(title):
                    continue
                day = (e["start"].get("date") or e["start"].get("dateTime", ""))[:10]
                text = html_text(e.get("description", ""))
                t, tname, d = title_parts(title)
                bride = field(text, "신부님 성함") or tname
                if label == "오르비":
                    raw_phone = field(text, "신부님 연락처")
                    email = field(text, "이메일")
                else:
                    after = text.split("신부님 성함", 1)[-1]
                    raw_phone = field(after, "전화 번호")
                    email = field(text, "이메일주소")
                found = re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", email or text)  # 칸이 없으면 본문 첫 메일
                email = found[0] if found else ""
                phone = clean_phone(raw_phone)
                note = raw_phone.replace(phone, "").strip(" -<>")
                out.append(dict(date=day, cal=label, title=title, time=t, d=d,
                                bride=bride, phone=phone, email=email, note=note))
            token = r.get("nextPageToken")
            if not token:
                break
    out.sort(key=lambda e: (e["date"], 0 if e["cal"] == "오르비" else 1, time_key(e["time"])))
    return out


# ---------- 시트 ----------

def read_sheet(sh):
    v = sh.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID, range=f"{SHEET}!A1:O").execute()["values"]
    rows = []
    for i, r in enumerate(v):
        r = r + [""] * (15 - len(r))
        rows.append((i + 1, r))
    return rows


def norm(s):
    return re.sub(r"[\s:]", "", s or "")


def same_person(sheet_name, bride):
    a = norm(sheet_name)
    parts = [p for p in re.split(r"[()/]", norm(bride)) if p]
    return bool(a) and any(p in a or a in p for p in parts)


def is_blank(r):
    return not any(str(x).strip() for x in r[2:12])


def insert_rows(sh, after_row, n):
    """after_row 바로 아래에 n 줄 넣고 날짜·요일(A:B)과 체크박스(M) 를 위 줄에서 복사."""
    req = [{"insertDimension": {"range": {"sheetId": SHEET_GID, "dimension": "ROWS",
                                          "startIndex": after_row, "endIndex": after_row + n},
                                "inheritFromBefore": True}}]
    for c0, c1 in ((0, 2), (12, 13)):
        req.append({"copyPaste": {
            "source": {"sheetId": SHEET_GID, "startRowIndex": after_row - 1, "endRowIndex": after_row,
                       "startColumnIndex": c0, "endColumnIndex": c1},
            "destination": {"sheetId": SHEET_GID, "startRowIndex": after_row,
                            "endRowIndex": after_row + n, "startColumnIndex": c0, "endColumnIndex": c1},
            "pasteType": "PASTE_NORMAL"}})
    sh.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": req}).execute()


# ---------- 실행 ----------

def run(dry=False, today=None):
    today = today or dt.date.today()
    yesterday = today - dt.timedelta(days=1)
    sh, cal = services()
    rows = read_sheet(sh)
    filled_dates = [r[0] for _, r in rows if r[3].strip() and re.match(r"\d{4}-\d{2}-\d{2}", r[0])]
    last = max(d for d in filled_dates if d <= str(yesterday))
    start = max(dt.date.fromisoformat(last) + dt.timedelta(days=1), today - dt.timedelta(days=35))
    check_from = start - dt.timedelta(days=CHECK_DAYS)
    report = [f"[영상시트] {today} 실행 — 채울 기간 {start} ~ {yesterday}"]

    events = fetch(cal, check_from, yesterday)
    by_date = defaultdict(list)
    for e in events:
        by_date[e["date"]].append(e)

    # 1) 직전 기간 점검 — 고치지 않고 알리기만
    changes = []
    d = check_from
    while d < start:
        ds = str(d)
        sheet_rows = [(rn, r) for rn, r in rows if r[0] == ds and r[3].strip()]
        cal_rows = by_date.get(ds, [])
        for rn, r in sheet_rows:
            m = [e for e in cal_rows if same_person(r[3], e["bride"])]
            if not m:
                changes.append(f"  {ds} {r[3]}(행 {rn}) — 캘린더에 (D) 본식으로 없음 (취소·변경?)")
            elif m[0]["d"] and norm(m[0]["d"]) not in norm(r[6]):
                changes.append(f"  {ds} {r[3]}(행 {rn}) — 영상작가 시트 '{r[6]}' → 캘린더 '{m[0]['d']}'")
        for e in cal_rows:
            if not any(same_person(r[3], e["bride"]) for _, r in sheet_rows):
                changes.append(f"  {ds} {e['bride']} ({e['cal']}, {e['d']}) — 캘린더에만 있음")
        d += dt.timedelta(days=1)
    report.append(f"직전 {CHECK_DAYS}일 점검: " + ("바뀐 것 없음" if not changes else f"{len(changes)}건 (시트는 안 고침)"))
    report += changes

    # 2) 새로 채우기
    writes, notes, added = [], [], 0
    for ds in sorted(k for k in by_date if k >= str(start)):
        todo = [e for e in by_date[ds]
                if not any(same_person(r[3], e["bride"]) for _, r in rows if r[0] == ds)]
        if not todo:
            continue
        free = [rn for rn, r in rows if r[0] == ds and is_blank(r)]
        if len(free) < len(todo):
            need = len(todo) - len(free)
            last_rn = max((rn for rn, r in rows if r[0] == ds), default=None)
            if last_rn is None:
                report.append(f"  ! {ds} 날짜 줄이 시트에 없어 {len(todo)}건을 못 넣음")
                continue
            if not dry:
                insert_rows(sh, last_rn, need)
                rows = read_sheet(sh)
                free = [rn for rn, r in rows if r[0] == ds and is_blank(r)]
            report.append(f"  {ds} 빈 줄이 모자라 {need}줄 추가")
        for rn, e in zip(free, todo):
            writes.append({"range": f"{SHEET}!C{rn}:I{rn}",
                           "values": [[e["cal"], e["bride"], e["phone"], e["email"], e["d"], "ㅇ", "ㅇ"]]})
            if e["d"] in STAFF:
                writes.append({"range": f"{SHEET}!K{rn}", "values": [[e["d"]]]})
            added += 1
            if e["note"]:
                notes.append(f"  {ds} {e['bride']} — 번호 메모: {e['note']}")
            if not e["email"]:
                notes.append(f"  {ds} {e['bride']} — 메일 없음")
    if writes and not dry:
        sh.spreadsheets().values().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={"valueInputOption": "RAW", "data": writes}).execute()
    report.append(f"새로 채움: {added}건" + (" (미리보기, 안 씀)" if dry else ""))
    if notes:
        report.append("확인 필요:")
        report += notes
    return "\n".join(report), added, len(changes)


def notify(msg):
    subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "영상시트"'],
                   check=False)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["auth", "run"])
    p.add_argument("--dry", action="store_true")
    a = p.parse_args()
    if a.cmd == "auth":
        services()
        print("승인 완료")
        return
    os.makedirs(LOG_DIR, exist_ok=True)
    try:
        text, added, changed = run(dry=a.dry)
    except Exception as e:  # 실패도 로그와 알림으로 남긴다
        text, added, changed = f"[영상시트] 실패: {e!r}", -1, 0
    print(text)
    with open(os.path.join(LOG_DIR, f"{dt.date.today()}.log"), "a") as f:
        f.write(text + "\n\n")
    if not a.dry:
        notify("실패 — 로그 확인" if added < 0 else f"{added}건 채움 · 점검 {changed}건")


if __name__ == "__main__":
    sys.exit(main())
