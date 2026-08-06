// T-158: 求人サイトURL発行モーダルの案内文「まとめた求人の説明」自動下書き。
//
// 構成（4行を改行連結して返す）:
//   職種：AI生成（gemini-2.5-flash・thinkingBudget=0・temperature=0・8秒タイムアウト）
//   業種：常に空欄（kyuujinPDF に業種カラムが無いため CA 手書き欄として残す）
//   エリア：機械計算（希望都道府県 × プロジェクト target_areas の集合比較）
//   年収：機械計算（希望下限 × 求人 salary の数値抽出）
//
// データソース:
//   希望条件 … 最新 InterviewRecord → InterviewDetail が主ソース。Candidate.desired* は
//              CA 手編集の上書き層として、値があればそちらを優先する。
//              ※ InterviewRecord.isLatest は不整合実績があるためフラグは使わず
//                interviewDate DESC, createdAt DESC で取る。
//   求人     … kyuujinPDF GET /api/projects/by-job-seeker-id/{num}/jobs（既存 jobs API と同経路）。
//              feedback_status=EXCLUDED と portal 側 HiddenJobIntroduction は集計から除外。
//   探索範囲 … kyuujinPDF GET /api/projects/{project_id} の target_areas。
//              「求人の所在地」ではなく「CA が求人送信時に選んだ検索対象エリア」である点に注意。
//
// 生成文は求職者本人が読む。事実の捏造・誇張を出さないことを最優先とし、
// 希望と探索範囲が食い違うケースでは「広げました」系の表現を使わない。

import { prisma } from "@/lib/prisma";
import { recordGeminiUsage } from "@/lib/ai-usage";

// ---------------------------------------------------------------------------
// 実質空値フィルタ（共通ユーティリティ）
// ---------------------------------------------------------------------------

// 単体トークンとして「値が無い」とみなす語。
// 「指定なし / 指定なし / 指定なし」は職種マスタに「指定なし」大分類が正規に存在するため
// DB 上は正常値として保存されている（本番136件）。NULL 判定だけでは拾えない。
const JUNK_TOKENS = new Set([
  "指定なし",
  "こだわらない",
  "その他",
  "記載なし",
  "未定",
  "特になし",
  "特に無し",
  "なし",
  "無し",
]);

/**
 * 「値が実質的に入っていない」判定。職種・エリア・年収すべてこの1関数で判定する。
 * - null / undefined / 空文字 / 空白のみ
 * - 数値 0
 * - 区切り記号（/ 、 , 改行）で分割した全トークンが JUNK_TOKENS に該当
 *   （例: "指定なし / 指定なし / 指定なし"、"/ /"）
 */
export function isEffectivelyEmpty(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return value <= 0;
  const s = value.trim();
  if (s === "") return true;
  const tokens = s
    .split(/[/\n、,]/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
  if (tokens.length === 0) return true; // "/ /" のような区切り記号だけの値
  return tokens.every((t) => JUNK_TOKENS.has(t));
}

/** 文字列を分割して実質空値トークンを除いたリストにする（job_category の「、」連結ほぐし用） */
function splitMeaningful(value: string | null | undefined, sep: RegExp): string[] {
  if (!value) return [];
  return value
    .split(sep)
    .map((t) => t.trim())
    .filter((t) => t !== "" && !isEffectivelyEmpty(t));
}

// ---------------------------------------------------------------------------
// 最新面談の希望条件
// ---------------------------------------------------------------------------

export interface LatestInterviewDesired {
  interviewDate: Date | null;
  desiredJobType1: string | null;
  desiredJobType2: string | null;
  desiredPrefecture: string | null;
  desiredSalaryMin: number | null;
  desiredSalaryMax: number | null;
}

/**
 * 最新面談（interviewDate DESC, createdAt DESC）の希望条件を返す。
 * isLatest フラグは不整合実績があるため使わない。面談が無ければ null。
 */
export async function getLatestInterviewDesired(
  candidateId: string
): Promise<LatestInterviewDesired | null> {
  const record = await prisma.interviewRecord.findFirst({
    where: { candidateId },
    orderBy: [{ interviewDate: "desc" }, { createdAt: "desc" }],
    select: {
      interviewDate: true,
      detail: {
        select: {
          desiredJobType1: true,
          desiredJobType2: true,
          desiredPrefecture: true,
          desiredSalaryMin: true,
          desiredSalaryMax: true,
        },
      },
    },
  });
  if (!record) return null;
  return {
    interviewDate: record.interviewDate,
    desiredJobType1: record.detail?.desiredJobType1 ?? null,
    desiredJobType2: record.detail?.desiredJobType2 ?? null,
    desiredPrefecture: record.detail?.desiredPrefecture ?? null,
    desiredSalaryMin: record.detail?.desiredSalaryMin ?? null,
    desiredSalaryMax: record.detail?.desiredSalaryMax ?? null,
  };
}

/** JST で「今日」かどうか。罠#17: toISOString は UTC 日付になるため使わない。 */
export function isTodayJst(date: Date | null): boolean {
  if (!date) return false;
  const jst = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  return jst(date) === jst(new Date());
}

// ---------------------------------------------------------------------------
// 年収: salary テキストから万円レンジを抽出
// ---------------------------------------------------------------------------

/**
 * "350万円〜560万円" / "1,000万円" / "400万円〜" から下限・上限（万円）を抽出。
 * 数値が1つなら min のみ（上限不明）。抽出不能なら null。
 */
export function parseSalaryRange(
  salary: string | null | undefined
): { min: number; max: number | null } | null {
  if (!salary) return null;
  const nums = [...salary.matchAll(/([\d,]+)\s*万\s*円?/g)]
    .map((m) => parseInt(m[1].replace(/,/g, ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = nums.length >= 2 ? Math.max(...nums) : null;
  return { min, max };
}

function buildSalaryLine(
  desiredMin: number | null,
  jobs: KyuujinJob[]
): string {
  const ranges = jobs
    .map((j) => parseSalaryRange(j.salary))
    .filter((r): r is { min: number; max: number | null } => r !== null);
  if (ranges.length === 0) return "年収：";

  const overallMin = Math.min(...ranges.map((r) => r.min));
  const overallMax = Math.max(...ranges.map((r) => r.max ?? r.min));

  if (desiredMin !== null && desiredMin > 0) {
    const belowCount = ranges.filter((r) => r.min < desiredMin).length;
    if (belowCount > 0) {
      return `年収：下限年収を${desiredMin}万円で区切っておりますが、数に限りがあります為、若干下限を下回る求人も一部含めております。`;
    }
    return `年収：ご希望の${desiredMin}万円以上を満たす求人でまとめています（${overallMin}万円〜${overallMax}万円）。`;
  }
  return `年収：${overallMin}万円〜${overallMax}万円の求人をまとめています。`;
}

// ---------------------------------------------------------------------------
// エリア: 希望都道府県 × target_areas の集合比較
// ---------------------------------------------------------------------------

// target_areas には都道府県名とエリアグループ名が混在する（["東京都"] / ["首都圏"] 両方が実在）。
// 比較のためグループ名は都道府県集合に展開する。
const AREA_GROUP_PREFECTURES: Record<string, string[]> = {
  首都圏: ["東京都", "神奈川県", "埼玉県", "千葉県"],
  北関東: ["茨城県", "栃木県", "群馬県"],
  関西: ["大阪府", "兵庫県", "京都府", "滋賀県", "奈良県", "和歌山県"],
  東海: ["愛知県", "岐阜県", "三重県", "静岡県"],
  九州: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"],
  東北: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"],
  中国: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"],
  四国: ["徳島県", "香川県", "愛媛県", "高知県"],
  北海道: ["北海道"],
  甲信越: ["山梨県", "長野県", "新潟県"],
  北陸: ["富山県", "石川県", "福井県"],
};

function expandToPrefectures(labels: string[]): Set<string> {
  const set = new Set<string>();
  for (const label of labels) {
    const group = AREA_GROUP_PREFECTURES[label];
    if (group) group.forEach((p) => set.add(p));
    else set.add(label);
  }
  return set;
}

function buildAreaLine(desiredPrefectures: string[], targetAreas: string[]): string {
  if (targetAreas.length === 0) return "エリア：";

  const searched = targetAreas.join("・");
  if (desiredPrefectures.length === 0) {
    return `エリア：${searched}を中心にまとめています。`;
  }

  const searchedSet = expandToPrefectures(targetAreas);
  const desiredSet = new Set(desiredPrefectures);
  const coversAll = [...desiredSet].every((p) => searchedSet.has(p));
  const desired = desiredPrefectures.join("・");

  if (coversAll && searchedSet.size > desiredSet.size) {
    return `エリア：ご希望の${desired}のみですと数が限られてしまった為、${searched}も含めてまとめさせていただきました。`;
  }
  if (coversAll) {
    // 探索範囲＝希望どおり
    return `エリア：ご希望の${desired}を中心にまとめています。`;
  }
  // 希望と探索範囲が食い違う／部分的にしか重ならないケース。
  // 「広げました」と書くと事実と食い違う文面になる（実例: 希望=大阪府 / target_areas=首都圏）ため、
  // 希望には触れず探索範囲だけを述べる。
  return `エリア：${searched}を中心にまとめています。`;
}

// ---------------------------------------------------------------------------
// 職種: ラベル一覧 + 希望職種 → Gemini で1行生成
// ---------------------------------------------------------------------------

const DRAFT_GEMINI_MODEL = "gemini-2.5-flash";
const DRAFT_GEMINI_TIMEOUT_MS = 8000;

// 生成結果がこの長さを超えたら1回だけ短縮再生成する（再生成後も超えたらそのまま採用）
const JOB_TYPE_LINE_RETRY_THRESHOLD = 100;

/**
 * gemini-2.5-flash を直接呼ぶ薄いラッパ。
 * 共通クライアント（src/lib/ai/gemini-client.ts）はモデル固定・thinking設定不可・タイムアウト無しのため
 * 本用途（費用管理: thinkingBudget=0 / temperature=0 / 8秒タイムアウト）には使わず、ここで完結させる。
 * usage は規約どおり AiUsageLog に記録する（fire-and-forget）。
 *
 * 長さガード: 100字超なら「より短く」を追記して1回だけ再生成。再生成でも超えたら
 * そのまま採用する（長い文でも空欄よりは有用）。再生成は最大1回・無限リトライ禁止。
 */
async function generateJobTypeLine(
  categoryLabels: string[],
  desiredJobTypes: string[],
  candidateId: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "職種：";
  if (categoryLabels.length === 0) return "職種：";

  const first = await callJobTypeGemini(apiKey, categoryLabels, desiredJobTypes, candidateId, false);
  if (first === null) return "職種：";
  if (first.length <= JOB_TYPE_LINE_RETRY_THRESHOLD) return first;

  // 長すぎた → 短縮指示を足して1回だけ再生成
  const retry = await callJobTypeGemini(apiKey, categoryLabels, desiredJobTypes, candidateId, true);
  if (retry === null) return first; // 再生成が失敗しても初回結果は有効なので捨てない
  // 再生成でも閾値超過ならそのまま採用（空欄にはしない）
  return retry.length <= JOB_TYPE_LINE_RETRY_THRESHOLD || retry.length < first.length ? retry : first;
}

/** 1回分の Gemini 呼び出し。数値混入などの不採用時は null（呼び出し側でフォールバック判断）。 */
async function callJobTypeGemini(
  apiKey: string,
  categoryLabels: string[],
  desiredJobTypes: string[],
  candidateId: string,
  isRetry: boolean
): Promise<string | null> {
  const systemInstruction = [
    "あなたは転職エージェントのキャリアアドバイザーです。",
    "求職者に送る案内文の中の「まとめた求人の職種の説明」を1行だけ書きます。",
    "厳守事項:",
    "- 出力は日本語1行のみ。前置き・記号・箇条書き・引用符・改行を付けない。",
    "- 「職種：」で書き始める。",
    "- 出力は80字以内（「職種：」を含む）。",
    "- 職種は多くても3〜4種類の括りにまとめる。渡されたラベルを網羅的に列挙しない。",
    "- 細かいラベルは上位の括りに寄せてよい（例: 「一般事務」「営業事務」「専門事務」→「事務職」）。ただし渡されたラベルに存在しない職種を新たに作り出さない。",
    "- 該当が少数の職種は無理に含めず、中心となるものを優先する。",
    "- 「〜など幅広い職種」のような締め方は、実際に括りが4種類を超える場合にのみ使う。",
    "- 件数・パーセンテージ・数値を一切書かない。",
    "- 求職者本人が読む文章として、中立・丁寧な表現にする。",
    "",
    "出力例1（営業系ラベルが中心＋事務系・サポート系が少数の場合）:",
    "職種：営業職を中心に、事務職やカスタマーサポートなどの求人をまとめています",
    "出力例2（事務系ラベルが大半の場合）:",
    "職種：一般事務や営業事務を中心とした事務職の求人をまとめています",
    ...(isRetry
      ? ["", "前回の出力が長すぎました。今回はより短く、職種の括りを3種類以内にまとめること。"]
      : []),
  ].join("\n");

  const userPrompt = [
    desiredJobTypes.length > 0
      ? `求職者の希望職種: ${desiredJobTypes.join(" / ")}`
      : "求職者の希望職種: （未登録）",
    "",
    "まとめた求人の職種ラベル一覧:",
    categoryLabels.join("、"),
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAFT_GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${DRAFT_GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 256,
            responseMimeType: "text/plain",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!res.ok) {
      console.error(`[site-guide-draft] Gemini error status=${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };

    // 新規 Gemini 呼び出しは必ず費用帳簿へ記録する（T-135 規約・fire-and-forget）
    void recordGeminiUsage({
      system: "portal",
      endpoint: "site-guide-draft",
      model: DRAFT_GEMINI_MODEL,
      usage: data.usageMetadata,
      meta: { candidateId, labelCount: categoryLabels.length, ...(isRetry && { retry: true }) },
    });

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return sanitizeJobTypeLine(raw);
  } catch (e) {
    console.error("[site-guide-draft] Gemini call failed:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Gemini 出力の防御的整形。壊れていたら null（不採用）。長さの調整は呼び出し側の再生成で行う。 */
function sanitizeJobTypeLine(raw: string): string | null {
  let line = raw.trim().split("\n")[0].trim();
  line = line.replace(/^["'「『]|["'」』]$/g, "").trim();
  if (line === "") return null;
  if (!line.startsWith("職種：")) {
    line = line.startsWith("職種:") ? "職種：" + line.slice(3).trim() : `職種：${line}`;
  }
  // 件数・割合が紛れ込んだら不採用（求職者向け文面に数字を出さない仕様）
  if (/\d+\s*件|\d+\s*[%％]/.test(line)) return null;
  return line;
}

// ---------------------------------------------------------------------------
// kyuujinPDF 取得
// ---------------------------------------------------------------------------

interface KyuujinJob {
  id: number;
  job_category: string | null;
  salary: string | null;
  feedback_status: string | null;
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

export interface SiteGuideDraftResult {
  draft: string | null;
  generated: boolean;
  reason?: string;
  /** 最新面談日が JST 当日か（案内文の「本日／先日」出し分け用）。面談が無い場合 false */
  isInterviewToday: boolean;
}

export async function buildSiteGuideDraft(candidateId: string): Promise<SiteGuideDraftResult> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      candidateNumber: true,
      desiredJobType1: true,
      desiredJobType2: true,
      desiredPrefecture1: true,
      desiredPrefecture2: true,
      desiredSalaryMin: true,
    },
  });
  if (!candidate) {
    return { draft: null, generated: false, reason: "candidate_not_found", isInterviewToday: false };
  }

  const latest = await getLatestInterviewDesired(candidateId);
  const isInterviewToday = isTodayJst(latest?.interviewDate ?? null);

  if (!candidate.candidateNumber) {
    return { draft: null, generated: false, reason: "no_candidate_number", isInterviewToday };
  }

  const baseUrl = process.env.KYUUJIN_PDF_TOOL_URL;
  if (!baseUrl) {
    return { draft: null, generated: false, reason: "kyuujin_url_not_configured", isInterviewToday };
  }

  // 求人一覧（既存 /api/candidates/[candidateId]/jobs と同じ経路）
  let projectId: number | null = null;
  let jobs: KyuujinJob[] = [];
  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/api/projects/by-job-seeker-id/${candidate.candidateNumber}/jobs`
    );
    if (res.status === 404) {
      return { draft: null, generated: false, reason: "no_jobs", isInterviewToday };
    }
    if (!res.ok) {
      return { draft: null, generated: false, reason: "kyuujin_error", isInterviewToday };
    }
    const data = (await res.json()) as { project_id?: number | null; jobs?: KyuujinJob[] };
    projectId = data.project_id ?? null;
    jobs = data.jobs ?? [];
  } catch (e) {
    console.error("[site-guide-draft] jobs fetch failed:", e);
    return { draft: null, generated: false, reason: "kyuujin_error", isInterviewToday };
  }

  // 集計対象の絞り込み: EXCLUDED は除外。CA が非表示にした求人（HiddenJobIntroduction）も
  // 画面の求人一覧と同じく集計に入れない。
  const hidden = await prisma.hiddenJobIntroduction.findMany({
    where: { candidateId },
    select: { externalJobId: true },
  });
  const hiddenIds = new Set(hidden.map((h) => h.externalJobId));
  const targetJobs = jobs.filter(
    (j) => j.feedback_status !== "EXCLUDED" && !hiddenIds.has(j.id)
  );
  if (targetJobs.length === 0) {
    return { draft: null, generated: false, reason: "no_jobs", isInterviewToday };
  }

  // target_areas（project から取得。取れなくてもエリア行を空にするだけで続行）
  let targetAreas: string[] = [];
  if (projectId !== null) {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/api/projects/${projectId}`);
      if (res.ok) {
        const p = (await res.json()) as { target_areas?: string[] | null };
        targetAreas = (p.target_areas ?? []).filter((a) => !isEffectivelyEmpty(a));
      }
    } catch (e) {
      console.error("[site-guide-draft] project fetch failed:", e);
    }
  }

  // 希望条件: Candidate.desired* があれば優先（CA 手編集を尊重）、無ければ最新面談
  const desiredJobTypes = [candidate.desiredJobType1, candidate.desiredJobType2].filter(
    (v): v is string => !isEffectivelyEmpty(v)
  );
  if (desiredJobTypes.length === 0 && latest) {
    for (const v of [latest.desiredJobType1, latest.desiredJobType2]) {
      if (!isEffectivelyEmpty(v)) desiredJobTypes.push(v as string);
    }
  }

  let desiredPrefectures = [candidate.desiredPrefecture1, candidate.desiredPrefecture2].filter(
    (v): v is string => !isEffectivelyEmpty(v)
  );
  if (desiredPrefectures.length === 0 && latest) {
    desiredPrefectures = splitMeaningful(latest.desiredPrefecture, /[、,]/);
  }

  const desiredSalaryMin = !isEffectivelyEmpty(candidate.desiredSalaryMin)
    ? candidate.desiredSalaryMin
    : latest && !isEffectivelyEmpty(latest.desiredSalaryMin)
      ? latest.desiredSalaryMin
      : null;

  // 職種ラベル一覧（「、」連結をほぐして重複除去・実質空値除去）
  const labelSet = new Set<string>();
  for (const j of targetJobs) {
    for (const label of splitMeaningful(j.job_category, /[、,]/)) labelSet.add(label);
  }

  const areaLine = buildAreaLine(desiredPrefectures, targetAreas);
  const salaryLine = buildSalaryLine(desiredSalaryMin, targetJobs);
  const jobTypeLine = await generateJobTypeLine([...labelSet], desiredJobTypes, candidateId);

  const draft = [jobTypeLine, "業種：", areaLine, salaryLine].join("\n");
  return { draft, generated: true, isInterviewToday };
}
