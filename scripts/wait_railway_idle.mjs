#!/usr/bin/env node
/**
 * Railway 本番デプロイ idle 待機スクリプト（bizstudio-portal）— Node 版。
 *
 * master push 直前に呼ぶ。本番サービス（bizstudio-portal、master →
 * bizstudio-portal-production.up.railway.app）のデプロイが idle になるまでブロッキング待機する。
 * staging（検証）サービスは衝突無害のため対象外。
 *
 * 既存の scripts/wait_railway_idle.py と同一の判定・終了コードだが、
 * この開発環境には Python が入っていない（`python` は Windows ストアのスタブで実行不可）ため、
 * 以後はこちらを使う。Python 版は他環境向けに残してある。
 *
 * # 使い方
 *   node scripts/wait_railway_idle.mjs && git push origin master
 *   （PowerShell）node scripts/wait_railway_idle.mjs ; if ($?) { git push origin master }
 *
 * # 認証
 *   優先順: 環境変数 RAILWAY_TOKEN / RAILWAY_API_TOKEN
 *   既定:   Railway CLI 設定 ~/.railway/config.json の user.token
 *   ※トークン値は標準出力・ログに一切出さない。
 *
 * # 終了コード
 *   0 = 本番が idle、または 30 分タイムアウト続行（push を止めない）
 *   1 = Railway 到達不可・致命的エラー（push が止まる）
 *
 * # Railway への書き込み操作は一切しない（latestDeployment.status の読み取りのみ）。
 */

import fs from "fs";
import os from "os";
import path from "path";

const GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";
const TARGET_PROJECT_NAME = "bizstudio-portal";
const TARGET_DOMAIN = "bizstudio-portal-production.up.railway.app"; // 本番サービスの識別

const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 30 * 60 * 1000;
const HTTP_TIMEOUT_MS = 30_000;

// Railway デプロイ状態
const IN_PROGRESS = new Set(["QUEUED", "INITIALIZING", "BUILDING", "DEPLOYING", "WAITING"]);

const PROJECT_QUERY = `
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
`;

/**
 * 致命的エラー。
 *
 * ★ process.exit() を使わない。Windows / Node 24 では fetch(undici) の接続が生きたまま
 *   process.exit() を呼ぶと libuv が `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
 *   で異常終了し、**終了コードが 127 になる**。`node this.mjs && git push` が常に止まってしまう。
 *   代わりに例外を投げ、呼び出し元で process.exitCode を立ててから自然に抜ける。
 */
class FatalError extends Error {}

function die(msg) {
  throw new FatalError(msg);
}

function readRailwayConfig() {
  const cfgPath = path.join(os.homedir(), ".railway", "config.json");
  if (!fs.existsSync(cfgPath)) {
    die(`Railway 設定ファイルが見つかりません: ${cfgPath}\n環境変数 RAILWAY_TOKEN を設定するか \`railway login\` を実行してください。`);
  }
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (e) {
    die(`Railway 設定の JSON 解析失敗: ${e.message}`);
  }
}

/**
 * Railway CLI の linked-projects 設定（projects マップ）からプロジェクト名で ID を引く。
 * UUID をスクリプトにハードコードしない。どの worktree から実行しても名前で一致する。
 */
function resolveProjectId(config) {
  const projects = config.projects || {};
  for (const entry of Object.values(projects)) {
    if (entry?.name === TARGET_PROJECT_NAME && entry.project) return entry.project;
  }
  const names = Object.values(projects).map((v) => v?.name);
  die(`リンク済みプロジェクトに "${TARGET_PROJECT_NAME}" がありません（見つかったもの: ${JSON.stringify(names)}）。\`railway link\` を実行してください。`);
}

async function gql(token, projectId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Railway は既定の User-Agent を 403 で弾くことがあるため明示する。
        "User-Agent": "bizstudio-portal-wait-railway-idle/1.0",
      },
      body: JSON.stringify({ query: PROJECT_QUERY, variables: { id: projectId } }),
      signal: controller.signal,
    });
    if (!res.ok) die(`Railway API が HTTP ${res.status} を返しました: ${await res.text()}`);
    const json = await res.json();
    if (json.errors) die(`GraphQL エラー: ${JSON.stringify(json.errors)}`);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

/** 本番サービス（TARGET_DOMAIN を持つ service instance）の進行中ステータスを返す。idle なら null。 */
function findBusyStatus(data) {
  for (const svc of data.project.services.edges) {
    for (const si of svc.node.serviceInstances.edges) {
      const domains = [
        ...(si.node.domains?.serviceDomains ?? []).map((d) => d.domain),
        ...(si.node.domains?.customDomains ?? []).map((d) => d.domain),
      ];
      if (!domains.includes(TARGET_DOMAIN)) continue;
      const status = si.node.latestDeployment?.status;
      console.log(`[wait-railway-idle] service=${svc.node.name} status=${status ?? "(なし)"}`);
      if (IN_PROGRESS.has(status)) return status;
    }
  }
  return null;
}

async function main() {
  const config = readRailwayConfig();
  const token = process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN || config.user?.token;
  if (!token) die("Railway 設定に user.token がありません。`railway login` を実行してください。");
  const projectId = resolveProjectId(config);

  const startedAt = Date.now();
  for (;;) {
    const busy = findBusyStatus(await gql(token, projectId));
    if (!busy) {
      console.log("[wait-railway-idle] 本番は idle。push して問題ありません。");
      return;
    }
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      console.log("[wait-railway-idle] 30分待っても idle になりませんでした。push を止めずに続行します。");
      return;
    }
    console.log(`[wait-railway-idle] デプロイ進行中(${busy})。${POLL_INTERVAL_MS / 1000}秒後に再確認します…`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

try {
  await main();
  process.exitCode = 0;
} catch (e) {
  console.error(`[wait-railway-idle] ${e instanceof FatalError ? e.message : e}`);
  process.exitCode = 1;
}
// ここで process.exit() を呼ばない（上の FatalError のコメント参照）。
// undici の keep-alive ソケットが閉じ次第、Node が自然に終了する。
