#!/usr/bin/env python3
"""T-158 Phase 2-A: OneDrive フォルダと portal 求職者を「求職者番号のみ」で突合する（dry-run）。

    py scripts/t158_scan_onedrive.py    # 先に走らせる
    py scripts/t158_match_onedrive.py

入力:
  docs/reports/T-158_onedrive_folders.csv    （scan スクリプトの出力）
  docs/reports/T-158_portal_candidates.csv   （本番DBから SELECT のみで抽出）
出力:
  docs/reports/T-158_onedrive_match_dryrun.csv （UTF-8 BOM付き）

このスクリプトは DB に一切書き込まない。CSV を読んで CSV を書くだけ。

# 氏名では突合しない
  同姓同名で他人のフォルダを紐付けると個人情報の誤開示になるため、
  キーは求職者番号だけ。番号が無いフォルダは NO_NUMBER で終わり。
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPORTS = Path(__file__).resolve().parents[1] / "docs" / "reports"
IN_FOLDERS = REPORTS / "T-158_onedrive_folders.csv"
IN_PORTAL = REPORTS / "T-158_portal_candidates.csv"
OUT_CSV = REPORTS / "T-158_onedrive_match_dryrun.csv"

URL_BASE = "https://bizstudio-my.sharepoint.com/my?id="
PERSONAL_PREFIX = "/personal/masayuki_oono_bizstudio_co_jp/Documents/"


def sp_encode(path: str) -> str:
    """SharePoint の id パラメータ用エンコード。

    実物URLの観察から、/ %2F・_ %5F・. %2E・- %2D・半角空白 %20。
    quote(safe="") は _ . - ~ を残すので、その4文字を追加変換する。
    """
    s = quote(path, safe="")
    for ch, enc in (("_", "%5F"), (".", "%2E"), ("-", "%2D"), ("~", "%7E")):
        s = s.replace(ch, enc)
    return s


def build_url(relative_path: str) -> str:
    return URL_BASE + sp_encode(PERSONAL_PREFIX + relative_path)


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        print(f"[NG] 入力がありません: {path}")
        sys.exit(1)
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main() -> int:
    folders = read_csv(IN_FOLDERS)
    portal = read_csv(IN_PORTAL)

    by_number: dict[str, dict] = {}
    for row in portal:
        no = (row.get("candidate_number") or "").strip()
        if no:
            by_number[no] = row
    print(f"[OK] portal 求職者 {len(portal)} 件（番号ユニーク {len(by_number)} 件）")
    print(f"[OK] OneDrive フォルダ {len(folders)} 件")

    folders_by_number: dict[str, list[dict]] = defaultdict(list)
    for row in folders:
        no = (row.get("candidate_no") or "").strip()
        if no:
            folders_by_number[no].append(row)

    results: list[dict] = []
    for row in folders:
        no = (row.get("candidate_no") or "").strip()
        rel = row.get("relative_path", "")
        if not no:
            status = "NO_NUMBER"
        elif no not in by_number:
            status = "NOT_IN_PORTAL"
        elif len(folders_by_number[no]) > 1:
            status = "DUPLICATE_FOLDER"
        else:
            status = "MATCH"

        cand = by_number.get(no)
        results.append({
            "status": status,
            "candidate_no": no,
            "ca_folder": row.get("ca_folder", ""),
            "yyyymm": row.get("yyyymm", ""),
            "folder_name": row.get("folder_name", ""),
            "folder_name_part": row.get("name_part", ""),
            "structure": row.get("structure", ""),
            "portal_candidate_id": cand["id"] if cand else "",
            "portal_name": cand["name"] if cand else "",
            "portal_employee": cand.get("employee_name", "") if cand else "",
            "portal_support_status": cand.get("support_status", "") if cand else "",
            "portal_onedrive_url_current": cand.get("onedrive_folder_url", "") if cand else "",
            "relative_path": rel,
            # DUPLICATE_FOLDER は自動登録の対象外だが、目視確認できるよう URL は出す
            "generated_url": build_url(rel) if status in ("MATCH", "DUPLICATE_FOLDER") else "",
        })

    fields = list(results[0].keys()) if results else []
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(results)

    counts: dict[str, int] = defaultdict(int)
    per_ca: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in results:
        counts[r["status"]] += 1
        per_ca[r["ca_folder"]][r["status"]] += 1

    order = ["MATCH", "DUPLICATE_FOLDER", "NO_NUMBER", "NOT_IN_PORTAL"]
    print()
    print("=== 突合サマリ ===")
    for k in order:
        print(f"  {k:<17} {counts.get(k, 0):>5}")
    print(f"  {'合計':<15} {len(results):>5}")

    print()
    print("=== CAフォルダ別 ===")
    head = "  {:<10}".format("CA") + "".join(f"{k:>18}" for k in order) + f"{'合計':>8}"
    print(head)
    for ca in sorted(per_ca):
        line = "  {:<10}".format(ca)
        total = 0
        for k in order:
            v = per_ca[ca].get(k, 0)
            total += v
            line += f"{v:>18}"
        print(line + f"{total:>8}")

    dup_numbers = sorted({r["candidate_no"] for r in results if r["status"] == "DUPLICATE_FOLDER"})
    print()
    print(f"[i] DUPLICATE_FOLDER の対象番号: {len(dup_numbers)} 件（自動登録の対象外）")
    print(f"[i] 自動登録できる MATCH: {counts.get('MATCH', 0)} 件")
    print(f"[OK] 出力: {OUT_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
