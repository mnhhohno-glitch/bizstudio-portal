// T-151 Phase 2-8: staging E2E 検証（UI描画以外を全自動で確認する）。
//
// 実行:
//   npx tsx scripts/verify_t151_staging.ts --dry-run     … 準備状況のみ（DB書き込みなし）
//   npx tsx scripts/verify_t151_staging.ts --execute     … 全ケース実行
//   npx tsx scripts/verify_t151_staging.ts --cleanup     … 後片付けのみ
//
// 必要な環境変数: DATABASE_URL / ANTHROPIC_API_KEY
//   T151_VERIFY_SEND_LINE=1 のときだけ V-2 で LINE WORKS へ実送信する（既定は V-2 をスキップ）。
//
// ★安全設計
//   - 対象は大野テスト（candidateNumber=5999999）のみ。別 ID なら即異常終了する。
//   - 生成したレコード ID は scripts/.t151_verify_state.json に記録し、--cleanup で片付ける。
//   - LINE 通知は V-2 を除き globalThis.fetch を差し替えて捕捉するだけで送信しない
//     （モジュール差し替えは tsx の ESM 相互運用下で効かないため、fetch 層で止める）。
//   - AdvisorUsageLog の行は費用記録なので消さない。
//
// ★注意: staging と本番は同一 Postgres。ここで作るデータは実データになる。

import { randomUUID } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const CANDIDATE_ID = "cmmn4jipg00011dqt23w1q3bk";
const CANDIDATE_NUMBER = "5999999";
const ACTOR_USER_ID = "cml9jturt00037k4ftqsi6yvz"; // 大野 将幸（admin）
const EMPLOYEE_ID = "cmlqr5h1n0000tg4f6h6gbhcn"; // 大野 将幸（Employee）＝担当CA
const STAGING = "https://bizstudio-portal-staging-production.up.railway.app";
const STATE_PATH = join(process.cwd(), "scripts", ".t151_verify_state.json");

// KIND_CONFIG（src/lib/ai-task-create.ts）と一致していることを検証で使う。
const EXPECTED_CATEGORY: Record<string, string> = {
  JOB_SEARCH_SEND: "cmmvzf6ct001m1doafno6y037",
  FORM_SURVEY: "cmsaluhq00001w8d6irm5omcs",
};

type State = {
  interviewIds: string[];
  taskIds: string[];
  advisorSessionId: string | null;
  advisorMessageIds: string[];
  archivedFileId: string | null;
};

const emptyState = (): State => ({
  interviewIds: [],
  taskIds: [],
  advisorSessionId: null,
  advisorMessageIds: [],
  archivedFileId: null,
});

function loadState(): State {
  if (!existsSync(STATE_PATH)) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(readFileSync(STATE_PATH, "utf-8")) };
  } catch {
    return emptyState();
  }
}
function saveState(s: State) {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), "utf-8");
}

/* ------------------------------------------------------------------ */
/*  結果集計                                                           */
/* ------------------------------------------------------------------ */

const results: { id: string; pass: boolean | null; detail: string }[] = [];
function record(id: string, pass: boolean | null, detail: string) {
  results.push({ id, pass, detail });
  const mark = pass === null ? "SKIP" : pass ? "PASS" : "FAIL";
  console.log(`\n[${mark}] ${id}\n        ${detail.replace(/\n/g, "\n        ")}`);
}

/* ------------------------------------------------------------------ */
/*  HTTP（staging・cookie 認証）                                        */
/* ------------------------------------------------------------------ */

// LINE 捕捉のために差し替えることがあるので、素の fetch を保持しておく。
const realFetch = globalThis.fetch.bind(globalThis);

async function api(path: string, init: RequestInit = {}) {
  const res = await realFetch(`${STAGING}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: `bs_session=${ACTOR_USER_ID}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML エラーページ等 */
  }
  return { status: res.status, json, text };
}

/* ------------------------------------------------------------------ */
/*  LINE 通知の捕捉（fetch 層で止める）                                  */
/* ------------------------------------------------------------------ */

/** LINE WORKS へ出ようとしたメッセージ本文を捕捉し、実送信はしない。 */
function installLineSpy(captured: string[]) {
  // 署名だけは通す必要があるので使い捨ての RSA 鍵を入れる（実鍵は使わない）。
  if (!process.env.LINEWORKS_PRIVATE_KEY) {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.LINEWORKS_PRIVATE_KEY = privateKey;
  }
  process.env.LINEWORKS_CLIENT_ID ||= "spy-client";
  process.env.LINEWORKS_CLIENT_SECRET ||= "spy-secret";
  process.env.LINEWORKS_SERVICE_ACCOUNT ||= "spy@example.invalid";
  process.env.LINEWORKS_TASK_BOT_ID ||= "spy-bot";
  process.env.LINEWORKS_TASK_CHANNEL_ID ||= "spy-channel";
  process.env.PORTAL_BASE_URL ||= STAGING;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("auth.worksmobile.com")) {
      return new Response(JSON.stringify({ access_token: "spy-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("worksapis.com")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      captured.push(body?.content?.text ?? "(text なし)");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
}

function removeLineSpy() {
  globalThis.fetch = realFetch as typeof fetch;
}

/* ------------------------------------------------------------------ */
/*  DB ヘルパ                                                          */
/* ------------------------------------------------------------------ */

let db: Client;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params as never[]);
  return r.rows as T[];
}

/**
 * tasks.due_date（timestamp without time zone）を "YYYY-MM-DD HH24:MI:SS" の文字列で取る。
 *
 * ★node-pg は timestamp without time zone を「クライアントのローカルTZ」で Date 化するため、
 *   JST の手元で .toISOString() すると 9時間ずれて見える（保存値そのものはズレていない）。
 *   保存形式の検証は必ず SQL 側で文字列化して行う。
 */
async function dueDateText(taskId: string): Promise<string | null> {
  const r = await q<{ d: string | null }>(
    `SELECT to_char(due_date, 'YYYY-MM-DD HH24:MI:SS') AS d FROM tasks WHERE id=$1`,
    [taskId],
  );
  return r[0]?.d ?? null;
}

async function usageCount(): Promise<number> {
  const r = await q<{ c: string }>(
    `SELECT count(*)::text AS c FROM advisor_usage_logs WHERE endpoint='interview-task-detect'`,
  );
  return Number(r[0].c);
}

async function openAiTasks() {
  return q<{ id: string; source_kind: string; due_date: Date | null; category_id: string; created_by_user_id: string; status: string }>(
    `SELECT id, source_kind, due_date, category_id, created_by_user_id, status FROM tasks
     WHERE candidate_id=$1 AND source='AI_ADVISOR' AND status<>'COMPLETED'`,
    [CANDIDATE_ID],
  );
}

async function createVerifyInterview(label: string, state: State): Promise<string> {
  const id = `t151v_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await q(
    `INSERT INTO interview_records
      (id, candidate_id, interview_date, start_time, end_time, interview_tool, interviewer_user_id,
       interview_type, created_by_user_id, status, is_latest, created_at, updated_at, interview_memo)
     VALUES ($1,$2,now(),'09:00','10:00','電話',$3,'初回面談',$3,'draft',false,now(),now(),$4)`,
    [id, CANDIDATE_ID, EMPLOYEE_ID, `[T-151検証] ${label}`],
  );
  state.interviewIds.push(id);
  saveState(state);
  return id;
}

/* ------------------------------------------------------------------ */
/*  main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const mode = process.argv.includes("--execute")
    ? "execute"
    : process.argv.includes("--cleanup")
      ? "cleanup"
      : "dry-run";

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL が未設定です");

  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  // ---- ガード: 大野テスト以外では絶対に動かさない ----
  const cand = await q<{ id: string; candidate_number: string; name: string }>(
    `SELECT id, candidate_number, name FROM candidates WHERE id=$1`,
    [CANDIDATE_ID],
  );
  if (cand.length === 0 || cand[0].candidate_number !== CANDIDATE_NUMBER) {
    throw new Error(
      `対象求職者が大野テスト（${CANDIDATE_NUMBER}）ではありません: ${JSON.stringify(cand[0] ?? null)}`,
    );
  }
  console.log(`対象求職者: ${cand[0].name} (${cand[0].candidate_number}) / mode=${mode}`);

  const state = loadState();

  if (mode === "cleanup") {
    await cleanup(state);
    await db.end();
    return;
  }

  if (mode === "dry-run") {
    const files = await q<{ id: string; file_name: string; archived_at: Date | null }>(
      `SELECT id, file_name, archived_at FROM candidate_files
       WHERE candidate_id=$1 AND category='MEETING' ORDER BY created_at DESC`,
      [CANDIDATE_ID],
    );
    const txt = files.filter((f) => f.file_name.toLowerCase().endsWith(".txt"));
    console.log(`\nMEETING ファイル: ${files.length}件（txt=${txt.length}）`);
    files.forEach((f) => console.log(`  - ${f.file_name} archived=${f.archived_at ?? "null"}`));
    console.log(`未完了の AI起票タスク: ${(await openAiTasks()).length}件`);
    console.log(`interview-task-detect の usage 行: ${await usageCount()}件`);
    console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "あり" : "なし"}`);
    console.log(`T151_VERIFY_SEND_LINE: ${process.env.T151_VERIFY_SEND_LINE === "1" ? "1（V-2 実送信）" : "未設定（V-2 スキップ）"}`);
    const st = await api("/api/interviews?limit=1");
    console.log(`staging 認証チェック: GET /api/interviews -> ${st.status}（200 なら cookie 認証OK）`);
    console.log("\n--dry-run のため書き込みは行っていません。");
    await db.end();
    return;
  }

  /* ================= execute ================= */

  // 事前に未完了 AI起票タスクを掃除（前回検証の残りがあると created=false になり判定が崩れる）
  const pre = await openAiTasks();
  if (pre.length > 0) {
    await q(`UPDATE tasks SET status='COMPLETED' WHERE id = ANY($1::text[])`, [pre.map((t) => t.id)]);
    console.log(`\n前回残りの未完了AI起票タスク ${pre.length}件を COMPLETED にしました`);
  }

  const IV_A = await createVerifyInterview("cross-route", state);
  const IV_MAIN = await createVerifyInterview("main", state);
  const IV_DISMISS = await createVerifyInterview("dismiss", state);
  const IV_NOTXT = await createVerifyInterview("no-txt", state);
  console.log(`\n検証用面談を作成: ${[IV_A, IV_MAIN, IV_DISMISS, IV_NOTXT].join(", ")}`);

  /* ---------- Phase A: 通知文面の捕捉（送信しない）＋ 経路またぎ（advisor→面談） ---------- */

  const capturedAdvisor: string[] = [];
  const capturedInterview: string[] = [];

  installLineSpy(capturedAdvisor);
  const { createAiTask } = await import("../src/lib/ai-task-create");

  const advisorCreate = await createAiTask({
    candidateId: CANDIDATE_ID,
    kind: "JOB_SEARCH_SEND",
    dueDateStr: "2026-08-07",
    origin: "advisor",
    actor: { id: ACTOR_USER_ID, name: "大野 将幸" },
  });
  if (advisorCreate.ok && advisorCreate.created) state.taskIds.push(advisorCreate.taskId);
  saveState(state);

  removeLineSpy();
  installLineSpy(capturedInterview);
  const interviewCreate = await createAiTask({
    candidateId: CANDIDATE_ID,
    kind: "FORM_SURVEY",
    dueDateStr: "2026-08-07",
    origin: "interview",
    actor: { id: ACTOR_USER_ID, name: "大野 将幸" },
  });
  if (interviewCreate.ok && interviewCreate.created) state.taskIds.push(interviewCreate.taskId);
  saveState(state);
  removeLineSpy();

  const advisorText = capturedAdvisor[0] ?? "";
  const interviewText = capturedInterview[0] ?? "";
  const v11ok =
    advisorText.includes("AIが検出した約束") &&
    advisorText.includes("AIアドバイザーの会話") &&
    interviewText.includes("面談ログの解析") &&
    !advisorText.includes("面談ログの解析") &&
    !interviewText.includes("AIアドバイザーの会話");
  record(
    "V-11 通知文面（検出元の出し分け・スパイで捕捉、実送信なし）",
    v11ok,
    `advisor 経路:\n----\n${advisorText}\n----\n面談経路:\n----\n${interviewText}\n----`,
  );

  // V-4（逆順: advisor 起票済み → 面談経路で同種を create）
  const v4rev = await api(`/api/interviews/${IV_A}/suggested-tasks`, {
    method: "PATCH",
    body: JSON.stringify({ action: "create", kind: "JOB_SEARCH_SEND", dueDate: "2026-08-11" }),
  });
  const advisorTaskId = advisorCreate.ok ? advisorCreate.taskId : "";
  const v4revDue = await dueDateText(advisorTaskId);
  const v4revOk =
    v4rev.status === 200 &&
    v4rev.json?.created === false &&
    v4rev.json?.taskId === advisorTaskId &&
    v4revDue === "2026-08-11 00:00:00";
  record(
    "V-4a 経路またぎ（advisor 起票 → 面談経路で create）",
    v4revOk,
    `status=${v4rev.status} created=${v4rev.json?.created} taskId一致=${v4rev.json?.taskId === advisorTaskId} ` +
      `既存タスクの due_date=${v4revDue}（新規タスクは増えていない）`,
  );

  // 以降のケースのために Phase A のタスクを完了させる
  await q(`UPDATE tasks SET status='COMPLETED' WHERE id = ANY($1::text[])`, [state.taskIds]);

  /* ---------- Phase B: HTTP 経由 ---------- */

  const usageBefore = await usageCount();

  // V-1: 解析 → 検出 → 保存
  const t0 = Date.now();
  const v1 = await api(`/api/interviews/${IV_MAIN}/analyze-with-intake`, {
    method: "POST",
    body: JSON.stringify({ candidateId: CANDIDATE_ID }),
  });
  const v1Db = await q<{ suggested_tasks: unknown }>(
    `SELECT suggested_tasks FROM interview_records WHERE id=$1`,
    [IV_MAIN],
  );
  const v1Resp = Array.isArray(v1.json?.suggestedTasks) ? (v1.json!.suggestedTasks as unknown[]) : null;
  const v1DbVal = v1Db[0]?.suggested_tasks as unknown[] | null;
  const usageAfterV1 = await usageCount();
  const v1ok =
    v1.status === 200 &&
    v1Resp !== null &&
    usageAfterV1 === usageBefore + 1 &&
    (v1Resp.length === 0 ? v1DbVal == null : Array.isArray(v1DbVal) && v1DbVal.length === v1Resp.length);
  record(
    "V-1 面談ログ解析→検出→保存",
    v1ok,
    `status=${v1.status} 所要=${Math.round((Date.now() - t0) / 1000)}s レスポンス suggestedTasks=${JSON.stringify(v1Resp)} ` +
      `DB suggested_tasks=${JSON.stringify(v1DbVal)} usage件数 ${usageBefore}→${usageAfterV1}`,
  );

  // V-12: 復元に必要な形を保っているか
  const shapeOk =
    Array.isArray(v1DbVal) &&
    v1DbVal.length > 0 &&
    v1DbVal.every((t) => {
      const o = t as Record<string, unknown>;
      return (
        typeof o.kind === "string" &&
        ["JOB_SEARCH_SEND", "FORM_SURVEY"].includes(o.kind) &&
        typeof o.due === "string" &&
        typeof o.dueDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate)
      );
    });
  record(
    "V-12 復元値の形（種別・相対表現・計算済み期日）",
    Array.isArray(v1DbVal) && v1DbVal.length > 0 ? shapeOk : null,
    Array.isArray(v1DbVal) && v1DbVal.length > 0
      ? `DB値=${JSON.stringify(v1DbVal)}`
      : "V-1 で候補が0件だったため判定不能（ログに約束が含まれていない）",
  );

  const kindForCreate =
    Array.isArray(v1DbVal) && v1DbVal.length > 0
      ? ((v1DbVal[0] as Record<string, unknown>).kind as string)
      : "JOB_SEARCH_SEND";

  // V-2: 起票（HTTPラッパー経由・実送信）
  const sendLine = process.env.T151_VERIFY_SEND_LINE === "1";
  if (sendLine) {
    const v2 = await api(`/api/interviews/${IV_MAIN}/suggested-tasks`, {
      method: "PATCH",
      body: JSON.stringify({ action: "create", kind: kindForCreate, dueDate: "2026-08-07" }),
    });
    const t = v2.json?.taskId
      ? await q<{
          id: string;
          category_id: string;
          created_by_user_id: string;
          source: string;
          source_kind: string;
        }>(
          `SELECT id, category_id, created_by_user_id, source, source_kind FROM tasks WHERE id=$1`,
          [v2.json.taskId as string],
        )
      : [];
    const asg = t.length
      ? await q<{ employee_id: string }>(`SELECT employee_id FROM task_assignees WHERE task_id=$1`, [t[0].id])
      : [];
    if (v2.json?.created && v2.json?.taskId) {
      state.taskIds.push(v2.json.taskId as string);
      saveState(state);
    }
    const dueIso = v2.json?.taskId ? await dueDateText(v2.json.taskId as string) : null;
    const v2ok =
      v2.status === 200 &&
      v2.json?.created === true &&
      t[0]?.source === "AI_ADVISOR" &&
      t[0]?.source_kind === kindForCreate &&
      t[0]?.category_id === EXPECTED_CATEGORY[kindForCreate] &&
      t[0]?.created_by_user_id === ACTOR_USER_ID &&
      dueIso === "2026-08-07 00:00:00" &&
      asg.some((a) => a.employee_id === EMPLOYEE_ID);
    record(
      "V-2 起票（HTTP経由・LINE実送信）",
      v2ok,
      `status=${v2.status} created=${v2.json?.created} taskId=${v2.json?.taskId}\n` +
        `source=${t[0]?.source} sourceKind=${t[0]?.source_kind} categoryId=${t[0]?.category_id}（期待 ${EXPECTED_CATEGORY[kindForCreate]}）\n` +
        `createdByUserId=${t[0]?.created_by_user_id}（期待 ${ACTOR_USER_ID}） assignees=${JSON.stringify(asg.map((a) => a.employee_id))}（期待 ${EMPLOYEE_ID}）\n` +
        `dueDate（DB実値・SQLで文字列化）=${dueIso}（"2026-08-07 00:00:00" 期待＝暦日の 0:00 形式）`,
    );

    // V-3: 期日のみ更新
    const countBefore = (await q<{ c: string }>(
      `SELECT count(*)::text AS c FROM tasks WHERE candidate_id=$1 AND source='AI_ADVISOR'`,
      [CANDIDATE_ID],
    ))[0].c;
    const v3 = await api(`/api/interviews/${IV_MAIN}/suggested-tasks`, {
      method: "PATCH",
      body: JSON.stringify({ action: "create", kind: kindForCreate, dueDate: "2026-08-14" }),
    });
    const countAfter = (await q<{ c: string }>(
      `SELECT count(*)::text AS c FROM tasks WHERE candidate_id=$1 AND source='AI_ADVISOR'`,
      [CANDIDATE_ID],
    ))[0].c;
    const due3 = await dueDateText(v2.json?.taskId as string);
    const v3ok =
      v3.status === 200 &&
      v3.json?.created === false &&
      v3.json?.taskId === v2.json?.taskId &&
      countBefore === countAfter &&
      due3 === "2026-08-14 00:00:00";
    record(
      "V-3 期日のみ更新",
      v3ok,
      `status=${v3.status} created=${v3.json?.created}（false 期待） taskId一致=${v3.json?.taskId === v2.json?.taskId} ` +
        `AI起票タスク件数 ${countBefore}→${countAfter}（不変であること） due_date=${due3}（2026-08-14 00:00:00 期待）`,
    );

    // V-4b（順方向: 面談で起票済み → advisor 経路で create）＋ V-10（advisor 経路の回帰）
    const sessionId = `t151v_s_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const messageId = `t151v_m_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    // created_by_user_id は NOT NULL（User への FK）。
    await q(
      `INSERT INTO advisor_chat_sessions (id, candidate_id, title, created_by_user_id, created_at, updated_at)
       VALUES ($1,$2,'[T-151検証]',$3,now(),now())`,
      [sessionId, CANDIDATE_ID, ACTOR_USER_ID],
    );
    await q(
      `INSERT INTO advisor_chat_messages (id, session_id, role, content, created_at, suggested_tasks)
       VALUES ($1,$2,'assistant','[T-151検証]',now(),$3::jsonb)`,
      [messageId, sessionId, JSON.stringify([{ kind: kindForCreate, due: "this_week", dueDate: "2026-08-07" }])],
    );
    state.advisorSessionId = sessionId;
    state.advisorMessageIds.push(messageId);
    saveState(state);

    const v4fwd = await api(
      `/api/candidates/${CANDIDATE_ID}/advisor/sessions/${sessionId}/messages/${messageId}/suggested-tasks`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "create", kind: kindForCreate, dueDate: "2026-08-21" }),
      },
    );
    const due4 = await dueDateText(v2.json?.taskId as string);
    const v4fwdOk =
      v4fwd.status === 200 &&
      v4fwd.json?.created === false &&
      v4fwd.json?.taskId === v2.json?.taskId &&
      due4 === "2026-08-21 00:00:00";
    record(
      "V-4b 経路またぎ（面談で起票 → advisor 経路で create）",
      v4fwdOk,
      `status=${v4fwd.status} created=${v4fwd.json?.created} taskId一致=${v4fwd.json?.taskId === v2.json?.taskId} due_date=${due4}（2026-08-21 00:00:00 期待）`,
    );

    // V-10: advisor 経路のレスポンス形状（Phase 2-2 前と同一であること）
    const keysCreate = v4fwd.json ? Object.keys(v4fwd.json).sort().join(",") : "";
    const dismissMsgId = `t151v_m_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await q(
      `INSERT INTO advisor_chat_messages (id, session_id, role, content, created_at, suggested_tasks)
       VALUES ($1,$2,'assistant','[T-151検証 dismiss]',now(),$3::jsonb)`,
      [dismissMsgId, sessionId, JSON.stringify([{ kind: kindForCreate, due: "none", dueDate: "2026-08-07" }])],
    );
    state.advisorMessageIds.push(dismissMsgId);
    saveState(state);
    const v10d = await api(
      `/api/candidates/${CANDIDATE_ID}/advisor/sessions/${sessionId}/messages/${dismissMsgId}/suggested-tasks`,
      { method: "PATCH", body: JSON.stringify({ action: "dismiss" }) },
    );
    const v10bad = await api(
      `/api/candidates/${CANDIDATE_ID}/advisor/sessions/${sessionId}/messages/${dismissMsgId}/suggested-tasks`,
      { method: "PATCH", body: JSON.stringify({ action: "create", kind: "NOPE", dueDate: "2026-08-07" }) },
    );
    const v10ok =
      keysCreate === "created,dueDate,ok,taskId" &&
      v10d.status === 200 &&
      v10d.json?.ok === true &&
      v10d.json?.dismissed === true &&
      v10bad.status === 400;
    record(
      "V-10 advisor 経路の回帰（レスポンス形状・ステータス）",
      v10ok,
      `create のキー=[${keysCreate}]（期待 created,dueDate,ok,taskId）\n` +
        `dismiss: status=${v10d.status} body=${JSON.stringify(v10d.json)}\n` +
        `不正kind: status=${v10bad.status}（400 期待） body=${JSON.stringify(v10bad.json)}`,
    );
  } else {
    record("V-2 起票（HTTP経由・LINE実送信）", null, "T151_VERIFY_SEND_LINE=1 が未設定のためスキップ");
    record("V-3 期日のみ更新", null, "V-2 スキップに伴いスキップ");
    record("V-4b 経路またぎ（面談で起票 → advisor 経路で create）", null, "V-2 スキップに伴いスキップ");
    record("V-10 advisor 経路の回帰", null, "V-2 スキップに伴いスキップ");
  }

  // V-5: 破棄
  const v5 = await api(`/api/interviews/${IV_DISMISS}/suggested-tasks`, {
    method: "PATCH",
    body: JSON.stringify({ action: "dismiss" }),
  });
  const v5Db = await q<{ suggested_tasks_dismissed_at: Date | null }>(
    `SELECT suggested_tasks_dismissed_at FROM interview_records WHERE id=$1`,
    [IV_DISMISS],
  );
  const v5ok = v5.status === 200 && v5.json?.dismissed === true && v5Db[0]?.suggested_tasks_dismissed_at != null;
  record(
    "V-5 破棄",
    v5ok,
    `status=${v5.status} body=${JSON.stringify(v5.json)} suggested_tasks_dismissed_at=${v5Db[0]?.suggested_tasks_dismissed_at?.toISOString()}`,
  );

  // V-6: 破棄後は再検出しない（Anthropic 呼び出し自体が起きない＝usage が増えない）
  const usageBeforeV6 = await usageCount();
  const v6 = await api(`/api/interviews/${IV_DISMISS}/analyze-with-intake`, {
    method: "POST",
    body: JSON.stringify({ candidateId: CANDIDATE_ID }),
  });
  const usageAfterV6 = await usageCount();
  const v6Db = await q<{ suggested_tasks: unknown }>(
    `SELECT suggested_tasks FROM interview_records WHERE id=$1`,
    [IV_DISMISS],
  );
  const v6ok =
    v6.status === 200 &&
    usageAfterV6 === usageBeforeV6 &&
    (v6.json?.suggestedTasks as unknown[])?.length === 0 &&
    v6Db[0]?.suggested_tasks == null;
  record(
    "V-6 破棄後は再検出しない",
    v6ok,
    `status=${v6.status} suggestedTasks=${JSON.stringify(v6.json?.suggestedTasks)} ` +
      `usage件数 ${usageBeforeV6}→${usageAfterV6}（不変であること） DB suggested_tasks=${JSON.stringify(v6Db[0]?.suggested_tasks)}`,
  );

  // V-7: fail-open（txt 無し）— 大野テストの MEETING txt を一時的に archived にする
  const txtFile = await q<{ id: string }>(
    `SELECT id FROM candidate_files WHERE candidate_id=$1 AND category='MEETING'
       AND lower(file_name) LIKE '%.txt' AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [CANDIDATE_ID],
  );
  let v7ok: boolean | null = null;
  let v7detail = "対象の txt が見つからないためスキップ";
  if (txtFile.length > 0) {
    state.archivedFileId = txtFile[0].id;
    saveState(state);
    await q(`UPDATE candidate_files SET archived_at=now() WHERE id=$1`, [txtFile[0].id]);
    const usageBeforeV7 = await usageCount();
    const v7 = await api(`/api/interviews/${IV_NOTXT}/analyze-with-intake`, {
      method: "POST",
      body: JSON.stringify({ candidateId: CANDIDATE_ID }),
    });
    const usageAfterV7 = await usageCount();
    await q(`UPDATE candidate_files SET archived_at=NULL WHERE id=$1`, [txtFile[0].id]);
    state.archivedFileId = null;
    saveState(state);
    // ★txt 無し（PDFのみ）の解析は T-151 とは無関係に既存不具合で 502 になる。
    //   analyze-with-intake は interviewLog が空のとき upstream へ " "（空白1文字）を送るが、
    //   candidate-intake 側が "interviewLog is required and must be a non-empty string" で 400 を返す。
    //   この 400 は route の L132-138（upstream 応答チェック）で 502 に変換され、
    //   T-151 の検出コード（同 route の後段）には到達しない。
    //   よってここで検証できるのは「T-151 が Anthropic を呼ばないこと」と
    //   「502 が T-151 由来ではなく既存の upstream エラーであること」の2点。
    const upstreamPreexistingBug =
      v7.status === 502 && /解析サービスエラー \(400\)/.test(String(v7.json?.error ?? ""));
    v7ok =
      usageAfterV7 === usageBeforeV7 &&
      (v7.status === 200
        ? (v7.json?.suggestedTasks as unknown[])?.length === 0
        : upstreamPreexistingBug);
    v7detail =
      `txt を一時 archived にして解析 → status=${v7.status} error=${JSON.stringify(v7.json?.error ?? null)}\n` +
      `usage件数 ${usageBeforeV7}→${usageAfterV7}（不変＝T-151 は Anthropic を呼んでいない）\n` +
      (v7.status === 200
        ? `解析本体も正常終了（suggestedTasks=${JSON.stringify(v7.json?.suggestedTasks)}）`
        : `★502 は T-151 到達前の既存不具合（analyze-with-intake が upstream へ空白1文字の interviewLog を送り、candidate-intake が 400 で弾く）。T-151 の検出コードには到達していない。\n` +
          `  同じ「検出をスキップして 200 を返す」経路は V-6（破棄済み面談）で検証済み。`) +
      `\narchived_at は復元済み`;
  }
  record("V-7 fail-open（txt 無し）", v7ok, v7detail);

  // V-8: fail-open（AI 失敗）— 不正キーで検出関数を直接呼ぶ
  const realKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-invalid-key-for-verification";
  const { detectSuggestedTasksFromInterviewLog } = await import(
    "../src/lib/interview/detect-suggested-tasks"
  );
  let v8ok = false;
  let v8detail = "";
  try {
    const r = await detectSuggestedTasksFromInterviewLog({
      interviewLog: "話者 1 00:01 今週中に求人をピックアップして送りますね。",
      candidateId: CANDIDATE_ID,
    });
    v8ok = r.suggestedTasks.length === 0 && !!r.skippedReason;
    v8detail = `例外を投げずに戻った: suggestedTasks=${JSON.stringify(r.suggestedTasks)} skippedReason=${r.skippedReason}`;
  } catch (e) {
    v8detail = `例外が投げられた（NG）: ${(e as Error).message}`;
  }
  process.env.ANTHROPIC_API_KEY = realKey;
  record("V-8 fail-open（AI 失敗）", v8ok, v8detail);

  // V-9: usage 記録と costUsd
  const usageRows = await q<{ id: string; model: string; cost_usd: string; input_tokens: number; output_tokens: number; note: string }>(
    `SELECT id, model, cost_usd::text, input_tokens, output_tokens, COALESCE(note,'') AS note
     FROM advisor_usage_logs WHERE endpoint='interview-task-detect' ORDER BY created_at DESC LIMIT 5`,
  );
  const paid = usageRows.filter((r) => Number(r.cost_usd) > 0);
  const v9ok = usageRows.length > 0 && paid.length > 0;
  record(
    "V-9 usage 記録（costUsd が 0 でない）",
    v9ok,
    `endpoint='interview-task-detect' の直近行:\n` +
      usageRows
        .map((r) => `  model=${r.model} cost_usd=${r.cost_usd} in=${r.input_tokens} out=${r.output_tokens} note=${r.note}`)
        .join("\n"),
  );

  /* ---------- サマリ ---------- */
  const pass = results.filter((r) => r.pass === true).length;
  const fail = results.filter((r) => r.pass === false).length;
  const skip = results.filter((r) => r.pass === null).length;
  console.log(`\n================ PASS=${pass} FAIL=${fail} SKIP=${skip} ================`);
  if (fail > 0) {
    console.log("FAILED: " + results.filter((r) => r.pass === false).map((r) => r.id).join(" / "));
    process.exitCode = 1;
  }
  console.log(`\n後片付けは --cleanup を実行してください（state: ${STATE_PATH}）`);

  await db.end();
}

/* ------------------------------------------------------------------ */
/*  cleanup                                                            */
/* ------------------------------------------------------------------ */

async function cleanup(state: State) {
  console.log("\n--- cleanup 開始 ---");

  // 1) 検証で作ったタスクは完了扱いにする（物理削除しない）
  if (state.taskIds.length > 0) {
    const r = await q<{ id: string }>(
      `UPDATE tasks SET status='COMPLETED' WHERE id = ANY($1::text[]) RETURNING id`,
      [state.taskIds],
    );
    console.log(`タスクを COMPLETED にしました: ${r.length}件 / 記録 ${state.taskIds.length}件`);
  }
  // 検証中に別経路で増えた未完了 AI起票タスクも掃除する
  const stillOpen = await openAiTasks();
  if (stillOpen.length > 0) {
    await q(`UPDATE tasks SET status='COMPLETED' WHERE id = ANY($1::text[])`, [stillOpen.map((t) => t.id)]);
    console.log(`未完了のまま残っていた AI起票タスク ${stillOpen.length}件も COMPLETED にしました`);
  }

  // 2) advisor 検証メッセージ・セッションを削除
  if (state.advisorMessageIds.length > 0) {
    const r = await q<{ id: string }>(
      `DELETE FROM advisor_chat_messages WHERE id = ANY($1::text[]) RETURNING id`,
      [state.advisorMessageIds],
    );
    console.log(`advisor 検証メッセージを削除: ${r.length}件`);
  }
  if (state.advisorSessionId) {
    const r = await q<{ id: string }>(`DELETE FROM advisor_chat_sessions WHERE id=$1 RETURNING id`, [
      state.advisorSessionId,
    ]);
    console.log(`advisor 検証セッションを削除: ${r.length}件`);
  }

  // 3) 検証用面談を削除（子レコードを先に落とす）
  if (state.interviewIds.length > 0) {
    for (const t of ["interview_details", "interview_ratings", "interview_memos", "work_histories", "interview_attachments"]) {
      await q(`DELETE FROM ${t} WHERE interview_record_id = ANY($1::text[])`, [state.interviewIds]).catch(
        (e) => console.log(`  (${t} の削除はスキップ: ${(e as Error).message})`),
      );
    }
    const r = await q<{ id: string }>(
      `DELETE FROM interview_records WHERE id = ANY($1::text[]) RETURNING id`,
      [state.interviewIds],
    );
    console.log(`検証用面談を削除: ${r.length}件 / 記録 ${state.interviewIds.length}件`);
    if (r.length !== state.interviewIds.length) {
      console.log(
        `  ⚠ 削除できなかった面談: ${state.interviewIds.filter((i) => !r.some((x) => x.id === i)).join(", ")}`,
      );
    }
  }

  // 4) archived にしたままの添付を戻す
  if (state.archivedFileId) {
    await q(`UPDATE candidate_files SET archived_at=NULL WHERE id=$1`, [state.archivedFileId]);
    console.log(`添付の archived_at を復元: ${state.archivedFileId}`);
  }

  // 5) 大野テストの既存面談に検証で値が入っていたら NULL に戻す
  const cleared = await q<{ id: string }>(
    `UPDATE interview_records SET suggested_tasks=NULL, suggested_tasks_dismissed_at=NULL
     WHERE candidate_id=$1 AND (suggested_tasks IS NOT NULL OR suggested_tasks_dismissed_at IS NOT NULL)
     RETURNING id`,
    [CANDIDATE_ID],
  );
  console.log(`suggested_tasks 列を NULL に戻した面談: ${cleared.length}件`);

  console.log("AdvisorUsageLog の行は費用記録のため残しています。");
  if (existsSync(STATE_PATH)) unlinkSync(STATE_PATH);
  console.log("--- cleanup 完了 ---");
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
