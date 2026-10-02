// T-XXX step3: Railway の全プロジェクト・全環境・全サービスの環境変数を 1 本の JSON に書き出す。
//
// 用途: 毎晩のバックアップ（.github/workflows/db-backup.yml）で、外部サービスとつなぐ鍵
//       （LINE WORKS / Google / Anthropic / Supabase 等）を Railway の外に退避するため。
//       Railway が使えなくなっても、この JSON があれば別の場所に環境を作り直せる。
//
// 認証: 環境変数 RAILWAY_TOKEN（ワークスペース単位の API トークン。名前 "github-backup"）。
// 出力: 第1引数のパスに JSON を書く。標準出力には件数だけを出し、値は一切出さない。
//       出力ファイルは呼び出し側が必ず gpg で暗号化し、平文は残さない。
//
// Railway への書き込み操作は一切しない（variables / projects の読み取りのみ）。

import fs from "node:fs";

const GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

const outPath = process.argv[2];
if (!outPath) throw new Error("出力パスを第1引数に指定してください");
const token = process.env.RAILWAY_TOKEN;
if (!token) throw new Error("環境変数 RAILWAY_TOKEN が未設定です");

async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Railway は既定の User-Agent を 403 で弾くことがあるため明示する。
      "User-Agent": "bizstudio-portal-db-backup/1.0",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Railway API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL エラー: ${JSON.stringify(json.errors.map((e) => e.message))}`);
  return json.data;
}

const PROJECTS_QUERY = `
query {
  projects {
    edges { node {
      id name
      environments { edges { node { id name } } }
      services { edges { node { id name } } }
    } }
  }
}`;

const VARIABLES_QUERY = `
query($projectId: String!, $environmentId: String!, $serviceId: String) {
  variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
}`;

const data = await gql(PROJECTS_QUERY);
const projects = data.projects.edges.map((e) => e.node);

const out = {
  exportedAt: new Date().toISOString(),
  note: "Railway 全プロジェクトの環境変数。shared は環境共通変数、services は各サービスの変数（Railway が自動付与する RAILWAY_* も含む）。",
  projects: [],
};

let serviceCount = 0;
let variableCount = 0;
for (const p of projects) {
  const proj = { id: p.id, name: p.name, environments: [] };
  for (const envEdge of p.environments.edges) {
    const env = envEdge.node;
    const envOut = { id: env.id, name: env.name, shared: {}, services: [] };
    // 環境共通（shared）変数: serviceId を渡さずに取る
    try {
      const shared = await gql(VARIABLES_QUERY, { projectId: p.id, environmentId: env.id, serviceId: null });
      envOut.shared = shared.variables ?? {};
      variableCount += Object.keys(envOut.shared).length;
    } catch (e) {
      envOut.sharedError = String(e.message).slice(0, 200);
    }
    for (const svcEdge of p.services.edges) {
      const svc = svcEdge.node;
      const vars = await gql(VARIABLES_QUERY, { projectId: p.id, environmentId: env.id, serviceId: svc.id });
      const values = vars.variables ?? {};
      envOut.services.push({ id: svc.id, name: svc.name, variables: values });
      serviceCount += 1;
      variableCount += Object.keys(values).length;
    }
    proj.environments.push(envOut);
  }
  out.projects.push(proj);
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 2), { mode: 0o600 });
// 値は出さない。件数だけ。
console.log(`[railway-vars-export] projects=${projects.length} service-env pairs=${serviceCount} variables=${variableCount}`);
