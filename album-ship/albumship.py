#!/usr/bin/env python3
"""앨범 택배목록 → 웨딩자동화시트 Y열(앨범발송확인차문자전송 +7일후) 체크.

사용법:
  python albumship.py plan  --list 앨범택배목록.xlsx            # 구글시트 조회 + 미리보기 (쓰기 없음)
  python albumship.py plan  --list 목록.xlsx --xlsx 시트.xlsx   # 다운로드본으로 오프라인 검증
  python albumship.py apply --list 앨범택배목록.xlsx --yes      # 실제로 Y열 체크 (문자 발송 트리거)
  python albumship.py auth                                     # 구글 로그인 1회
"""
import argparse
import sys

import common as C
import loaders
import sheets as S


def load_sheet_rows(args):
    """(rows, writer) — writer 는 apply 때 쓸 (svc, cfg) 또는 None."""
    if args.xlsx:
        import openpyxl
        wb = openpyxl.load_workbook(args.xlsx, data_only=True)
        ws = wb[args.sheet_name] if args.sheet_name in wb.sheetnames else wb.worksheets[0]
        rows = [(i, list(r)) for i, r in
                enumerate(ws.iter_rows(values_only=True), start=1)]
        return rows[C.HEADER_ROW:], None
    cfg = S.load_config()
    svc = S.service(cfg)
    sheet_name = args.sheet_name or cfg.get("sheet_name", "고객정보")
    rows = S.read_rows(svc, cfg["spreadsheet_id"], sheet_name)
    return rows[C.HEADER_ROW:], (svc, cfg, sheet_name)


def build_plan(items, index):
    """항목별 매칭 결과."""
    out = []
    for it in items:
        status, cands, how = index.lookup(it["date"], it["name"], it["phone"])
        rec = {**it, "status": status, "how": how, "cands": cands}
        if status == "ok":
            rn, vals = cands[0]
            rec["row"] = rn
            rec["already"] = C.is_checked(index.get(vals, C.COL_Y))
            rec["sheet_phone"] = C.norm_phone(index.get(vals, C.COL_연락처))
            rec["sheet_addr"] = C.s(index.get(vals, C.COL_상품주소))
            rec["sent_note"] = C.s(index.get(vals, C.COL_Z))
            rec["phone_mismatch"] = bool(
                it["phone"] and rec["sheet_phone"] and it["phone"] != rec["sheet_phone"])
        out.append(rec)
    return out


def print_plan(plan):
    ok = [p for p in plan if p["status"] == "ok" and not p["already"]]
    already = [p for p in plan if p["status"] == "ok" and p["already"]]
    amb = [p for p in plan if p["status"] == "ambiguous"]
    none = [p for p in plan if p["status"] == "none"]
    mism = [p for p in ok if p.get("phone_mismatch")]

    print(f"\n입력 {len(plan)}건 → 체크대상 {len(ok)} / 이미체크 {len(already)} "
          f"/ 중복 {len(amb)} / 미매칭 {len(none)}\n")

    if ok:
        print("■ 체크할 행 (Y열 → TRUE, 7일 후 문자 발송)")
        for p in ok:
            flag = "  ⚠전화번호 불일치" if p.get("phone_mismatch") else ""
            if p["how"] != "exact":
                flag += f"  ⚠{p['how']} 매칭 — 확인 필요"
            print(f"   행 {p['row']:>5}  {p['date']}  {p['name']:<10} "
                  f"{p['sheet_phone']:<13} {p['sheet_addr'][:34]}{flag}")
    if already:
        print("\n■ 이미 체크됨 — 건너뜀 (중복 문자 방지)")
        for p in already:
            note = f"  [{p['sent_note']}]" if p["sent_note"] else ""
            print(f"   행 {p['row']:>5}  {p['date']}  {p['name']}{note}")
    if amb:
        print("\n■ 중복 — 어느 행인지 확정 못 함, 수동 확인 필요")
        for p in amb:
            print(f"   {p['date']}  {p['name']}  후보행="
                  f"{[c[0] for c in p['cands']]}")
    if none:
        print("\n■ 시트에서 못 찾음 — 이름/예식일 확인 필요")
        for p in none:
            print(f"   {p['origin']}  {p['raw_date']}  {p['raw_name']}")
    if mism:
        print(f"\n※ 전화번호가 목록과 시트에서 다른 건이 {len(mism)}건 있습니다. 위 ⚠ 표시 확인.")
    print()
    return ok, already, amb, none


def cmd_plan(args):
    items, bad = loaders.load_list(args.list)
    if bad:
        print("해석 못 한 줄:")
        for i, line in bad:
            print(f"   {i}: {line}")
    if not items:
        raise SystemExit("택배목록에서 읽어들인 항목이 없습니다.")
    rows, _ = load_sheet_rows(args)
    print_plan(build_plan(items, C.SheetIndex(rows)))


def cmd_apply(args):
    if args.xlsx:
        raise SystemExit("--xlsx 는 미리보기 전용입니다. 실제 체크는 구글시트에만 합니다.")
    items, bad = loaders.load_list(args.list)
    if bad:
        print("해석 못 한 줄:")
        for i, line in bad:
            print(f"   {i}: {line}")
    rows, writer = load_sheet_rows(args)
    plan = build_plan(items, C.SheetIndex(rows))
    ok, already, amb, none = print_plan(plan)

    if (amb or none or bad) and not args.allow_partial:
        raise SystemExit("미매칭/중복 항목이 있습니다. 정리한 뒤 다시 실행하거나 "
                         "--allow-partial 을 붙여 나머지만 처리하세요.")
    if not ok:
        print("체크할 행이 없습니다.")
        return
    if not args.yes:
        raise SystemExit(f"{len(ok)}건을 체크하려면 --yes 를 붙여 실행하세요. "
                         "(체크 시 고객에게 문자가 발송됩니다)")

    svc, cfg, sheet_name = writer
    n = S.check_y(svc, cfg["spreadsheet_id"], sheet_name, [p["row"] for p in ok])
    print(f"완료: {n}개 셀 체크됨 (행 {[p['row'] for p in ok]})")


def cmd_auth(args):
    cfg = S.load_config()
    S.get_credentials(cfg["client_secret_file"])
    print(f"인증 완료 — 토큰 저장: {S.TOKEN_PATH}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add_common(p):
        p.add_argument("--list", required=True, help="택배목록 파일 (.xlsx/.csv/.txt)")
        p.add_argument("--xlsx", help="구글시트 대신 다운로드한 웨딩자동화시트.xlsx 로 검증")
        p.add_argument("--sheet-name", default=None, help="시트 탭 이름 (기본: 고객정보)")

    p = sub.add_parser("plan", help="미리보기 — 쓰기 없음")
    add_common(p)
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("apply", help="구글시트 Y열 체크 (문자 발송 트리거)")
    add_common(p)
    p.add_argument("--yes", action="store_true", help="실제 실행 확인")
    p.add_argument("--allow-partial", action="store_true",
                   help="미매칭이 있어도 매칭된 것만 처리")
    p.set_defaults(func=cmd_apply)

    p = sub.add_parser("auth", help="구글 로그인 1회")
    p.set_defaults(func=cmd_auth)

    args = ap.parse_args()
    if args.cmd != "auth" and getattr(args, "sheet_name", None) is None:
        args.sheet_name = "고객정보"
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
