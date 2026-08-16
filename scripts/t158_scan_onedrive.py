#!/usr/bin/env python3
"""T-158 Phase 2-A: OneDrive の求職者フォルダを走査して CSV に出す（読み取り専用）。

OneDrive 上のファイル・フォルダを一切変更しない。ディレクトリ名の列挙のみ行い、
ファイルの中身は読まない（Files On-Demand のダウンロードを誘発しないため）。

    py scripts/t158_scan_onedrive.py

出力: docs/reports/T-158_onedrive_folders.csv （UTF-8 BOM付き）

# 実構造メモ（2026-08-16 時点の実測）
  プロンプト前提の {CA}/{年}/{年月}/{求職者番号}_{氏名} に従うのは 1.大野 のみ。
    1.大野   : {年}/{年月}/求職者
    2.小野   : 直下に求職者（年階層なし）
    3.岡田   : {年}年/{年月}/求職者 と {年月}/求職者 が混在
    4.安藤   : {年月}/求職者、加えて 2024～/{年}年/... や RAフォルダ/...
    5.南條   : {年月}/求職者
    6.奥村   : {年月}/求職者
  そのため「年/年月の2階層」を前提に走査すると大半を取りこぼす。
  ここでは CA フォルダ配下を再帰的に歩き、名前が数字で始まるものを求職者フォルダとみなす。
  階層が {年}/{年月} でないものは structure="MISMATCH" として別途記録する。
"""

import csv
import os
import re
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

TARGET_SUBPATH = Path("ビズスタジオ") / "6.求職者書類関連"
OUT_CSV = Path(__file__).resolve().parents[1] / "docs" / "reports" / "T-158_onedrive_folders.csv"

MAX_DEPTH = 6  # CA フォルダからの相対深さの上限（暴走防止）

# 求職者フォルダ: 先頭が 4〜10 桁の連続数字
RE_CANDIDATE = re.compile(r"^(\d{4,10})")
# 番号に続く区切り文字（_ / 半角空白 / 全角空白 / -）
RE_SEP = re.compile(r"^[_\s　-]+")
# CA フォルダ: {数字}.{名前}
RE_CA = re.compile(r"^\d+\.")
# 年フォルダ: 2024 / 2024年 / 2024～ など
RE_YEAR = re.compile(r"^(19|20)\d{2}\s*[年~～]?$")
# 年月フォルダ: 202607
RE_MONTH = re.compile(r"^(19|20)\d{4}$")

# 求職者フォルダではないと分かっているテンプレ用フォルダ（年月フォルダ配下に同居している）
TEMPLATE_DIR_NAMES = {"【原本】番号氏名"}


def find_onedrive_root() -> Path | None:
    """OneDrive 同期フォルダ配下の 6.求職者書類関連 を探す。"""
    cands: list[Path] = []
    for env_key in ("OneDrive", "OneDriveCommercial", "OneDriveConsumer"):
        v = os.environ.get(env_key)
        if v:
            cands.append(Path(v))
    home = Path.home()
    if home.is_dir():
        for child in home.iterdir():
            if child.is_dir() and "OneDrive" in child.name:
                cands.append(child)

    seen: set[str] = set()
    for base in cands:
        key = str(base).lower()
        if key in seen:
            continue
        seen.add(key)
        target = base / TARGET_SUBPATH
        if target.is_dir():
            return target
    return None


def list_dirs(path: Path) -> list[Path]:
    try:
        return sorted((p for p in path.iterdir() if p.is_dir()), key=lambda p: p.name)
    except (PermissionError, OSError) as e:
        print(f"  [WARN] 列挙できません: {path} ({e})")
        return []


def split_candidate(folder_name: str) -> tuple[str, str]:
    """フォルダ名を (求職者番号, 氏名部分) に分解する。番号が無ければ ('', 元の名前)。"""
    m = RE_CANDIDATE.match(folder_name)
    if not m:
        return "", folder_name.strip()
    number = m.group(1)
    rest = folder_name[m.end():]
    rest = RE_SEP.sub("", rest)  # 番号直後の区切り文字だけ落とし、氏名内の空白は残す
    return number, rest.strip()


def classify(containers: list[str]) -> tuple[str, str, str]:
    """CA フォルダから求職者フォルダまでの中間セグメントを (year, yyyymm, structure) に解釈。"""
    if len(containers) == 2 and RE_YEAR.match(containers[0]) and RE_MONTH.match(containers[1]):
        return containers[0][:4], containers[1], "OK"
    year = ""
    yyyymm = ""
    for seg in containers:
        if RE_MONTH.match(seg):
            yyyymm = seg
            if not year:
                year = seg[:4]
        elif RE_YEAR.match(seg) and not year:
            year = seg[:4]
    return year, yyyymm, "MISMATCH"


def main() -> int:
    root = find_onedrive_root()
    if root is None:
        print("[NG] OneDrive 同期フォルダ配下に 'ビズスタジオ/6.求職者書類関連' が見つかりません。")
        return 1
    print(f"[OK] 走査対象: {root}")

    ca_dirs: list[Path] = []
    skipped_top: list[str] = []
    for d in list_dirs(root):
        if not RE_CA.match(d.name):
            skipped_top.append(f"{d.name} (CA命名でない)")
            continue
        # {数字}.{名前} でも、配下に 年 / 年月 / 求職者番号 のいずれも無いものは CA フォルダではない
        kids = [k.name for k in list_dirs(d)]
        if any(RE_YEAR.match(k) or RE_MONTH.match(k) or RE_CANDIDATE.match(k) for k in kids):
            ca_dirs.append(d)
        else:
            skipped_top.append(f"{d.name} (配下に年/年月/番号フォルダ無し)")

    print(f"[OK] CA フォルダ {len(ca_dirs)} 件: {', '.join(d.name for d in ca_dirs)}")
    for s in skipped_top:
        print(f"     - 対象外: {s}")

    rows: list[dict] = []
    mismatches: list[str] = []

    def walk(ca: Path, cur: Path, containers: list[str]) -> None:
        if len(containers) >= MAX_DEPTH:
            return
        for d in list_dirs(cur):
            name = d.name
            if name in TEMPLATE_DIR_NAMES:
                continue
            is_container = bool(RE_YEAR.match(name) or RE_MONTH.match(name))
            is_candidate = bool(RE_CANDIDATE.match(name))
            # 年/年月フォルダは中間コンテナとして降りる。
            # 「202607」は 6 桁なので RE_CANDIDATE にも当たるため、コンテナ判定を優先する
            # （求職者番号は 7 桁で先頭が 5、年月は先頭が 19/20 の 6 桁なので衝突しない）。
            if is_container:
                walk(ca, d, containers + [name])
                continue
            in_month_container = bool(containers) and bool(RE_MONTH.match(containers[-1]))
            # 年月フォルダ直下の番号なしフォルダは「番号が抜けた求職者フォルダ」と
            # 「支援終了 / クローズ / ロープレ のような束ねフォルダ」の両方がありうる。
            # 子の過半が番号付きなら束ねフォルダとみなして降り、そうでなければ求職者フォルダとして記録する。
            # （記録した求職者フォルダの中は見ない。中の 2.求人/0609 のような日付フォルダを
            #   求職者番号 0609 と誤認しないため）
            if in_month_container and not is_candidate:
                kids = list_dirs(d)
                numbered = [
                    k for k in kids
                    if RE_CANDIDATE.match(k.name)
                    and not RE_YEAR.match(k.name) and not RE_MONTH.match(k.name)
                ]
                if numbered and len(numbered) * 2 >= len(kids):
                    walk(ca, d, containers + [name])
                    continue

            # 番号付きは求職者フォルダ確定。番号なしでも年月フォルダ直下なら番号欠落の求職者フォルダ。
            if is_candidate or in_month_container:
                number, name_part = split_candidate(name)
                year, yyyymm, structure = classify(containers)
                rel = "/".join(
                    ["ビズスタジオ", "6.求職者書類関連", ca.name] + containers + [name]
                )
                rows.append({
                    "ca_folder": ca.name,
                    "year": year,
                    "yyyymm": yyyymm,
                    "folder_name": name,
                    "candidate_no": number,
                    "name_part": name_part,
                    "relative_path": rel,
                    "container_path": "/".join(containers),
                    "structure": structure,
                })
                if structure == "MISMATCH":
                    mismatches.append(rel)
                continue
            # それ以外（テンプレ・資料フォルダ等）は降りるだけ。ただし CA 直下の非数値フォルダは
            # 求職者フォルダではないので降りない（GPTメモ・面接対策 など）
            if containers:
                walk(ca, d, containers + [name])

    for ca in ca_dirs:
        before = len(rows)
        walk(ca, ca, [])
        print(f"     {ca.name}: {len(rows) - before} 件")

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    fields = ["ca_folder", "year", "yyyymm", "folder_name", "candidate_no",
              "name_part", "relative_path", "container_path", "structure"]
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    with_no = sum(1 for r in rows if r["candidate_no"])
    print()
    print(f"[OK] 求職者フォルダ {len(rows)} 件（番号あり {with_no} / 番号なし {len(rows) - with_no}）")
    print(f"[OK] 構造不一致（{{年}}/{{年月}} 2階層でない） {len(mismatches)} 件")
    print(f"[OK] 出力: {OUT_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
