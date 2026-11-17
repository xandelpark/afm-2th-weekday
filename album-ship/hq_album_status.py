"""Team HQ 보정 기록마다 앨범 진행(상품주소 기입) 여부를 붙여 HQ 에 올린다.

  .venv/bin/python hq_album_status.py          # 계산해서 HQ 에 올림
  .venv/bin/python hq_album_status.py --dry    # 올리지 않고 결과만 출력

보정한 건이 재수정까지 끝나 앨범 제작에 들어갔는지 추적하는 용도다 (인센티브 계산과는 무관).
앨범에 들어갔다는 표시는 웨딩자동화시트 고객정보 탭 AB열(상품주소)에 주소가 적힌 것이다.
예식일 + 신부 이름(뒤 숫자 뗀 것) 으로 시트 행을 찾는다.

HQ 에는 기록 id → 상태만 보낸다. 주소·연락처는 보내지 않는다.
  done  앨범 제작 (상품주소 있음)
  wait  행은 있는데 주소 없음
  nf    시트에서 못 찾음 (예식일·이름 오타일 가능성)
  dup   같은 날 같은 이름이 둘 이상이고 주소 여부가 갈림 → 사장님 확인
"""
import datetime as dt
import json
import sys
import urllib.request

import common as C
import sheets as S

HQ = "https://the-marian-production.up.railway.app"


def sheet_rows():
    cfg = S.load_config()
    svc = S.service(cfg)
    v = svc.spreadsheets().values().get(
        spreadsheetId=cfg["spreadsheet_id"], range="'고객정보'!A2:AB").execute().get("values", [])
    idx = {}
    for r in v:
        r = r + [""] * (28 - len(r))
        key = (C.norm_date(r[0]), C.base_name(r[3]))
        if key[0] and key[1]:
            idx.setdefault(key, []).append("done" if r[27].strip() else "wait")
    return idx


def main():
    dry = "--dry" in sys.argv
    db = json.load(urllib.request.urlopen(f"{HQ}/api/db", timeout=30))
    idx = sheet_rows()
    status = {}
    for r in db.get("retouch", []):
        hits = idx.get((C.norm_date(r.get("wdate")), C.base_name(r.get("bride"))), [])
        if not hits:
            status[r["id"]] = "nf"
        elif len(set(hits)) == 1:
            status[r["id"]] = hits[0]
        else:
            status[r["id"]] = "dup"
    body = {"updatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "status": status}
    counts = {k: list(status.values()).count(k) for k in ("done", "wait", "nf", "dup")}
    print(body["updatedAt"], counts)
    if dry:
        return
    req = urllib.request.Request(f"{HQ}/api/album", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    print(urllib.request.urlopen(req, timeout=30).read().decode())


if __name__ == "__main__":
    main()
