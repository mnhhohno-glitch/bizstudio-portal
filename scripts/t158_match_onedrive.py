#!/usr/bin/env python3
"""T-158 Phase 2-B: OneDrive フォルダと portal 求職者を突合し、氏名照合を通ったものだけ登録する。

    py scripts/t158_scan_onedrive.py              # 先に走らせる（OneDrive 走査）
    py scripts/t158_match_onedrive.py             # dry-run（DBに書き込まない）
    py scripts/t158_match_onedrive.py --execute   # 本番DBへ一括 UPDATE

入力:
  docs/reports/T-158_onedrive_folders.csv   （scan スクリプトの出力）
  本番DB candidates テーブル                 （.env の DATABASE_URL 経由）
出力:
  docs/reports/T-158_portal_candidates.csv       （SELECT した求職者一覧・BOM付き）
  docs/reports/T-158_onedrive_match_dryrun.csv   （突合結果・BOM付き）
  docs/reports/T-158_backup_before_update.csv    （UPDATE 対象の更新前値・ロールバック用）

# 突合キーは求職者番号だけ。氏名は「登録してよいか」の検証にしか使わない
  氏名で突合すると同姓同名で他人のフォルダを紐付けてしまう。
  一方、番号だけを信じるのも危険で、Phase 2-A で「同じ番号のフォルダに別人の氏名」が
  実際に4件見つかっている（フォルダ側の番号打ち間違い）。重複していない番号にも
  同種の打ち間違いが紛れている前提で、氏名が一致しないものは登録しない。

# UPDATE は onedrive_folder_url が NULL の行だけ
  既に入っている値は上書きしない（何度実行しても同じ結果になる）。
"""

import argparse
import csv
import os
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import psycopg2
import psycopg2.extras

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "docs" / "reports"
IN_FOLDERS = REPORTS / "T-158_onedrive_folders.csv"
OUT_PORTAL = REPORTS / "T-158_portal_candidates.csv"
OUT_MATCH = REPORTS / "T-158_onedrive_match_dryrun.csv"
OUT_BACKUP = REPORTS / "T-158_backup_before_update.csv"     # Phase 2-B（番号一致）
OUT_BACKUP_C = REPORTS / "T-158c_backup_before_update.csv"  # Phase 2-C（番号なし・氏名＋担当CA）

URL_BASE = "https://bizstudio-my.sharepoint.com/my?id="
PERSONAL_PREFIX = "/personal/masayuki_oono_bizstudio_co_jp/Documents/"

# 重点対象（報告を詳しく出す範囲。登録する範囲ではない）
FOCUS_CREATED_FROM = datetime(2026, 1, 1, tzinfo=timezone.utc)
ACTIVE_STATUS = "ACTIVE"  # 実データの support_status: BEFORE / ACTIVE / WAITING / ENDED / ARCHIVED


# --------------------------------------------------------------------------- URL

def sp_encode(path: str) -> str:
    """SharePoint の id パラメータ用エンコード（quote が残す _ . - ~ を追加変換）。"""
    s = quote(path, safe="")
    for ch, enc in (("_", "%5F"), (".", "%2E"), ("-", "%2D"), ("~", "%7E")):
        s = s.replace(ch, enc)
    return s


def build_url(relative_path: str) -> str:
    return URL_BASE + sp_encode(PERSONAL_PREFIX + relative_path)


# --------------------------------------------------------------------------- 氏名照合

RE_WS = re.compile(r"\s+")
# 中黒。長音「ー」は氏名に含まれうるので落とさない
NAKAGURO = ("・", "･", "·")


def norm_name(s: str) -> str:
    """氏名の正規化: NFKC（全角英数→半角・全角空白→空白）→ 空白除去 → 中黒除去。"""
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = RE_WS.sub("", s)
    for ch in NAKAGURO:
        s = s.replace(ch, "")
    return s


# Phase 2-C: 番号なしフォルダの氏名完全一致で落とす、末尾の業務上の付記
SUFFIX_TOKENS = ("_close", "close", "クローズ", "支援終了", "終了", "済", "様", "さん")


def strip_suffix_tokens(normalized: str) -> str:
    """正規化済み文字列の末尾から付記を落とす（末尾のみ・複数回）。"""
    changed = True
    while changed:
        changed = False
        for tok in SUFFIX_TOKENS:
            if len(normalized) > len(tok) and normalized.lower().endswith(tok.lower()):
                normalized = normalized[: -len(tok)]
                changed = True
    return normalized


def surname_of(full_name: str) -> str:
    """「安藤 嘉富」→「安藤」。空白が無ければ全体を返す。"""
    s = unicodedata.normalize("NFKC", (full_name or "").strip())
    parts = [p for p in RE_WS.split(s) if p]
    return parts[0] if parts else ""


def ca_folder_surname(ca_folder: str) -> str:
    """「4.安藤」→「安藤」。"""
    s = unicodedata.normalize("NFKC", (ca_folder or "").strip())
    return re.sub(r"^\d+\s*\.\s*", "", s)


def name_matches(portal_name: str, folder_name_part: str) -> bool:
    """portal 氏名が、フォルダ氏名部分に含まれるか。

    完全一致にしないのは、フォルダ名末尾に _close / クローズ / 支援終了 / 様 等の
    付記が付くケースが実在するため。
    """
    p = norm_name(portal_name)
    f = norm_name(folder_name_part)
    if not p or not f:
        return False
    return p in f


# --------------------------------------------------------------------------- IO

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


def read_folders() -> list[dict]:
    if not IN_FOLDERS.exists():
        print(f"[NG] 入力がありません: {IN_FOLDERS}")
        print("     先に py scripts/t158_scan_onedrive.py を実行してください。")
        sys.exit(1)
    with IN_FOLDERS.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def fetch_portal(conn) -> list[dict]:
    """本番DBから求職者一覧を SELECT する（読み取りのみ）。"""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT c.id, c.candidate_number, c.name, c.name_kana,
                   e.name AS employee_name, c.support_status,
                   c.created_at, c.scout_delivery_date, c.application_date,
                   c.onedrive_folder_url
            FROM candidates c
            LEFT JOIN employees e ON e.id = c.employee_id
            ORDER BY c.candidate_number
            """
        )
        return [dict(r) for r in cur.fetchall()]


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


# --------------------------------------------------------------------------- 重点対象

def as_utc(dt) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_focus(cand: dict) -> bool:
    """重点対象 = 登録日が 2026-01-01 以降 OR 現在支援中。"""
    created = as_utc(cand.get("created_at"))
    if created and created >= FOCUS_CREATED_FROM:
        return True
    return cand.get("support_status") == ACTIVE_STATUS


def is_focus_effective(cand: dict) -> bool:
    """created_at が portal 一括投入日に潰れているため、実際の獲得時期で見た補助的な重点対象。

    配信日 or 応募日が 2026-01-01 以降、あるいは現在支援中。
    """
    for key in ("scout_delivery_date", "application_date"):
        d = as_utc(cand.get(key))
        if d and d >= FOCUS_CREATED_FROM:
            return True
    return cand.get("support_status") == ACTIVE_STATUS


# --------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true",
                    help="本番DBへ UPDATE する（未指定なら dry-run で書き込まない）")
    args = ap.parse_args()

    folders = read_folders()
    dsn = load_database_url()
    conn = psycopg2.connect(dsn)
    try:
        portal = fetch_portal(conn)
        print(f"[OK] portal 求職者 {len(portal)} 件 / OneDrive フォルダ {len(folders)} 件")

        write_csv(OUT_PORTAL,
                  ["candidate_number", "id", "name", "employee_name", "support_status",
                   "created_at", "onedrive_folder_url"],
                  [{**c, "created_at": c["created_at"].isoformat() if c["created_at"] else ""}
                   for c in portal])

        by_number = {c["candidate_number"].strip(): c for c in portal
                     if c.get("candidate_number")}

        folders_by_number: dict[str, list[dict]] = defaultdict(list)
        for row in folders:
            no = (row.get("candidate_no") or "").strip()
            if no:
                folders_by_number[no].append(row)

        results: list[dict] = []
        for row in folders:
            no = (row.get("candidate_no") or "").strip()
            rel = row.get("relative_path", "")
            name_part = row.get("name_part", "")
            cand = by_number.get(no)

            if not no:
                status = "NO_NUMBER"
            elif cand is None:
                status = "NOT_IN_PORTAL"
            elif len(folders_by_number[no]) > 1:
                status = "DUPLICATE_FOLDER"
            elif name_matches(cand["name"], name_part):
                status = "MATCH_NAME_OK"
            else:
                status = "MATCH_NAME_MISMATCH"

            registrable = status == "MATCH_NAME_OK"
            results.append({
                "status": status,
                "candidate_no": no,
                "ca_folder": row.get("ca_folder", ""),
                "yyyymm": row.get("yyyymm", ""),
                "folder_name": row.get("folder_name", ""),
                "folder_name_part": name_part,
                "structure": row.get("structure", ""),
                "portal_candidate_id": cand["id"] if cand else "",
                "portal_name": cand["name"] if cand else "",
                "portal_employee": (cand.get("employee_name") or "") if cand else "",
                "portal_support_status": (cand.get("support_status") or "") if cand else "",
                "portal_created_at": (cand["created_at"].strftime("%Y-%m-%d")
                                      if cand and cand.get("created_at") else ""),
                "is_focus": "1" if cand and is_focus(cand) else "0",
                "portal_onedrive_url_current": (cand.get("onedrive_folder_url") or "") if cand else "",
                "relative_path": rel,
                # 登録対象外でも目視できるよう、番号が portal にあるものには URL を出す
                "generated_url": build_url(rel) if cand else "",
                "registrable": "1" if registrable else "0",
            })

        # ---------------- Phase 2-C: NO_NUMBER を氏名＋担当CA姓で再分類 ----------------
        # 番号が無い分キーが弱いので、氏名は部分一致ではなく完全一致で判定し、
        # さらに「フォルダが置かれている CA フォルダの姓 == 担当CAの姓」を必須にする。
        portal_by_norm_name: dict[str, list[dict]] = defaultdict(list)
        for c in portal:
            portal_by_norm_name[norm_name(c["name"])].append(c)

        no_number_rows = [r for r in results if r["status"] == "NO_NUMBER"]
        # まず氏名一致者を引き当て、同じ求職者を指すフォルダが複数ないかを数える
        hits: dict[int, list[dict]] = {}
        claims: dict[str, int] = defaultdict(int)
        for r in no_number_rows:
            key = strip_suffix_tokens(norm_name(r["folder_name_part"]))
            found = portal_by_norm_name.get(key, []) if key else []
            hits[id(r)] = found
            if len(found) == 1:
                claims[found[0]["id"]] += 1

        for r in no_number_rows:
            found = hits[id(r)]
            if not found:
                r["status"] = "NAME_NOT_FOUND"
                r["reason"] = "氏名が一致する求職者なし"
                continue
            if len(found) > 1:
                r["status"] = "NAME_AMBIGUOUS"
                r["reason"] = f"氏名一致者が複数({len(found)}人)"
                continue

            cand = found[0]
            folder_sn = ca_folder_surname(r["ca_folder"])
            emp_sn = surname_of(cand.get("employee_name") or "")
            r["portal_candidate_id"] = cand["id"]
            r["candidate_no"] = cand["candidate_number"]
            r["portal_name"] = cand["name"]
            r["portal_employee"] = cand.get("employee_name") or ""
            r["portal_support_status"] = cand.get("support_status") or ""
            r["portal_created_at"] = (cand["created_at"].strftime("%Y-%m-%d")
                                      if cand.get("created_at") else "")
            r["portal_onedrive_url_current"] = cand.get("onedrive_folder_url") or ""
            r["is_focus"] = "1" if is_focus(cand) else "0"
            r["generated_url"] = build_url(r["relative_path"])

            if claims[cand["id"]] > 1:
                r["status"] = "NAME_AMBIGUOUS"
                r["reason"] = f"同じ求職者を指す候補フォルダが複数({claims[cand['id']]}件)"
            elif not emp_sn:
                r["status"] = "NAME_AMBIGUOUS"
                r["reason"] = "担当CA未設定"
            elif emp_sn != folder_sn:
                r["status"] = "NAME_AMBIGUOUS"
                r["reason"] = f"担当CA姓不一致(portal={emp_sn} / フォルダ={folder_sn})"
            elif cand.get("onedrive_folder_url"):
                r["status"] = "NAME_AMBIGUOUS"
                r["reason"] = "既にURL登録済み"
            else:
                r["status"] = "NAME_CA_MATCH"
                r["reason"] = f"氏名完全一致＋担当CA姓一致({emp_sn})"
                r["registrable"] = "1"

        for r in results:
            r.setdefault("reason", "")

        write_csv(OUT_MATCH, list(results[0].keys()), results)

        counts: dict[str, int] = defaultdict(int)
        for r in results:
            counts[r["status"]] += 1
        order = ["MATCH_NAME_OK", "MATCH_NAME_MISMATCH", "DUPLICATE_FOLDER",
                 "NAME_CA_MATCH", "NAME_AMBIGUOUS", "NAME_NOT_FOUND", "NOT_IN_PORTAL"]
        registrable_statuses = ("MATCH_NAME_OK", "NAME_CA_MATCH")

        print()
        print("=== 突合サマリ（全体） ===")
        for k in order:
            mark = "  ← 登録対象" if k in registrable_statuses else ""
            print(f"  {k:<20} {counts.get(k, 0):>5}{mark}")
        print(f"  {'合計':<18} {len(results):>5}")

        if counts.get("MATCH_NAME_OK", 0) == 0:
            print()
            print("[NG] MATCH_NAME_OK が 0 件です。氏名正規化ロジックの不具合を疑ってください。")
            return 1

        # ---------------- Phase 2-C の内訳 ----------------
        print()
        print("=== Phase 2-C: 番号なしフォルダ（旧 NO_NUMBER）の再分類 ===")
        ca_match = [r for r in results if r["status"] == "NAME_CA_MATCH"]
        ambiguous = [r for r in results if r["status"] == "NAME_AMBIGUOUS"]
        not_found = [r for r in results if r["status"] == "NAME_NOT_FOUND"]
        print(f"  NAME_CA_MATCH   {len(ca_match):>5}  ← 登録対象")
        print(f"  NAME_AMBIGUOUS  {len(ambiguous):>5}")
        print(f"  NAME_NOT_FOUND  {len(not_found):>5}")
        print(f"  {'合計':<14} {len(ca_match) + len(ambiguous) + len(not_found):>5}")

        if not ca_match:
            print()
            print("[NG] NAME_CA_MATCH が 0 件です。氏名正規化・付記除去ロジックの不具合を疑ってください。")
            return 1

        print()
        print(f"--- NAME_CA_MATCH 全件（{len(ca_match)} 件・登録する） ---")
        print("  {:<16} {:<12} {:<10} {}".format("portal氏名", "担当CA", "ステータス", "フォルダパス"))
        for r in sorted(ca_match, key=lambda x: x["relative_path"]):
            print("  {:<16} {:<12} {:<10} {}".format(
                r["portal_name"], r["portal_employee"], r["portal_support_status"],
                r["relative_path"]))

        print()
        print(f"--- NAME_AMBIGUOUS 全件（{len(ambiguous)} 件・登録しない） ---")
        print("  {:<40} {}".format("除外理由", "フォルダパス"))
        for r in sorted(ambiguous, key=lambda x: (x["reason"], x["relative_path"])):
            print("  {:<40} {}".format(r["reason"], r["relative_path"]))

        print()
        print(f"--- NAME_NOT_FOUND（{len(not_found)} 件・登録しない） ---")
        for r in not_found[:20]:
            print(f"  {r['folder_name']}    ({r['relative_path']})")
        if len(not_found) > 20:
            print(f"  ... 他 {len(not_found) - 20} 件（総件数 {len(not_found)}）")

        per_ca: dict[str, int] = defaultdict(int)
        for r in results:
            if r["status"] == "MATCH_NAME_OK":
                per_ca[r["ca_folder"]] += 1
        print()
        print("=== CAフォルダ別 MATCH_NAME_OK ===")
        for ca in sorted(per_ca):
            print(f"  {ca:<10} {per_ca[ca]:>5}")

        # ---------------- 重点対象 ----------------
        # 登録される（＝URLが付く）求職者番号。Phase 2-C の氏名＋担当CA一致も含める
        ok_by_number = {r["candidate_no"]: r for r in results
                        if r["status"] in registrable_statuses and r["candidate_no"]}
        any_folder_numbers = set(folders_by_number.keys()) | {
            r["candidate_no"] for r in results
            if r["status"] in ("NAME_CA_MATCH", "NAME_AMBIGUOUS") and r["candidate_no"]
        }

        def focus_report(label: str, pred) -> None:
            focus = [c for c in portal if pred(c)]
            with_url = [c for c in focus if c["candidate_number"] in ok_by_number]
            rate = (len(with_url) / len(focus) * 100) if focus else 0.0
            print()
            print(f"=== 重点対象【{label}】 ===")
            print(f"  総人数            {len(focus):>5}")
            print(f"  URLが付く人数      {len(with_url):>5}")
            print(f"  カバー率           {rate:>8.1f} %")

        focus_report("仕様どおり: 登録日>=2026-01-01 OR 支援中", is_focus)
        focus_report("補助: 配信日/応募日>=2026-01-01 OR 支援中", is_focus_effective)
        focus_report("支援中(ACTIVE)のみ", lambda c: c.get("support_status") == ACTIVE_STATUS)

        focus_numbers = {c["candidate_number"] for c in portal if is_focus(c)}
        mism_focus = [r for r in results
                      if r["status"] == "MATCH_NAME_MISMATCH" and r["candidate_no"] in focus_numbers]
        mism_other = [r for r in results
                      if r["status"] == "MATCH_NAME_MISMATCH" and r["candidate_no"] not in focus_numbers]

        print()
        print(f"=== 重点対象の MATCH_NAME_MISMATCH 全件（{len(mism_focus)} 件・登録しない） ===")
        print("  {:<10} {:<16} {:<20} {}".format("番号", "portal氏名", "フォルダ氏名", "パス"))
        for r in sorted(mism_focus, key=lambda x: x["candidate_no"]):
            print("  {:<10} {:<16} {:<20} {}".format(
                r["candidate_no"], r["portal_name"], r["folder_name_part"], r["relative_path"]))
        print()
        print(f"[i] 重点対象外の MATCH_NAME_MISMATCH: {len(mism_other)} 件（一覧は出さない）")

        empty_part = sum(1 for r in results
                         if r["status"] == "MATCH_NAME_MISMATCH" and not r["folder_name_part"].strip())
        print(f"[i] うちフォルダ名が番号のみで氏名を照合できないもの: {empty_part} 件")

        def missing_report(label: str, pred, limit: int = 30) -> None:
            missing = [c for c in portal
                       if pred(c) and c["candidate_number"] not in any_folder_numbers]
            print()
            print(f"=== 【{label}】なのに OneDrive フォルダが見つからない人（{len(missing)} 件） ===")
            print("  {:<10} {:<16} {:<12} {:<12} {}".format(
                "番号", "portal氏名", "担当CA", "登録日", "ステータス"))
            for c in missing[:limit]:
                print("  {:<10} {:<16} {:<12} {:<12} {}".format(
                    c["candidate_number"], c["name"], c.get("employee_name") or "-",
                    c["created_at"].strftime("%Y-%m-%d") if c.get("created_at") else "-",
                    c.get("support_status") or "-"))
            if len(missing) > limit:
                print(f"  ... 他 {len(missing) - limit} 件（総件数 {len(missing)}）")

        missing_report("重点対象（仕様どおり）", is_focus)
        # created_at が一括投入日に潰れており仕様どおりだと全件が重点対象になるため、
        # 実務で本当に毎日開く層として支援中だけの一覧も出す
        missing_report("支援中(ACTIVE)のみ",
                       lambda c: c.get("support_status") == ACTIVE_STATUS, limit=40)

        # ---------------- 更新対象 / バックアップ ----------------
        # Phase 2-B（番号一致＋氏名検証）と Phase 2-C（番号なし・氏名完全一致＋担当CA姓一致）で
        # バックアップCSVを分ける。空のときは書き出さない（過去フェーズのCSVを潰さないため）。
        by_id = {c["id"]: c for c in portal}

        def collect(status: str) -> list[dict]:
            out = []
            for r in results:
                if r["status"] != status or not r["portal_candidate_id"]:
                    continue
                cand = by_id[r["portal_candidate_id"]]
                if cand.get("onedrive_folder_url"):
                    continue  # 既に値がある行は触らない
                out.append({
                    "id": cand["id"],
                    "candidate_number": cand["candidate_number"],
                    "onedrive_folder_url_before": cand.get("onedrive_folder_url") or "",
                    "onedrive_folder_url_after": r["generated_url"],
                })
            return out

        fields_bk = ["id", "candidate_number",
                     "onedrive_folder_url_before", "onedrive_folder_url_after"]
        targets_b = collect("MATCH_NAME_OK")
        targets_c = collect("NAME_CA_MATCH")
        targets = targets_b + targets_c

        print()
        for label, tg, path in (("Phase 2-B (MATCH_NAME_OK)", targets_b, OUT_BACKUP),
                                ("Phase 2-C (NAME_CA_MATCH)", targets_c, OUT_BACKUP_C)):
            if tg:
                write_csv(path, fields_bk, tg)
                print(f"[OK] {label} 更新対象 {len(tg)} 件 / バックアップ: {path}")
            else:
                print(f"[i] {label} 更新対象 0 件（登録済み）。バックアップCSVは書き換えていません。")
        print(f"[OK] 今回の更新対象 合計 {len(targets)} 件")

        if not args.execute:
            print()
            print("[dry-run] DBには書き込んでいません。実行するには --execute を付けてください。")
            return 0

        # ---------------- 本番 UPDATE ----------------
        before_cnt = sum(1 for c in portal if c.get("onedrive_folder_url"))
        with conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_batch(
                    cur,
                    "UPDATE candidates SET onedrive_folder_url = %s "
                    "WHERE id = %s AND onedrive_folder_url IS NULL",
                    [(t["onedrive_folder_url_after"], t["id"]) for t in targets],
                    page_size=500,
                )
                cur.execute("SELECT count(*) FROM candidates WHERE onedrive_folder_url IS NOT NULL")
                after_cnt = cur.fetchone()[0]
        expected = before_cnt + len(targets)
        print()
        print(f"[OK] UPDATE 実行。非null レコード: {before_cnt} → {after_cnt} 件")
        print(f"     期待値 {before_cnt} + {len(targets)} = {expected} と"
              f"{'一致' if after_cnt == expected else '不一致（要確認）'}")

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT count(*) FILTER (WHERE onedrive_folder_url IS NOT NULL) AS with_url, "
                "count(*) AS total FROM candidates WHERE support_status = %s",
                (ACTIVE_STATUS,),
            )
            row = cur.fetchone()
            rate = row["with_url"] / row["total"] * 100 if row["total"] else 0.0
            print()
            print("=== 支援中(ACTIVE) カバー率（更新後・DB実測） ===")
            print(f"  {row['with_url']} / {row['total']} = {rate:.1f} %")

            cur.execute(
                "SELECT c.candidate_number, c.name, e.name AS employee_name, c.support_status "
                "FROM candidates c LEFT JOIN employees e ON e.id = c.employee_id "
                "WHERE c.support_status = %s AND c.onedrive_folder_url IS NULL "
                "ORDER BY c.candidate_number",
                (ACTIVE_STATUS,),
            )
            rest = cur.fetchall()
            print()
            print(f"=== 支援中でまだURLが付いていない人 全件（{len(rest)} 件） ===")
            print("  {:<10} {:<16} {:<12} {}".format("番号", "portal氏名", "担当CA", "ステータス"))
            for c in rest:
                print("  {:<10} {:<16} {:<12} {}".format(
                    c["candidate_number"], c["name"], c["employee_name"] or "-", c["support_status"]))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
