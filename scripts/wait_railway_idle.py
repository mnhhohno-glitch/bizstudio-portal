#!/usr/bin/env python3
"""Railway 本番デプロイ idle 待機スクリプト（bizstudio-portal）。

master push 直前に呼ぶ。本番サービス（bizstudio-portal、master →
bizstudio-portal-production.up.railway.app）のデプロイが idle になるまでブロッキング
待機する。staging（検証）サービスは衝突無害のため対象外。

# 使い方
  Windows: py scripts\\wait_railway_idle.py ; if ($?) { git push origin master }
  Unix:    python3 scripts/wait_railway_idle.py && git push origin master

# 認証
  優先順:  環境変数 RAILWAY_TOKEN / RAILWAY_API_TOKEN
  既定:    Railway CLI 設定 ~/.railway/config.json の user.token
  ※トークン値は標準出力・ログに一切出さない。

# 終了コード
  0 = 本番が idle、または 30 分タイムアウト続行（push を止めない）
  1 = Railway 到達不可・致命的エラー（push が止まる）

# Railway への書き込み操作は一切しない（latestDeployment.status の読み取りのみ）。
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

# Windows コンソール（cp932）で絵文字が UnicodeEncodeError を出さないよう UTF-8 へ。
# 失敗しても致命とせず、replace で代替表示にフォールバック。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

GRAPHQL_URL = "https://backboard.railway.com/graphql/v2"
TARGET_PROJECT_NAME = "bizstudio-portal"
TARGET_DOMAIN = "bizstudio-portal-production.up.railway.app"  # 本番サービスの識別
TARGET_BRANCH = "master"

POLL_INTERVAL_SEC = 10
MAX_WAIT_SEC = 30 * 60  # 30 minutes
HTTP_TIMEOUT_SEC = 30

# Railway デプロイ状態
IN_PROGRESS = {"QUEUED", "INITIALIZING", "BUILDING", "DEPLOYING", "WAITING"}
TERMINAL = {"SUCCESS", "FAILED", "CRASHED", "REMOVED", "SKIPPED"}


def load_token():
    env = os.environ.get("RAILWAY_TOKEN") or os.environ.get("RAILWAY_API_TOKEN")
    if env:
        return env
    cfg = Path.home() / ".railway" / "config.json"
    if not cfg.exists():
        die(f"Railway 設定ファイルが見つかりません: {cfg}\n環境変数 RAILWAY_TOKEN を設定するか `railway login` を実行してください。")
    try:
        token = json.loads(cfg.read_text(encoding="utf-8")).get("user", {}).get("token")
    except json.JSONDecodeError as e:
        die(f"Railway 設定の JSON 解析失敗: {e}")
    if not token:
        die("Railway 設定に user.token がありません。`railway login` を実行してください。")
    return token


def gql(token, query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    # Railway は Python の既定 User-Agent ("Python-urllib/3.x") を 403 で弾くため明示。
    req = urllib.request.Request(
        GRAPHQL_URL, data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "bizstudio-portal-wait-railway-idle/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SEC) as r:
        return json.loads(r.read().decode("utf-8"))


PROJECT_QUERY = """
query($id: String!) {
  project(id: $id) {
    services { edges { node {
      name
      serviceInstances { edges { node {
        environmentId
        domains { serviceDomains { domain } customDomains { domain } }
        latestDeployment { meta status }
      } } }
    } } }
  }
}
"""


def resolve_project_id():
    """Railway CLI の linked-projects 設定（~/.railway/config.json の projects マップ）から
    プロジェクト名で検索して ID を返す。UUID をスクリプトにハードコードしない。
    どの worktree（portal-1/portal-2 等）から実行されてもプロジェクト名で一致する。
    """
    cfg = Path.home() / ".railway" / "config.json"
    if not cfg.exists():
        raise RuntimeError(f"Railway 設定が見つかりません: {cfg}（`railway login && railway link` を実行してください）")
    try:
        projects = (json.loads(cfg.read_text(encoding="utf-8")).get("projects") or {})
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Railway 設定の JSON 解析失敗: {e}")
    for _path, entry in projects.items():
        if (entry or {}).get("name") == TARGET_PROJECT_NAME:
            pid = entry.get("project")
            if pid:
                return pid
    names = [(v or {}).get("name") for v in projects.values()]
    raise RuntimeError(
        f"linked-projects に {TARGET_PROJECT_NAME!r} がありません（候補: {names}）。"
        f"対象 worktree で `railway link` を一度実行してください。"
    )


def fetch_latest_status(token, project_id):
    """本番ドメインを持つ ServiceInstance の latestDeployment.status を返す。
    Returns: (service_name, status, branch)
    """
    resp = gql(token, PROJECT_QUERY, {"id": project_id})
    if "errors" in resp:
        raise RuntimeError(f"project クエリ失敗: {resp['errors']}")
    services = (((resp.get("data") or {}).get("project") or {}).get("services") or {}).get("edges") or []
    for svc_edge in services:
        svc = svc_edge.get("node") or {}
        for si in (svc.get("serviceInstances") or {}).get("edges") or []:
            inst = si.get("node") or {}
            domains = inst.get("domains") or {}
            sd = [d.get("domain") for d in (domains.get("serviceDomains") or [])]
            cd = [d.get("domain") for d in (domains.get("customDomains") or [])]
            if TARGET_DOMAIN in (sd + cd):
                ld = inst.get("latestDeployment") or {}
                meta = ld.get("meta") or {}
                return svc.get("name") or "?", (ld.get("status") or "NONE"), meta.get("branch")
    raise RuntimeError(f"本番サービス（ドメイン {TARGET_DOMAIN}）が見つかりません")


def die(msg, code=1):
    print(f"❌ {msg}", file=sys.stderr)
    sys.exit(code)


def main():
    try:
        token = load_token()
        project_id = resolve_project_id()
    except RuntimeError as e:
        die(str(e))

    try:
        svc, status, branch = fetch_latest_status(token, project_id)
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        die(f"Railway 到達不可: {e}")
    except RuntimeError as e:
        die(str(e))

    if branch and branch != TARGET_BRANCH:
        print(f"⚠️ 期待ブランチ {TARGET_BRANCH!r} ですが実際は {branch!r}（続行）")

    if status in TERMINAL or status == "NONE":
        print(f"✅ 本番デプロイ idle、push 可（service={svc}, status={status}）")
        return 0

    print(f"⏳ 本番デプロイ進行中（service={svc}, status={status}）— idle まで待機（最大 {MAX_WAIT_SEC // 60} 分、{POLL_INTERVAL_SEC} 秒ごとに再取得）")
    start = time.time()
    while True:
        time.sleep(POLL_INTERVAL_SEC)
        elapsed = int(time.time() - start)
        if elapsed >= MAX_WAIT_SEC:
            print(
                f"⚠️ {MAX_WAIT_SEC // 60} 分待っても本番デプロイが進行中（status={status}）。"
                "古いビルドが詰まっている可能性。push を続行する（git は累積のため安全、"
                "Railway が古いビルドを破棄して最新で再デプロイする）"
            )
            return 0
        try:
            _, status, _ = fetch_latest_status(token, project_id)
        except Exception as e:
            # 一時的なネットワーク失敗は許容（致命とせず再試行）
            print(f"  [{elapsed}s] 状態取得失敗（一時的、再試行）: {e}")
            continue
        if status in TERMINAL:
            print(f"✅ 本番デプロイ idle、push 可（service={svc}, status={status}, 待機 {elapsed}s）")
            return 0
        print(f"  [{elapsed}s] status={status}")


if __name__ == "__main__":
    sys.exit(main())
