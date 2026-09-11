"""로그인된 Chrome 을 띄워 시트 체크박스를 '진짜로' 클릭한다.

왜 API 로 안 쓰고 브라우저를 쓰나:
  Sheets API 로 값을 쓰면 구글이 '사람이 편집했다' 이벤트를 만들지 않는다.
  시트에 붙은 Make 자동화는 그 편집 이벤트를 보고 Z열(발송예정일)을 채우고 문자를 예약하므로,
  API 로 Y만 켜면 체크박스는 켜지지만 Make 가 돌지 않아 문자가 나가지 않는다.
  그래서 사람이 마우스로 누르는 것과 물리적으로 같은 클릭을 보낸다.

Chrome 136+ 는 기본 프로필에 --remote-debugging-port 를 허용하지 않으므로,
쿠키만 복사한 별도 프로필로 디버깅용 Chrome 을 따로 띄운다. 사용자의 평소 Chrome 은 건드리지 않는다.
"""
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request

import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC_PROFILE = os.path.expanduser("~/Library/Application Support/Google/Chrome")
PORT = 9222


class CDP:
    """필요한 것만 담은 Chrome DevTools Protocol 클라이언트."""

    def __init__(self, port=PORT, match=None):
        self._id = 0
        tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
        pages = [t for t in tabs if t["type"] == "page"]
        if not pages:
            raise RuntimeError("디버깅 Chrome 에 페이지가 없습니다.")
        page = next((t for t in pages if match and match in t["url"]), None) or pages[0]
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"],
                                              suppress_origin=True, timeout=60)

    def send(self, method, **params):
        self._id += 1
        self.ws.send(json.dumps({"id": self._id, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self._id:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m.get("result", {})

    def goto(self, url, wait=7):
        self.send("Page.enable")
        self.send("Page.navigate", url=url)
        time.sleep(wait)

    def js(self, expr):
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True,
                      awaitPromise=True)
        return r.get("result", {}).get("value")

    def click(self, x, y):
        self.send("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y,
                  button="left", clickCount=1, buttons=1)
        time.sleep(0.05)
        self.send("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y,
                  button="left", clickCount=1, buttons=0)

    def front(self):
        self.send("Page.bringToFront")

    # --- 시트 전용 ---

    def name_box(self):
        """현재 선택된 칸 이름 (예: 'Y1960')."""
        return self.js("(document.querySelector('#t-name-box')||{}).value")

    def active_cell_rect(self):
        """선택된 칸의 화면 좌표 [x0,y0,x1,y1]. 캔버스 렌더링이라 테두리 오버레이로 역산한다."""
        r = self.js("""(()=>{let x0=1e9,y0=1e9,x1=-1,y1=-1;
          document.querySelectorAll('.active-cell-border').forEach(e=>{
            const b=e.getBoundingClientRect();
            x0=Math.min(x0,b.left);y0=Math.min(y0,b.top);
            x1=Math.max(x1,b.right);y1=Math.max(y1,b.bottom);});
          return x1<0?null:JSON.stringify([x0,y0,x1,y1]);})()""")
        return json.loads(r) if r else None

    def logged_in_as(self):
        return self.js("""(()=>{const a=document.querySelector('a[aria-label*="Google 계정"]');
          return a?a.getAttribute('aria-label'):null})()""")


def debugger_alive(port=PORT):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
        return True
    except (urllib.error.URLError, OSError):
        return False


def launch(profile_dir, port=PORT, url="about:blank"):
    """쿠키만 복사한 프로필로 디버깅 Chrome 을 띄운다. 평소 Chrome 과 별개로 돈다."""
    if debugger_alive(port):
        return False
    os.makedirs(os.path.join(profile_dir, "Default"), exist_ok=True)
    for rel in ("Local State", "Default/Preferences", "Default/Cookies",
                "Default/Cookies-journal"):
        src = os.path.join(SRC_PROFILE, rel)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(profile_dir, rel))
    ls = os.path.join(SRC_PROFILE, "Default/Local Storage")
    if os.path.isdir(ls):
        shutil.copytree(ls, os.path.join(profile_dir, "Default/Local Storage"),
                        dirs_exist_ok=True)
    subprocess.Popen(
        [CHROME, f"--user-data-dir={profile_dir}", f"--remote-debugging-port={port}",
         "--no-first-run", "--no-default-browser-check", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(30):
        time.sleep(1)
        if debugger_alive(port):
            return True
    raise RuntimeError("디버깅 Chrome 이 뜨지 않았습니다.")


def focus_cell(cdp, spreadsheet_id, row, col="Y", gid=0):
    """해당 칸으로 이동하고 칸 박스 [x0,y0,x1,y1] 을 돌려준다. (박스, None) 또는 (None, 사유)."""
    cdp.goto(f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
             f"/edit?gid={gid}&range={col}{row}")
    if cdp.name_box() != f"{col}{row}":
        return None, f"칸 선택 실패({cdp.name_box()})"
    box = cdp.active_cell_rect()
    if not box:
        return None, "좌표 못 찾음"
    return box, None


def set_checked(cdp, spreadsheet_id, row, is_checked_fn, col="Y", gid=0, settle=1.5):
    """체크박스를 '켜진 상태'로 만든다.

    한 번 클릭할 때마다 토글되므로 **현재 상태를 실제로 읽어서 필요한 만큼만** 누른다.
    꺼져 있으면 1번, 이미 켜져 있으면 아예 누르지 않는다.
    (무조건 2번 누르면 꺼져 있던 칸이 도로 꺼진다 — 실제로 그렇게 사고가 났다.)

    행 높이가 큰 칸은 체크박스가 세로 가운데가 아니라 **아래쪽에 그려진다.**
    칸 가운데를 누르면 빈 공간이라 아무 일도 안 일어나므로 후보 지점을 차례로 시도한다.

    is_checked_fn: 시트에서 현재 Y값을 읽어오는 함수 (API 조회)
    """
    box, err = focus_cell(cdp, spreadsheet_id, row, col, gid)
    if err:
        return False, err
    if is_checked_fn(row):
        return True, None
    cx = (box[0] + box[2]) / 2
    # 가운데 → 아래쪽 → 위쪽 (세로 정렬이 가운데/아래/위 어느 쪽이든 잡히도록)
    for cy in ((box[1] + box[3]) / 2, box[3] - 12, box[1] + 12):
        cdp.click(cx, cy)
        time.sleep(settle)
        if is_checked_fn(row):
            return True, None
    return False, "클릭해도 켜지지 않음 (체크박스 위치 못 찾음)"
