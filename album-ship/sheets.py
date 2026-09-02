"""Google Sheets 접근 — OAuth 로그인, 고객정보 읽기, Y열 체크박스 쓰기."""
import json
import os
import re

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_PATH = os.path.join(HERE, "token.json")
CONFIG_PATH = os.path.join(HERE, "config.json")


def load_config():
    if not os.path.exists(CONFIG_PATH):
        raise SystemExit(
            f"설정 파일이 없습니다: {CONFIG_PATH}\n"
            "config.example.json 을 복사해 config.json 으로 만들고 "
            "spreadsheet_id 와 client_secret_file 을 채워주세요."
        )
    return json.load(open(CONFIG_PATH, encoding="utf-8"))


def sheet_id_from_url(url):
    m = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]+)", url)
    return m.group(1) if m else url


def get_credentials(client_secret_file):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    else:
        if not os.path.exists(client_secret_file):
            raise SystemExit(f"OAuth 클라이언트 파일이 없습니다: {client_secret_file}")
        flow = InstalledAppFlow.from_client_secrets_file(client_secret_file, SCOPES)
        creds = flow.run_local_server(port=0, prompt="consent")
    with open(TOKEN_PATH, "w") as f:
        f.write(creds.to_json())
    os.chmod(TOKEN_PATH, 0o600)
    return creds


def service(cfg):
    from googleapiclient.discovery import build
    creds = get_credentials(cfg["client_secret_file"])
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def read_rows(svc, spreadsheet_id, sheet_name, last_col="AB"):
    """고객정보 전 행을 [(행번호, [값...])] 로. UNFORMATTED + SERIAL_NUMBER 로 받아
    체크박스는 True/False, 날짜는 시리얼 숫자로 온다."""
    rng = f"'{sheet_name}'!A1:{last_col}"
    res = svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=rng,
        valueRenderOption="UNFORMATTED_VALUE",
        dateTimeRenderOption="FORMATTED_STRING",
    ).execute()
    values = res.get("values", [])
    return [(i, r) for i, r in enumerate(values, start=1)]


def check_y(svc, spreadsheet_id, sheet_name, row_numbers, col="Y"):
    """지정한 행들의 Y열을 TRUE 로 설정. 반환: 갱신된 셀 수."""
    data = [{"range": f"'{sheet_name}'!{col}{rn}", "values": [[True]]}
            for rn in sorted(set(row_numbers))]
    if not data:
        return 0
    res = svc.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"valueInputOption": "USER_ENTERED", "data": data},
    ).execute()
    return res.get("totalUpdatedCells", 0)
