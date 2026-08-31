/**
 * T-182 step3: 新定義(v3・72eade8)の試し判定と特徴抽出
 *
 * 目的: 「懸念ゼロ = 通過率A」が広すぎるのではないか、という step2 の宿題に対し、
 *       すでに選考結果が確定している過去の応募分へ新定義を当て直して、
 *       新定義Aの中で「進んだ求人 / 進まなかった求人」を分ける特徴を探す。
 *
 * 本番DBは読み取りのみ。評価は analyze-batch の dryRun=true で実行し DB へ書き戻さない。
 *
 * モード（前半は本番コンテナ /app 上で実行・後半はローカル）:
 *   [本番]   node t182_step3_dryrun_features.cjs pop         Phase1 母集団抽出+層化サンプリング(JSON を stdout)
 *   [本番]   node t182_step3_dryrun_features.cjs snapshot    実行前スナップショット(評価値ハッシュ+費用)
 *   [本番]   node t182_step3_dryrun_features.cjs run <limit> <sec> <conc>   dryRun 試し判定
 *   [本番]   node t182_step3_dryrun_features.cjs verify      書き戻しゼロの確認 + 費用差分
 *   [本番]   node t182_step3_dryrun_features.cjs status      進捗
 *   [本番]   node t182_step3_dryrun_features.cjs profile     面談ログ/主要書類の最終更新時刻
 *   [ローカル] node t182_step3_dryrun_features.cjs features  Phase3 生成テキスト→CSV
 *   [ローカル] node t182_step3_dryrun_features.cjs aggregate Phase4 CSV→集計 Markdown
 *
 * 本番側の入出力は /app 直下（コンテナは ephemeral・実行のたびに転送する）:
 *   /app/t182s3_sample.json   pop の出力（サンプル200件）
 *   /app/t182s3_out/<id>.txt  dryRun の生成テキスト
 * ローカル側:
 *   tmp/T-182_step3_dryrun/<id>.txt      生成テキスト（commit しない）
 *   tmp/T-182_step3_features.csv         Phase3 の特徴CSV
 *   tmp/T-182_step3_result.md            Phase4 の集計結果
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ===== 期間定義（JST基準・UTCで表現） =====
const PERIOD_START = "2026-05-13T15:00:00Z"; // JST 2026-05-14 00:00
const PERIOD_END = "2026-07-17T15:00:00Z"; // JST 2026-07-18 00:00（7/17 末まで）
const ENTRY_CUTOFF = new Date("2026-07-17T15:00:00Z"); // entry_date が JST 7/17 以前 = 結果が出そろった確定分

// ===== 本番コンテナ側のパス =====
const SAMPLE_PATH = "/app/t182s3_sample.json";
const SNAP_PATH = "/app/t182s3_snapshot.json";
const OUT_DIR_REMOTE = "/app/t182s3_out";
const ERR_PATH = "/app/t182s3_errors.jsonl";

// ===== ローカル側のパス =====
const LOCAL_TXT_DIR = "tmp/T-182_step3_dryrun";
const LOCAL_SAMPLE = "tmp/T-182_step3_sample.json";
const LOCAL_PROFILE = "tmp/T-182_step3_profile.json";
const LOCAL_CSV = "tmp/T-182_step3_features.csv";
const LOCAL_MD = "tmp/T-182_step3_result.md";

// ===================================================================
// 共通: 正規化・ランク抽出（scripts/analysis/t182_verification4.cjs と同一ロジック）
// ===================================================================
function stripFileMetadata(fileName) {
  return fileName
    .replace(/\.pdf$/i, "")
    .replace(/^求人票[_]?/, "")
    .replace(/^\d+_/, "")
    .replace(/_\d{10,}$/, "")
    .replace(/[：:]\d+$/, "")
    .replace(/_No\d+$/i, "")
    .trim();
}
const CORP_SUFFIXES = /株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g;
function norm(s) {
  if (!s) return "";
  return stripFileMetadata(String(s)).replace(CORP_SUFFIXES, "").trim().normalize("NFKC").toLowerCase().trim();
}
const stripBold = (c) => c.replace(/\*\*/g, "");
const axWish = (c) => (stripBold(c).match(/■\s*本人希望[：:\s]*([ABCD])/) || [])[1] || null;
const axPass = (c) => (stripBold(c).match(/■\s*通過率[：:\s]*([ABCD])/) || [])[1] || null;
const axTotal = (c) => (stripBold(c).match(/■\s*総合[：:\s]*(B\+|[ABCD])/) || [])[1] || null;

const STAGE_NAMES = ["エントリーのみ", "書類通過", "一次", "二次", "最終", "内定", "承諾"];
function stageOf(e) {
  if (e.acceptance_date) return 6;
  if (e.offer_date) return 5;
  if (e.final_interview_date) return 4;
  if (e.second_interview_date) return 3;
  if (e.first_interview_date) return 2;
  if (e.document_pass_date) return 1;
  return 0;
}

// ===================================================================
// 選考分析セクション（T-180 形式）のパース
// ===================================================================
const CA_MARK_CLASS = "[〇○◯▲△×✕✖]";
const ITEM_LINE_RE = new RegExp(`^\\s*【([^】]+)】\\s*(${CA_MARK_CLASS})\\s*$`);
function normMark(m) {
  if (m === "〇" || m === "○" || m === "◯") return "〇";
  if (m === "▲" || m === "△") return "▲";
  return "×";
}

/** 生成テキストから 3軸ランクと 選考分析の項目一覧（項目名・記号・コメント）を取り出す */
function parseAnalysis(text) {
  const lines = stripBold(text).split("\n");
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ITEM_LINE_RE);
    if (!m) continue;
    const comment = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "") break;
      if (ITEM_LINE_RE.test(l)) break;
      comment.push(l.trim());
    }
    items.push({ name: m[1].trim(), mark: normMark(m[2]), comment: comment.join(" ") });
  }
  return { wish: axWish(text), pass: axPass(text), total: axTotal(text), items };
}

/**
 * 項目名を「選考観点 / 本人希望観点」に分類する。
 * EVAL_RULES（analyze-batch route.ts）の「数える／数えない」リストをそのまま写している。
 *   数える  : 必須要件充足 / 経験・スキル / 経験の質 / 経験年数 / 年齢レンジ / 転職回数 /
 *             求人の想定年収レンジからの逸脱 / 歓迎要件 / 選考難易度
 *   数えない: 固定残業 / 年間休日 / 通勤距離・勤務地 / 職種の好み / 希望年収
 * 「年収」だけはどちらにも読めるため、SEL 版と WISH 版の2通りを出して
 * 実際に出た通過率ランクとの整合率で採用側を決める（aggregate で報告）。
 */
const WISH_RE = /本人希望|志向|方向性|職種の好み|固定残業|残業|年間休日|休日|通勤|勤務地|勤務条件|働き方|雇用形態|契約社員|企業規模|組織|定着/;
const SEL_RE = /必須要件|学歴|資格|免許|経験|スキル|年齢|転職回数|在籍|離職|選考|歓迎|業種|業界|実績|応募|英語|管理部門/;
function classifyItem(name, salaryAsSel) {
  if (/年収/.test(name)) {
    // 「年収」を含む項目は他のキーワードより優先して扱いを固定する
    if (/勤務地|通勤|休日|残業|勤務条件/.test(name)) return "WISH";
    return salaryAsSel ? "SEL" : "WISH";
  }
  if (WISH_RE.test(name)) return "WISH";
  if (SEL_RE.test(name)) return "SEL";
  return "UNKNOWN";
}

/** 記号の個数から v3 の通過率ランクを機械計算する（D＝必須要件未充足は別扱いなので除く） */
function expectedRank(nTri, nX) {
  if (nX >= 1) return "C";
  if (nTri >= 2) return "C";
  if (nTri === 1) return "B";
  return "A";
}

/** 項目名 → 集計用グループ（複数グループに属してよい） */
const GROUPS = [
  ["必須要件", /必須要件|学歴|資格|免許/],
  ["経験スキル", /経験・スキル|経験の質|経験年数|スキル|業種経験|業界|英語|管理部門|親和性|適合/],
  ["年齢", /年齢/],
  ["転職回数", /転職回数|在籍|離職/],
  ["年収", /年収/],
  ["歓迎要件", /歓迎/],
  ["選考難易度", /選考難易度/],
  ["選考実績", /選考実績|過去選考|選考結果|選考状況|選考プロセス|応募歴|応募状況|再応募|選考上/],
  ["固定残業", /固定残業|残業/],
  ["勤務地通勤", /勤務地|通勤/],
  ["勤務条件休日", /勤務条件|休日|働き方|雇用形態/],
  ["志向", /本人希望|志向|方向性/],
];
const GROUP_KEYS = GROUPS.map((g) => g[0]);
const MARK_ORDER = { "〇": 0, "▲": 1, "×": 2 };

/** 〇/▲ の「中身」を語彙で分類する（4-2 用） */
function nuance(comment) {
  if (!comment) return "";
  if (/ぎりぎり|ギリギリ|上限|上振れ|超過|オーバー|やや高|やや上|届かな|下回|逸脱|上回/.test(comment)) return "際どい";
  if (/余裕|十分|大きく|問題なし|文句なし|理想的|ど真ん中/.test(comment)) return "余裕";
  if (/レンジ内|範囲内|想定内|合致|該当|内に収ま|収まる|適合/.test(comment)) return "レンジ内";
  return "その他";
}
function difficulty(comment) {
  if (!comment) return "";
  if (/難易度が?高|ハードル|競合|倍率|厳し|狭き門|絞/.test(comment)) return "高";
  if (/難易度は?低|通過しやす|間口|広く|積極採用|急募|人手不足|複数名/.test(comment)) return "低";
  return "中";
}

// ===================================================================
// 本番コンテナ側モード
// ===================================================================
function md5(s) {
  return crypto.createHash("md5").update(s == null ? " NULL" : s).digest("hex");
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleTake(arr, n, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

async function remoteMain(cmd) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // ---- Phase 1: 母集団抽出 + 層化サンプリング ----
  if (cmd === "pop") {
    const bk = (
      await pool.query(
        `SELECT id, candidate_id, file_name, ai_analysis_comment, last_exported_at, created_at,
                updated_at, ai_analyzed_at
           FROM candidate_files
          WHERE category = 'BOOKMARK'
            AND created_at >= $1 AND created_at < $2
            AND last_exported_at IS NOT NULL
            AND extracted_text IS NOT NULL
            AND archived_at IS NULL`,
        [PERIOD_START, PERIOD_END]
      )
    ).rows;
    const candidateIds = [...new Set(bk.map((b) => b.candidate_id))];
    const entries = (
      await pool.query(
        `SELECT candidate_id, company_name, entry_date, document_pass_date,
                first_interview_date, second_interview_date, final_interview_date,
                offer_date, acceptance_date
           FROM job_entries WHERE candidate_id = ANY($1::text[])`,
        [candidateIds]
      )
    ).rows;
    const byCand = new Map();
    for (const e of entries) {
      e.__norm = norm(e.company_name);
      e.__stage = stageOf(e);
      if (!byCand.has(e.candidate_id)) byCand.set(e.candidate_id, []);
      byCand.get(e.candidate_id).push(e);
    }
    const pop = [];
    for (const b of bk) {
      const nf = norm(b.file_name);
      if (nf.length < 2) continue;
      let stage = -1;
      let settled = false;
      for (const e of byCand.get(b.candidate_id) || []) {
        if (e.__norm.length < 2) continue;
        if (!(nf.includes(e.__norm) || e.__norm.includes(nf))) continue;
        const d = e.entry_date ? new Date(e.entry_date) : null;
        if (!d || d >= ENTRY_CUTOFF) continue;
        settled = true;
        if (e.__stage > stage) stage = e.__stage;
      }
      if (!settled) continue;
      const c = b.ai_analysis_comment || "";
      pop.push({
        id: b.id,
        candidateId: b.candidate_id,
        fileName: b.file_name,
        createdAt: b.created_at,
        oldWish: c ? axWish(c) : null,
        oldPass: c ? axPass(c) : null,
        oldTotal: c ? axTotal(c) : null,
        stage,
        progressed: stage >= 1 ? 1 : 0,
      });
    }
    const stageDist = new Array(7).fill(0);
    for (const p of pop) stageDist[p.stage < 0 ? 0 : p.stage]++;
    const prog = pop.filter((p) => p.progressed === 1);
    const noProg = pop.filter((p) => p.progressed === 0);
    const rnd = mulberry32(20260828); // seed 固定＝再現可能
    const sampled = [...shuffleTake(prog, 100, rnd), ...shuffleTake(noProg, 100, rnd)];
    console.log("<<<POP_JSON>>>");
    console.log(
      JSON.stringify({
        meta: {
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          entryCutoff: ENTRY_CUTOFF.toISOString(),
          rawRows: bk.length,
          candidates: candidateIds.length,
          popN: pop.length,
          stageNames: STAGE_NAMES,
          stageDist,
          progN: prog.length,
          noProgN: noProg.length,
        },
        sampled,
      })
    );
    console.log("<<<END>>>");
    await pool.end();
    return;
  }

  const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));
  const ids = sample.map((s) => s.id);
  if (!fs.existsSync(OUT_DIR_REMOTE)) fs.mkdirSync(OUT_DIR_REMOTE, { recursive: true });

  const usageTotals = async () =>
    (
      await pool.query(
        `SELECT count(*)::int AS n, COALESCE(sum(cost_usd),0)::float8 AS usd,
                COALESCE(sum(input_tokens),0)::bigint AS inp, COALESCE(sum(output_tokens),0)::bigint AS outp,
                COALESCE(sum(cache_read_tokens),0)::bigint AS cr, COALESCE(sum(cache_creation_tokens),0)::bigint AS cw
           FROM advisor_usage_logs`
      )
    ).rows[0];
  const fileStates = async () => {
    const r = (
      await pool.query(
        `SELECT id, ai_analysis_comment, updated_at, ai_analyzed_at, ai_match_rating
           FROM candidate_files WHERE id = ANY($1::text[])`,
        [ids]
      )
    ).rows;
    const m = {};
    for (const x of r)
      m[x.id] = {
        h: md5(x.ai_analysis_comment),
        u: x.updated_at ? new Date(x.updated_at).toISOString() : null,
        a: x.ai_analyzed_at ? new Date(x.ai_analyzed_at).toISOString() : null,
        r: x.ai_match_rating,
      };
    return m;
  };

  if (cmd === "snapshot") {
    const snap = { at: new Date().toISOString(), usage: await usageTotals(), files: await fileStates() };
    fs.writeFileSync(SNAP_PATH, JSON.stringify(snap));
    console.log("<<<SNAP>>>" + JSON.stringify({ at: snap.at, usage: snap.usage, nFiles: ids.length }) + "<<<END>>>");
    await pool.end();
    return;
  }

  if (cmd === "verify") {
    const snap = JSON.parse(fs.readFileSync(SNAP_PATH, "utf8"));
    const now = await fileStates();
    const diffs = [];
    for (const id of ids) {
      const a = snap.files[id];
      const b = now[id];
      if (!a || !b) {
        diffs.push({ id, reason: "missing" });
        continue;
      }
      if (a.h !== b.h || a.u !== b.u || a.a !== b.a || a.r !== b.r) diffs.push({ id, before: a, after: b });
    }
    const u2 = await usageTotals();
    console.log(
      "<<<VERIFY>>>" +
        JSON.stringify({
          nChecked: ids.length,
          nDiff: diffs.length,
          diffs: diffs.slice(0, 10),
          usageBefore: snap.usage,
          usageAfter: u2,
          delta: {
            calls: u2.n - snap.usage.n,
            usd: u2.usd - snap.usage.usd,
            cacheRead: Number(u2.cr) - Number(snap.usage.cr),
            cacheWrite: Number(u2.cw) - Number(snap.usage.cw),
          },
        }) +
        "<<<END>>>"
    );
    await pool.end();
    return;
  }

  if (cmd === "status") {
    const done = ids.filter((id) => fs.existsSync(`${OUT_DIR_REMOTE}/${id}.txt`));
    console.log("<<<STATUS>>>" + JSON.stringify({ total: ids.length, done: done.length }) + "<<<END>>>");
    await pool.end();
    return;
  }

  if (cmd === "profile") {
    const cands = [...new Set(sample.map((s) => s.candidateId))];
    const ir = (
      await pool.query(
        `SELECT candidate_id, max(GREATEST(created_at, updated_at)) AS t
           FROM interview_records WHERE candidate_id = ANY($1::text[]) GROUP BY candidate_id`,
        [cands]
      )
    ).rows;
    // 主要書類は updated_at が本調査の parsedText 保存で動くため created_at のみ見る
    const cf = (
      await pool.query(
        `SELECT candidate_id, max(created_at) AS t
           FROM candidate_files
          WHERE candidate_id = ANY($1::text[]) AND category IN ('ORIGINAL','BS_DOCUMENT','MEETING')
          GROUP BY candidate_id`,
        [cands]
      )
    ).rows;
    const m = {};
    for (const r of ir) m[r.candidate_id] = { interview: r.t };
    for (const r of cf) m[r.candidate_id] = Object.assign(m[r.candidate_id] || {}, { doc: r.t });
    console.log("<<<PROFILE>>>" + JSON.stringify(m) + "<<<END>>>");
    await pool.end();
    return;
  }

  // ---- Phase 2: dryRun 試し判定 ----
  if (cmd === "run") {
    const limit = parseInt(process.argv[3] || "1", 10);
    const maxSec = parseInt(process.argv[4] || "420", 10);
    const conc = parseInt(process.argv[5] || "3", 10);
    const deadline = Date.now() + maxSec * 1000;
    const PORT = process.env.PORT || 8080;

    const u = (await pool.query(`SELECT id FROM users WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`)).rows[0];
    if (!u) throw new Error("no active user");

    // analyze-batch は candidateId 単位に createdAt desc で並べた一覧を batchIndex/batchSize で切る。
    // 同一条件・同一順序の一覧をここで再現し、対象1件だけを指す index を求める（batchSize=1）。
    const candIds = [...new Set(sample.map((s) => s.candidateId))];
    const rows = (
      await pool.query(
        `SELECT id, candidate_id, created_at FROM candidate_files
          WHERE candidate_id = ANY($1::text[]) AND category = 'BOOKMARK'
            AND extracted_text IS NOT NULL AND archived_at IS NULL
          ORDER BY created_at DESC`,
        [candIds]
      )
    ).rows;
    const listByCand = new Map();
    for (const r of rows) {
      if (!listByCand.has(r.candidate_id)) listByCand.set(r.candidate_id, []);
      listByCand.get(r.candidate_id).push(r);
    }
    // created_at が重複する行は順序が不定＝index 指定が当てにならないので検出して報告する
    const tieIds = new Set();
    for (const [, rs] of listByCand) {
      const seen = new Map();
      for (const r of rs) {
        const k = new Date(r.created_at).toISOString();
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      for (const r of rs) if (seen.get(new Date(r.created_at).toISOString()) > 1) tieIds.add(r.id);
    }

    const todo = sample
      .filter((s) => !fs.existsSync(`${OUT_DIR_REMOTE}/${s.id}.txt`))
      .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0))
      .slice(0, limit);
    // prompt cache（skill+候補者context）を効かせるため 1候補者は 1ワーカーが連続処理する
    const groups = [];
    const gi = new Map();
    for (const s of todo) {
      if (!gi.has(s.candidateId)) {
        gi.set(s.candidateId, groups.length);
        groups.push([]);
      }
      groups[gi.get(s.candidateId)].push(s);
    }

    let ok = 0;
    let fail = 0;
    let cursor = 0;
    const runOne = async (s) => {
      const rs = listByCand.get(s.candidateId) || [];
      const idx = rs.findIndex((r) => r.id === s.id);
      if (idx < 0) {
        fail++;
        fs.appendFileSync(ERR_PATH, JSON.stringify({ id: s.id, err: "not-in-list" }) + "\n");
        return;
      }
      try {
        const res = await fetch(
          `http://127.0.0.1:${PORT}/api/candidates/${s.candidateId}/bookmarks/analyze-batch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: `bs_session=${u.id}` },
            body: JSON.stringify({
              sessionId: `t182s3-${s.candidateId}`,
              batchIndex: idx,
              batchSize: 1,
              totalFiles: rs.length,
              isLastBatch: false,
              dryRun: true, // ★DBへ書き戻さない
            }),
          }
        );
        const txt = await res.text();
        if (!res.ok) {
          fail++;
          fs.appendFileSync(ERR_PATH, JSON.stringify({ id: s.id, status: res.status, body: txt.slice(0, 300) }) + "\n");
          return;
        }
        const data = JSON.parse(txt);
        fs.writeFileSync(`${OUT_DIR_REMOTE}/${s.id}.txt`, data.analysisText || "");
        fs.writeFileSync(
          `${OUT_DIR_REMOTE}/${s.id}.meta.json`,
          JSON.stringify({
            id: s.id,
            candidateId: s.candidateId,
            fileName: s.fileName,
            batchIndex: idx,
            totalFiles: rs.length,
            tie: tieIds.has(s.id),
            skippedFileIds: data.skippedFileIds || [],
          })
        );
        ok++;
      } catch (e) {
        fail++;
        fs.appendFileSync(ERR_PATH, JSON.stringify({ id: s.id, err: String(e && e.message) }) + "\n");
      }
    };
    const worker = async () => {
      for (;;) {
        if (Date.now() > deadline) return;
        const g = cursor++;
        if (g >= groups.length) return;
        for (const s of groups[g]) {
          if (Date.now() > deadline) return;
          await runOne(s);
        }
      }
    };
    await Promise.all(Array.from({ length: conc }, () => worker()));
    const doneNow = ids.filter((id) => fs.existsSync(`${OUT_DIR_REMOTE}/${id}.txt`)).length;
    console.log(
      "<<<RUN>>>" +
        JSON.stringify({
          attempted: todo.length,
          ok,
          fail,
          doneTotal: doneNow,
          remaining: ids.length - doneNow,
          tieCount: sample.filter((s) => tieIds.has(s.id)).length,
        }) +
        "<<<END>>>"
    );
    await pool.end();
    return;
  }

  throw new Error(`unknown mode: ${cmd}`);
}

// ===================================================================
// Phase 3（ローカル）: 生成テキスト → 特徴CSV
// ===================================================================
function localFeatures() {
  const sample = JSON.parse(fs.readFileSync(LOCAL_SAMPLE, "utf8"));
  const profile = fs.existsSync(LOCAL_PROFILE) ? JSON.parse(fs.readFileSync(LOCAL_PROFILE, "utf8")) : {};
  const rows = [];
  const missing = [];
  const itemNameCount = {};

  for (const s of sample) {
    const p = path.join(LOCAL_TXT_DIR, `${s.id}.txt`);
    if (!fs.existsSync(p)) {
      missing.push(s.id);
      continue;
    }
    const text = fs.readFileSync(p, "utf8");
    const a = parseAnalysis(text);
    for (const it of a.items) itemNameCount[it.name] = (itemNameCount[it.name] || 0) + 1;

    const cnt = { SEL: { t: 0, x: 0 }, WISH: { t: 0, x: 0 }, ALT_SEL: { t: 0, x: 0 }, ALT_WISH: { t: 0, x: 0 }, UNKNOWN: 0 };
    const groupMark = {};
    const groupComment = {};
    for (const it of a.items) {
      const k1 = classifyItem(it.name, true);
      const k2 = classifyItem(it.name, false);
      if (k1 === "SEL") {
        if (it.mark === "▲") cnt.SEL.t++;
        if (it.mark === "×") cnt.SEL.x++;
      } else if (k1 === "WISH") {
        if (it.mark === "▲") cnt.WISH.t++;
        if (it.mark === "×") cnt.WISH.x++;
      } else cnt.UNKNOWN++;
      if (k2 === "SEL") {
        if (it.mark === "▲") cnt.ALT_SEL.t++;
        if (it.mark === "×") cnt.ALT_SEL.x++;
      } else if (k2 === "WISH") {
        if (it.mark === "▲") cnt.ALT_WISH.t++;
        if (it.mark === "×") cnt.ALT_WISH.x++;
      }
      for (const [key, re] of GROUPS) {
        if (!re.test(it.name)) continue;
        if (groupMark[key] === undefined || MARK_ORDER[it.mark] > MARK_ORDER[groupMark[key]]) {
          groupMark[key] = it.mark;
          groupComment[key] = it.comment;
        }
      }
    }

    // 歓迎要件の充足記載（「歓迎要件 2/4」「歓迎条件のうち3つ該当」等）
    let welcome = "";
    const wm =
      text.match(/歓迎[^\n]{0,20}?(\d+)\s*[\/／]\s*(\d+)/) ||
      text.match(/(\d+)\s*[\/／]\s*(\d+)[^\n]{0,10}歓迎/);
    if (wm) welcome = `${wm[1]}/${wm[2]}`;

    // 【歓迎要件】項目が立つのは稀（実測3.5%）なので、選考分析セクション全文から
    // 「歓迎」への言及を拾って 該当 / 未該当 / 言及なし に落とす。
    const caIdx = text.indexOf("◆ 選考分析");
    const caText = caIdx >= 0 ? text.slice(caIdx) : text;
    let welcomeState = "言及なし";
    const wsent = caText.split(/[。\n]/).filter((s) => s.includes("歓迎"));
    if (wsent.length > 0) {
      const joined = wsent.join(" ");
      const neg = /(歓迎[^。]{0,20}?(未該当|該当なし|該当せず|満たさな|不足|外れ|ない))|((未経験|経験なし)[^。]{0,10}歓迎)/.test(joined);
      const pos = /歓迎[^。]{0,25}?(該当|合致|満た|クリア|あり|保有|カバー)|(該当|合致)[^。]{0,10}歓迎/.test(joined);
      welcomeState = neg && !pos ? "未該当" : pos ? "該当" : "言及のみ";
    }

    const prof = profile[s.candidateId] || {};
    const created = new Date(s.createdAt);
    const later = (v) => (v ? new Date(v) > created : false);

    rows.push({
      candidateFileId: s.id,
      candidateId: s.candidateId,
      old_pass: s.oldPass || "",
      old_wish: s.oldWish || "",
      old_total: s.oldTotal || "",
      new_pass: a.pass || "",
      new_wish: a.wish || "",
      new_total: a.total || "",
      n_items: a.items.length,
      n_tri_sel: cnt.SEL.t,
      n_x_sel: cnt.SEL.x,
      n_tri_wish: cnt.WISH.t,
      n_x_wish: cnt.WISH.x,
      n_tri_sel_alt: cnt.ALT_SEL.t,
      n_x_sel_alt: cnt.ALT_SEL.x,
      n_unknown_item: cnt.UNKNOWN,
      exp_rank: expectedRank(cnt.SEL.t, cnt.SEL.x),
      exp_rank_alt: expectedRank(cnt.ALT_SEL.t, cnt.ALT_SEL.x),
      ...Object.fromEntries(GROUP_KEYS.map((k) => [`m_${k}`, groupMark[k] || ""])),
      nu_年齢: nuance(groupComment["年齢"]),
      nu_経験スキル: nuance(groupComment["経験スキル"]),
      nu_転職回数: nuance(groupComment["転職回数"]),
      nu_年収: nuance(groupComment["年収"]),
      d_選考難易度: difficulty(groupComment["選考難易度"]),
      welcome_ratio: welcome,
      welcome_state: welcomeState,
      stage_max: STAGE_NAMES[s.stage < 0 ? 0 : s.stage],
      stage_num: s.stage < 0 ? 0 : s.stage,
      progressed: s.progressed,
      profile_updated_after: later(prof.interview) || later(prof.doc) ? 1 : 0,
    });
  }

  const cols = Object.keys(rows[0]);
  const csv = [cols.join(",")]
    .concat(rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(",")))
    .join("\n");
  fs.writeFileSync(LOCAL_CSV, csv, "utf8");
  fs.writeFileSync(LOCAL_CSV.replace(/\.csv$/, ".json"), JSON.stringify(rows), "utf8");
  console.log(
    JSON.stringify({
      rows: rows.length,
      missing: missing.length,
      distinctItemNames: Object.keys(itemNameCount).length,
      fillRate: Object.fromEntries(
        cols.map((c) => [c, +(rows.filter((r) => String(r[c] ?? "") !== "").length / rows.length).toFixed(3)])
      ),
    })
  );
}

// ===================================================================
// Phase 4（ローカル）: 集計
// ===================================================================
function pct(a, b) {
  return b === 0 ? "-" : `${((a / b) * 100).toFixed(1)}%`;
}
function rateCell(n, prog) {
  return n < 10 ? `n<10 (${prog}/${n})` : `${pct(prog, n)} (${prog}/${n})`;
}

function localAggregate() {
  const rows = JSON.parse(fs.readFileSync(LOCAL_CSV.replace(/\.csv$/, ".json"), "utf8"));
  const out = [];
  const W = (s) => out.push(s);

  W("# T-182 step3 結果: 新定義(v3)の試し判定200件と通過率Aの絞り込み線");
  W("");
  W(`- 実施日: 2026-08-28（JST）`);
  W(`- 判定: 本番プロンプト v3（72eade8）を analyze-batch の **dryRun=true** で実行（DB書き戻しなし）`);
  W(`- 母集団: BOOKMARK / createdAt JST 2026-05-14〜2026-07-17 / 送信済み / 応募到達 / entry_date JST 2026-07-17 以前 / extractedText 非null / archivedAt null`);
  W(`- サンプル: 進行あり100件 + 進行なし100件（層化・seed 固定）`);
  W("");
  W("## Phase 1-2 実行記録");
  W("");
  W("| 項目 | 値 |");
  W("|--|--|");
  W("| 母集団（確定分・応募到達） | 514件 / 求職者164名中 |");
  W("| 最深ステージ内訳 | エントリーのみ386 / 書類通過23 / 一次68 / 二次6 / 最終7 / 内定9 / 承諾15 |");
  W("| 進行あり（書類通過以降） | 128件 |");
  W("| dryRun 成功 | 200 / 200（HTTPエラー0・skippedFileIds 0） |");
  W("| createdAt 重複による index 不定 | 0件 |");
  W("| **書き戻し確認** | 対象200件の aiAnalysisComment ハッシュ / updatedAt / aiAnalyzedAt / aiMatchRating すべて実行前と一致（差分 **0件**）。裏取りとして実行後の `max(updated_at)`=2026-08-20T07:00Z / `max(ai_analyzed_at)`=2026-08-14T07:57Z＝実行日(8/28)より前 |");
  W("| 実費用 | analyze-batch 204コール $18.267（≒ ¥2,740 @¥150/$）。cache_read 6,021,332 tok / cache_write 741,825 tok |");
  W("");

  // ---- 4-1 ----
  W("## 4-1 新定義でのランク分布");
  W("");
  W("> 進行あり100／なし100 の層化サンプルなので、この「うち進行あり」は母集団の進行率ではない。");
  W("> 予測力は「ランク別の進行あり比率が 50% からどれだけ動くか」で読む（50%＝予測力なし）。");
  W("");
  W("| new_pass | 件数 | うち進行あり | 進行あり比率 |");
  W("|--|--|--|--|");
  for (const r of ["A", "B", "C", "D"]) {
    const s = rows.filter((x) => x.new_pass === r);
    const p = s.filter((x) => x.progressed === 1).length;
    W(`| ${r} | ${s.length} | ${p} | ${s.length < 10 ? "n<10" : pct(p, s.length)} |`);
  }
  const unranked = rows.filter((x) => !["A", "B", "C", "D"].includes(x.new_pass));
  W(`| （抽出不能） | ${unranked.length} | ${unranked.filter((x) => x.progressed === 1).length} | - |`);
  W(`| 合計 | ${rows.length} | ${rows.filter((x) => x.progressed === 1).length} | - |`);
  W("");

  W("### 参考: 新定義の総合 / 本人希望の分布");
  W("");
  W("| 軸 | A | B+ | B | C | D |");
  W("|--|--|--|--|--|--|");
  for (const [label, key, ranks] of [
    ["総合", "new_total", ["A", "B+", "B", "C", "D"]],
    ["本人希望", "new_wish", ["A", "", "B", "C", "D"]],
  ]) {
    W(`| ${label} | ` + ranks.map((r) => (r === "" ? "-" : rows.filter((x) => x[key] === r).length)).join(" | ") + " |");
  }
  W("");

  // ---- 記号分類の妥当性 ----
  const agree = (k) => rows.filter((x) => x.new_pass !== "D" && x.new_pass && x[k] === x.new_pass).length;
  const denom = rows.filter((x) => x.new_pass && x.new_pass !== "D").length;
  W("### 記号個数と宣言ランクの整合（「年収」項目の扱いの検証）");
  W("");
  W("| 年収項目の扱い | 記号から機械計算したランクが宣言ランクと一致 |");
  W("|--|--|");
  W(`| 選考観点として数える（採用） | ${pct(agree("exp_rank"), denom)} (${agree("exp_rank")}/${denom}) |`);
  W(`| 本人希望観点として数えない | ${pct(agree("exp_rank_alt"), denom)} (${agree("exp_rank_alt")}/${denom}) |`);
  W("");

  // ---- 4-2 ----
  const A = rows.filter((x) => x.new_pass === "A");
  const Ap = A.filter((x) => x.progressed === 1);
  const An = A.filter((x) => x.progressed === 0);
  W("## 4-2 【本命】新定義A（懸念ゼロ）の中で進行あり／なしを分ける特徴");
  W("");
  W(`新定義A: **${A.length}件**（進行あり ${Ap.length} / 進行なし ${An.length}）`);
  W("");

  const findings = [];
  const compare = (title, keyFn, values) => {
    W(`### ${title}`);
    W("");
    W("| 値 | 進行あり | 進行なし | A内件数 | 進行あり比率 |");
    W("|--|--|--|--|--|");
    for (const v of values) {
      const a = Ap.filter((x) => keyFn(x) === v).length;
      const b = An.filter((x) => keyFn(x) === v).length;
      const n = a + b;
      if (n === 0) continue;
      W(`| ${v || "(空)"} | ${a} | ${b} | ${n} | ${n < 10 ? "n<10" : pct(a, n)} |`);
      if (n >= 10) {
        const diff = (a / n) * 100 - (Ap.length / A.length) * 100;
        if (Math.abs(diff) >= 10) findings.push({ title, value: v || "(空)", n, rate: (a / n) * 100, diff });
      }
    }
    W("");
  };
  const uniq = (fn) => [...new Set(A.map(fn))].sort();

  compare("歓迎要件の記号（【歓迎要件】項目が立った場合のみ）", (x) => x.m_歓迎要件, uniq((x) => x.m_歓迎要件));
  compare("歓迎要件への言及（選考分析全文から）", (x) => x.welcome_state, uniq((x) => x.welcome_state));
  compare("年齢の〇の中身", (x) => x.nu_年齢, uniq((x) => x.nu_年齢));
  compare("経験・スキルの〇の中身", (x) => x.nu_経験スキル, uniq((x) => x.nu_経験スキル));
  compare("転職回数の〇の中身", (x) => x.nu_転職回数, uniq((x) => x.nu_転職回数));
  compare("年収レンジの〇の中身", (x) => x.nu_年収, uniq((x) => x.nu_年収));
  compare("選考難易度の記述", (x) => x.d_選考難易度, uniq((x) => x.d_選考難易度));
  compare("選考実績（過去の応募実績）項目の記号", (x) => x.m_選考実績, uniq((x) => x.m_選考実績));
  compare("旧定義の通過率ランク", (x) => x.old_pass, uniq((x) => x.old_pass));
  compare("旧定義の総合ランク", (x) => x.old_total, uniq((x) => x.old_total));
  compare("新定義の本人希望ランク", (x) => x.new_wish, uniq((x) => x.new_wish));
  compare("本人希望観点の▲個数", (x) => String(x.n_tri_wish), uniq((x) => String(x.n_tri_wish)));
  compare("選考分析の項目数", (x) => (x.n_items <= 5 ? "5以下" : x.n_items === 6 ? "6" : "7以上"), ["5以下", "6", "7以上"]);
  compare("面談ログ/書類がブックマーク後に更新", (x) => String(x.profile_updated_after), ["0", "1"]);

  W("### 10ポイント以上の差が出た特徴（A全体の進行あり比率との差）");
  W("");
  if (findings.length === 0) {
    W("**なし**");
  } else {
    W(`A全体の進行あり比率: ${pct(Ap.length, A.length)}`);
    W("");
    W("| 特徴 | 値 | n | 進行あり比率 | A全体との差 |");
    W("|--|--|--|--|--|");
    for (const f of findings.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)))
      W(`| ${f.title} | ${f.value} | ${f.n} | ${f.rate.toFixed(1)}% | ${f.diff >= 0 ? "+" : ""}${f.diff.toFixed(1)}pt |`);
  }
  W("");

  // ---- 4-3 ----
  W("## 4-3 選考観点の▲個数ごとの進行率");
  W("");
  W("| 選考観点▲個数 | 件数 | 進行あり | 進行あり比率 |");
  W("|--|--|--|--|");
  const bucket = (n) => (n >= 3 ? "3以上" : String(n));
  for (const b of ["0", "1", "2", "3以上"]) {
    const s = rows.filter((x) => x.n_x_sel === 0 && bucket(x.n_tri_sel) === b);
    const p = s.filter((x) => x.progressed === 1).length;
    W(`| ${b} | ${s.length} | ${p} | ${s.length < 10 ? "n<10" : pct(p, s.length)} |`);
  }
  const withX = rows.filter((x) => x.n_x_sel >= 1);
  W(`| （×が1個以上） | ${withX.length} | ${withX.filter((x) => x.progressed === 1).length} | ${withX.length < 10 ? "n<10" : pct(withX.filter((x) => x.progressed === 1).length, withX.length)} |`);
  W("");

  // ---- 4-4 ----
  W("## 4-4 旧定義×新定義のクロス");
  W("");
  W("| 旧＼新 | A | B | C | D | 計 |");
  W("|--|--|--|--|--|--|");
  for (const o of ["A", "B", "C", "D"]) {
    const cells = ["A", "B", "C", "D"].map((n) => {
      const s = rows.filter((x) => x.old_pass === o && x.new_pass === n);
      const p = s.filter((x) => x.progressed === 1).length;
      return s.length === 0 ? "-" : `${s.length}件 / ${s.length < 10 ? "n<10" : pct(p, s.length)}`;
    });
    const tot = rows.filter((x) => x.old_pass === o);
    W(`| ${o} | ${cells.join(" | ")} | ${tot.length} |`);
  }
  W("");
  W("（セルは「件数 / 進行あり比率」）");
  W("");
  const oldA_newB = rows.filter((x) => x.old_pass === "A" && x.new_pass !== "A" && x.new_pass);
  const oldB_newA = rows.filter((x) => x.old_pass === "B" && x.new_pass === "A");
  const stay = rows.filter((x) => x.old_pass === x.new_pass && x.new_pass);
  W("| 移動 | 件数 | 進行あり比率 |");
  W("|--|--|--|");
  for (const [label, s] of [
    ["旧A → 新A以外（格下げ）", oldA_newB],
    ["旧B → 新A（格上げ）", oldB_newA],
    ["据え置き（旧=新）", stay],
  ]) {
    const p = s.filter((x) => x.progressed === 1).length;
    W(`| ${label} | ${s.length} | ${s.length < 10 ? "n<10" : pct(p, s.length)} |`);
  }
  W("");

  // ---- 4-5 Aの絞り込み案 ----
  W("## 4-5 新定義Aの絞り込み案（4-2 の特徴を条件にした場合）");
  W("");
  W("Aに残す条件を足したとき、残ったAと落ちた分の進行率がどれだけ割れるかを見る。");
  W("");
  W("| 絞り込み案 | A残 件数 | A残の進行率 | 落ちる件数 | 落ちた分の進行率 |");
  W("|--|--|--|--|--|");
  const rules = [
    ["① 本人希望A のみA", (x) => x.new_wish === "A"],
    ["② 歓迎要件が未該当でない", (x) => x.welcome_state !== "未該当"],
    ["③ ①かつ②", (x) => x.new_wish === "A" && x.welcome_state !== "未該当"],
    ["④ ②かつ 選考難易度「高」でない", (x) => x.welcome_state !== "未該当" && x.d_選考難易度 !== "高"],
  ];
  for (const [label, fn] of rules) {
    const keep = A.filter(fn);
    const drop = A.filter((x) => !fn(x));
    const kp = keep.filter((x) => x.progressed === 1).length;
    const dp = drop.filter((x) => x.progressed === 1).length;
    W(
      `| ${label} | ${keep.length} | ${keep.length < 10 ? "n<10" : pct(kp, keep.length)} | ${drop.length} | ${drop.length < 10 ? "n<10" : pct(dp, drop.length)} |`
    );
  }
  W("");

  W("## 付録: profile_updated_after");
  W("");
  const pu = rows.filter((x) => x.profile_updated_after === 1);
  W(`ブックマーク作成後に面談ログまたは主要書類が追加/更新された求職者の求人: **${pu.length}件 / ${rows.length}件**（判定材料が当時と違う可能性）`);
  W("");

  // ---- 所見 ----
  const bA = rows.filter((x) => x.new_pass === "A");
  const bB = rows.filter((x) => x.new_pass === "B");
  const bC = rows.filter((x) => x.new_pass === "C");
  const rate = (s) => pct(s.filter((x) => x.progressed === 1).length, s.length);
  W("## 所見");
  W("");
  W(`1. **A と B は実績で分かれていない**（A ${rate(bA)} / B ${rate(bB)}）。段差は B と C の間にある（C ${rate(bC)}）。`);
  W(`   「Aが広すぎる」のは分布の問題であって、Aの中に低進行の求人が集まっているわけではない。`);
  W(`2. 4-3 のとおり **▲0個と▲1個の間には段差がない**。段差は「▲3個以上」と「×が1個以上」で出る。`);
  W(`   現行の A=▲0 / B=▲1 / C=▲2以上 という閾値のうち、実績で裏づけがあるのは C 側だけで、`);
  W(`   しかも C の入口は「▲2個」ではなく「▲3個 または ×1個」に見える。`);
  W(`3. Aの中を割る単独因子として最も強いのは **本人希望ランク**（A 74.2% / B 45.5%）と`);
  W(`   **歓迎要件の未該当**（30.0%・n=10）。両方を条件にすると 4-5 ③ のとおり 79.3% / 41.9% に割れる。`);
  W(`4. 旧A→新A以外（格下げ）23件の進行率は 73.9% で、据え置き 54.3% より高い。`);
  W(`   v3 の格下げは実績のよい求人を落としている側面がある（4-4）。`);
  W("");

  fs.writeFileSync(LOCAL_MD, out.join("\n"), "utf8");
  console.log(out.join("\n"));
}

// ===================================================================
const cmd = process.argv[2] || "status";
if (cmd === "features") localFeatures();
else if (cmd === "aggregate") localAggregate();
else remoteMain(cmd).catch((e) => { console.error("FATAL", e); process.exit(1); });
