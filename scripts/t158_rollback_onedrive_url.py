#!/usr/bin/env python3
"""T-158 Phase 2-B: onedrive_folder_url の一括登録を元の値へ戻す。

    py scripts/t158_rollback_onedrive_url.py --dry-run
    py scripts/t158_rollback_onedrive_url.py --execute
    py scripts/t158_rollback_onedrive_url.py --csv docs/reports/T-158c_backup_before_update.csv --execute

t158_match_onedrive.py が UPDATE 前に書き出すバックアップCSVを読み、
そこに載っている内部ID のレコードの onedrive_folder_url を「更新前の値」に戻す。
既定は Phase 2-B の T-158_backup_before_update.csv。Phase 2-C 分を戻すときは
--csv で T-158c_backup_before_update.csv を指定する。
更新前の値が空文字なら NULL に戻す。

何度実行しても結果は同じ（既に更新前の値になっている行は 0 件更新になるだけ）。
onedrive_folder_url 以外の列には触らない。
"""

import argparse
import csv
import os
import re
import sys
from pathlib import Path

import psycopg2

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BACKUP = ROOT / "docs" / "reports" / "T-158_backup_before_update.csv"


def load_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env_path = ROOT / ".env"
    if not env_path.exists():
        print("[NG] .env が見つからず DATABASE_URL も未設定です。")
        sys.exit(1)
    for line in env_path.read_text(encoding="utf-8").splitlines():
        m = re.match(r'^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+?)"?\s*$', line)
        if m:
            return m.group(1)
    print("[NG] .env に DATABASE_URL がありません。")
    sys.exit(1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(DEFAULT_BACKUP),
                    help=f"戻す対象のバックアップCSV（既定: {DEFAULT_BACKUP.name}）")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true", help="戻す件数を数えるだけ")
    g.add_argument("--execute", action="store_true", help="実際に戻す")
    args = ap.parse_args()

    backup = Path(args.csv)
    if not backup.is_absolute():
        backup = (ROOT / backup) if not backup.exists() else backup
    if not backup.exists():
        print(f"[NG] バックアップCSVがありません: {backup}")
        return 1
    with backup.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        print("[i] バックアップCSVが空です。戻すものはありません。")
        return 0
    print(f"[OK] バックアップ {len(rows)} 行を読み込みました: {backup}")

    conn = psycopg2.connect(load_database_url())
    try:
        with conn.cursor() as cur:
            ids = [r["id"] for r in rows]
            cur.execute(
                "SELECT count(*) FROM candidates "
                "WHERE id = ANY(%s) AND onedrive_folder_url IS NOT NULL",
                (ids,),
            )
            non_null_now = cur.fetchone()[0]
        print(f"[i] 対象レコードのうち現在 onedrive_folder_url が非null: {non_null_now} 件")

        if args.dry_run:
            print("[dry-run] DBには書き込んでいません。戻すには --execute を付けてください。")
            return 0

        restored = 0
        with conn:
            with conn.cursor() as cur:
                for r in rows:
                    before = (r.get("onedrive_folder_url_before") or "").strip() or None
                    cur.execute(
                        "UPDATE candidates SET onedrive_folder_url = %s "
                        "WHERE id = %s AND onedrive_folder_url IS DISTINCT FROM %s",
                        (before, r["id"], before),
                    )
                    restored += cur.rowcount
                cur.execute(
                    "SELECT count(*) FROM candidates "
                    "WHERE id = ANY(%s) AND onedrive_folder_url IS NOT NULL",
                    (ids,),
                )
                remain = cur.fetchone()[0]
        print(f"[OK] {restored} 件を更新前の値へ戻しました。")
        print(f"[OK] 対象レコードで onedrive_folder_url が非null なのは {remain} 件になりました。")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
