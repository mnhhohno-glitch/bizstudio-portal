// T-XXX: 求人評価の「入力の部品」と「結果」の保存、および変更なしスキップの判定。
//
// 目的:
//   ① 中身（SKILL 等の共通部分・指示文・求職者情報・求人本文）とモデル・effort が前回の評価と同じ求人は
//      AI に送らず前回の結果を使う（全件分析・追加分析のみ。未評価/破損のみ・自動配信は対象外）
//   ② 後日、実際の選考結果と答え合わせできるよう、評価のたびに AI に送った中身と結果を残す
//
// 保存の形:
//   - JobEvalPart … 部品を内容のハッシュ（SHA-256）で1回だけ保存（同じ中身は重複しない）
//   - JobEvalRecord … 評価1回 × 求人1件で1行。部品はハッシュで参照する
//   求職者情報は「ブックマーク一覧の行」と「それ以外」に分けてハッシュを持つ。スキップ判定には
//   「それ以外」だけを使う（＝ブックマークの増減だけでは評価し直さない）。
//
// 方針:
//   - ここでの保存失敗は評価そのものを止めない。各関数は内部で try/catch し、warn ログを出して
//     null / 空を返す（呼び出し側は結果を await しても本体の失敗にならない）
//   - AI に送る内容はここでは一切変えない（ハッシュを取るだけ）
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getCategoryLabel } from "@/lib/constants/candidate-file-categories";
import { extractAxis } from "@/lib/ai-rating";
import { buildBatchInstruction, hasValidThreeAxisMarkers } from "@/lib/analyze-bookmarks";

export type EvalRoute = "full" | "incremental" | "invalid-only" | "auto";
export type EvalRecordStatus = "PENDING" | "SAVED" | "SKIPPED" | "FAILED" | "REUSED";
export type EvalPartKind = "fixed" | "instruction" | "context_core" | "context_files" | "job";

const LOG = "[eval-history]";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 求人本文（位置番号を含まない）。buildAnalyzeJobsSection が送る「### 求人N: ファイル名\n本文(3,000字)」の
 * うち N を除いた部分。N はバッチ内の並び順で変わるだけなので、ハッシュには含めない。
 */
export function jobBodyForHash(file: { fileName: string; extractedText: string | null }): string {
  return `${file.fileName}\n${(file.extractedText || "").substring(0, 3000)}`;
}

/** 求職者情報を「ブックマーク一覧の行」と「それ以外」に分ける（送る内容は変えない。ハッシュ用）。 */
export function splitCandidateContext(context: string): { core: string; files: string } {
  const header = "## アップロード済みファイル\n";
  const start = context.indexOf(header);
  if (start === -1) return { core: context, files: "" };
  const bodyStart = start + header.length;
  const nextSection = context.indexOf("\n## ", bodyStart);
  const sectionEnd = nextSection === -1 ? context.length : nextSection + 1;
  const section = context.substring(bodyStart, sectionEnd);
  const prefix = `- [${getCategoryLabel("BOOKMARK")}] `;
  const bookmarkLines: string[] = [];
  const otherLines: string[] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith(prefix)) bookmarkLines.push(line);
    else otherLines.push(line);
  }
  return {
    core: context.substring(0, bodyStart) + otherLines.join("\n") + context.substring(sectionEnd),
    files: bookmarkLines.join("\n"),
  };
}

/** 件数・位置の数字を固定した指示文のハッシュ（文言が変わった時だけ変わる）。 */
export function instructionTemplateHash(): string {
  return sha256(buildBatchInstruction({ totalFiles: 1, start: 0, end: 1, isLastBatch: false }));
}

export type EvalInputHashes = {
  fixedHash: string;
  instructionHash: string;
  instructionTemplateHash: string;
  contextCoreHash: string;
  contextFilesHash: string | null;
};

/**
 * 1回の送信の部品（共通部分・指示文・求職者情報2分割・求人本文）を保存し、ハッシュを返す。
 * 同じハッシュの部品は保存しない（createMany skipDuplicates）。失敗時は null。
 */
export async function saveEvalInputParts(params: {
  fixedSystem: string;
  instruction: string;
  candidateContext: string;
  files: { id: string; fileName: string; extractedText: string | null }[];
}): Promise<{ hashes: EvalInputHashes; jobHashById: Map<string, string> } | null> {
  try {
    const { core, files } = splitCandidateContext(params.candidateContext);
    const parts: { hash: string; kind: EvalPartKind; content: string }[] = [
      { hash: sha256(params.fixedSystem), kind: "fixed", content: params.fixedSystem },
      { hash: sha256(params.instruction), kind: "instruction", content: params.instruction },
      { hash: sha256(core), kind: "context_core", content: core },
    ];
    if (files !== "") parts.push({ hash: sha256(files), kind: "context_files", content: files });
    const jobHashById = new Map<string, string>();
    for (const f of params.files) {
      const body = jobBodyForHash(f);
      const h = sha256(body);
      jobHashById.set(f.id, h);
      parts.push({ hash: h, kind: "job", content: body });
    }
    // 同一送信内に同じ求人本文が2件あっても createMany の重複で落ちないよう、hash で一意にする。
    const uniq = new Map(parts.map((p) => [p.hash, p]));
    await prisma.jobEvalPart.createMany({
      data: [...uniq.values()].map((p) => ({
        hash: p.hash,
        kind: p.kind,
        content: p.content,
        chars: p.content.length,
      })),
      skipDuplicates: true,
    });
    return {
      hashes: {
        fixedHash: parts[0].hash,
        instructionHash: parts[1].hash,
        instructionTemplateHash: instructionTemplateHash(),
        contextCoreHash: parts[2].hash,
        contextFilesHash: files !== "" ? sha256(files) : null,
      },
      jobHashById,
    };
  } catch (e) {
    console.warn(`${LOG} 部品の保存に失敗（評価は続行）:`, e);
    return null;
  }
}

export type ReusableEvaluation = {
  id: string;
  overallRating: string | null;
  comment: string | null;
};

/**
 * 変更なしスキップの判定。各求人について「前回 SAVED の評価」が次の全てで一致すれば再利用できる:
 *   共通部分・指示文（テンプレート）・求職者情報（ブックマーク一覧を除く）・求人本文・モデル・effort
 * 加えて、CandidateFile に今も同じ結果が残っていること（総合ランクが一致し、3軸マーカーが揃っている）。
 * 保存データが無い求人（この仕組みより前の評価）は再利用しない＝従来どおり評価する。
 */
export async function findReusableEvaluations(params: {
  files: { id: string; aiMatchRating: string | null; aiAnalysisComment: string | null }[];
  hashes: EvalInputHashes;
  jobHashById: Map<string, string>;
  model: string;
  effort: string | null;
}): Promise<Map<string, ReusableEvaluation>> {
  const reusable = new Map<string, ReusableEvaluation>();
  if (params.files.length === 0) return reusable;
  try {
    const rows = await prisma.jobEvalRecord.findMany({
      where: { candidateFileId: { in: params.files.map((f) => f.id) }, status: "SAVED" },
      orderBy: { createdAt: "desc" },
      distinct: ["candidateFileId"],
      select: {
        id: true,
        candidateFileId: true,
        model: true,
        effort: true,
        fixedHash: true,
        instructionTemplateHash: true,
        contextCoreHash: true,
        jobHash: true,
        overallRating: true,
        comment: true,
      },
    });
    const byFile = new Map(rows.map((r) => [r.candidateFileId, r]));
    for (const f of params.files) {
      const prev = byFile.get(f.id);
      if (!prev) continue;
      const same =
        prev.model === params.model &&
        (prev.effort ?? null) === (params.effort ?? null) &&
        prev.fixedHash === params.hashes.fixedHash &&
        prev.instructionTemplateHash === params.hashes.instructionTemplateHash &&
        prev.contextCoreHash === params.hashes.contextCoreHash &&
        prev.jobHash === params.jobHashById.get(f.id);
      if (!same) continue;
      // 前回の結果が CandidateFile に今も残っていること（消されていたら評価し直す）。
      if (!f.aiMatchRating || f.aiMatchRating !== prev.overallRating) continue;
      if (!hasValidThreeAxisMarkers(f.aiAnalysisComment)) continue;
      reusable.set(f.id, { id: prev.id, overallRating: prev.overallRating, comment: prev.comment });
    }
  } catch (e) {
    console.warn(`${LOG} 前回評価の照会に失敗（スキップせず評価する）:`, e);
  }
  return reusable;
}

type RecordBase = {
  candidateId: string;
  route: EvalRoute;
  model: string;
  effort: string | null;
  requestKey: string;
  ledgerId?: string | null;
  hashes: EvalInputHashes;
  jobHashById: Map<string, string>;
};

function ratingsFromComment(comment: string | null | undefined) {
  return {
    desireRating: extractAxis(comment, "本人希望"),
    passRating: extractAxis(comment, "通過率", { requireMarker: false }),
  };
}

/**
 * AI に送った求人の結果を行として保存する（SAVED / SKIPPED / FAILED）。
 * costUsd は送信全体の費用を送信件数で割った値。
 */
export async function recordEvaluationResults(
  base: RecordBase,
  params: {
    files: { id: string }[];
    results: Map<string, { rating: string; comment: string }>;
    skippedFileIds: string[];
    failed?: boolean;
    evaluatedAt: Date;
    costUsd: number | null;
    usageLogId: string | null;
  },
): Promise<number> {
  try {
    const n = params.files.length;
    const perFile = params.costUsd != null && n > 0 ? params.costUsd / n : null;
    const skipped = new Set(params.skippedFileIds);
    const data = params.files.map((f) => {
      const r = params.results.get(f.id);
      const status: EvalRecordStatus = params.failed ? "FAILED" : skipped.has(f.id) || !r ? "SKIPPED" : "SAVED";
      return {
        candidateId: base.candidateId,
        candidateFileId: f.id,
        route: base.route,
        status,
        model: base.model,
        effort: base.effort,
        evaluatedAt: params.evaluatedAt,
        desireRating: status === "SAVED" ? ratingsFromComment(r?.comment).desireRating : null,
        passRating: status === "SAVED" ? ratingsFromComment(r?.comment).passRating : null,
        overallRating: status === "SAVED" ? r?.rating ?? null : null,
        comment: status === "SAVED" ? r?.comment ?? null : null,
        costUsd: perFile,
        usageLogId: params.usageLogId,
        requestKey: base.requestKey,
        ledgerId: base.ledgerId ?? null,
        reusedFromId: null,
        fixedHash: base.hashes.fixedHash,
        instructionHash: base.hashes.instructionHash,
        instructionTemplateHash: base.hashes.instructionTemplateHash,
        contextCoreHash: base.hashes.contextCoreHash,
        contextFilesHash: base.hashes.contextFilesHash,
        jobHash: base.jobHashById.get(f.id) ?? "",
      };
    });
    const r = await prisma.jobEvalRecord.createMany({ data });
    return r.count;
  } catch (e) {
    console.warn(`${LOG} 評価結果の保存に失敗（評価は続行）:`, e);
    return 0;
  }
}

/** 変更なしで前回の結果を使った求人を REUSED 行として残す（AI は呼ばない・費用 0）。 */
export async function recordReusedEvaluations(
  base: RecordBase,
  reused: Map<string, ReusableEvaluation>,
): Promise<number> {
  if (reused.size === 0) return 0;
  try {
    const now = new Date();
    const data = [...reused].map(([fileId, prev]) => ({
      candidateId: base.candidateId,
      candidateFileId: fileId,
      route: base.route,
      status: "REUSED" as EvalRecordStatus,
      model: base.model,
      effort: base.effort,
      evaluatedAt: now,
      ...ratingsFromComment(prev.comment),
      overallRating: prev.overallRating,
      comment: prev.comment,
      costUsd: 0,
      usageLogId: null,
      requestKey: base.requestKey,
      ledgerId: base.ledgerId ?? null,
      reusedFromId: prev.id,
      fixedHash: base.hashes.fixedHash,
      instructionHash: base.hashes.instructionHash,
      instructionTemplateHash: base.hashes.instructionTemplateHash,
      contextCoreHash: base.hashes.contextCoreHash,
      contextFilesHash: base.hashes.contextFilesHash,
      jobHash: base.jobHashById.get(fileId) ?? "",
    }));
    const r = await prisma.jobEvalRecord.createMany({ data });
    return r.count;
  } catch (e) {
    console.warn(`${LOG} 再利用行の保存に失敗（評価は続行）:`, e);
    return 0;
  }
}

/**
 * 自動配信（Message Batches）の投入時に PENDING 行を作る。回収時に completePendingEvaluations で埋める。
 */
export async function recordPendingEvaluations(
  base: RecordBase,
  files: { id: string }[],
): Promise<number> {
  try {
    const r = await prisma.jobEvalRecord.createMany({
      data: files.map((f) => ({
        candidateId: base.candidateId,
        candidateFileId: f.id,
        route: base.route,
        status: "PENDING" as EvalRecordStatus,
        model: base.model,
        effort: base.effort,
        requestKey: base.requestKey,
        ledgerId: base.ledgerId ?? null,
        fixedHash: base.hashes.fixedHash,
        instructionHash: base.hashes.instructionHash,
        instructionTemplateHash: base.hashes.instructionTemplateHash,
        contextCoreHash: base.hashes.contextCoreHash,
        contextFilesHash: base.hashes.contextFilesHash,
        jobHash: base.jobHashById.get(f.id) ?? "",
      })),
    });
    return r.count;
  } catch (e) {
    console.warn(`${LOG} 投入時の行作成に失敗（投入は続行）:`, e);
    return 0;
  }
}

/** 自動配信の回収時: 台帳行（ledgerId）に対応する PENDING 行へ結果を書き込む。 */
export async function completePendingEvaluations(params: {
  ledgerId: string;
  model: string;
  results: Map<string, { rating: string; comment: string }>;
  skippedFileIds: string[];
  failed?: boolean;
  evaluatedAt: Date;
  costUsd: number | null;
  usageLogId: string | null;
}): Promise<number> {
  try {
    const pending = await prisma.jobEvalRecord.findMany({
      where: { ledgerId: params.ledgerId, status: "PENDING" },
      select: { id: true, candidateFileId: true },
    });
    if (pending.length === 0) return 0;
    const perFile = params.costUsd != null ? params.costUsd / pending.length : null;
    const skipped = new Set(params.skippedFileIds);
    let n = 0;
    for (const row of pending) {
      const r = params.results.get(row.candidateFileId);
      const status: EvalRecordStatus = params.failed
        ? "FAILED"
        : skipped.has(row.candidateFileId) || !r
          ? "SKIPPED"
          : "SAVED";
      await prisma.jobEvalRecord.update({
        where: { id: row.id },
        data: {
          status,
          model: params.model,
          evaluatedAt: params.evaluatedAt,
          desireRating: status === "SAVED" ? ratingsFromComment(r?.comment).desireRating : null,
          passRating: status === "SAVED" ? ratingsFromComment(r?.comment).passRating : null,
          overallRating: status === "SAVED" ? r?.rating ?? null : null,
          comment: status === "SAVED" ? r?.comment ?? null : null,
          costUsd: params.failed ? null : perFile,
          usageLogId: params.usageLogId,
        },
      });
      n++;
    }
    return n;
  } catch (e) {
    console.warn(`${LOG} 回収結果の書き込みに失敗（回収は続行）:`, e);
    return 0;
  }
}
