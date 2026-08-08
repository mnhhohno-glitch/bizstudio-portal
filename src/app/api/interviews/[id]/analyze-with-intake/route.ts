import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";
import {
  mapFilemakerToDetail,
  mapWorkHistoryArray,
  workHistoryToDetailSync,
} from "@/lib/interview-analyzer-mapping";
import { detectSuggestedTasksFromInterviewLog } from "@/lib/interview/detect-suggested-tasks";
import type { SuggestedTask } from "@/lib/advisor/suggested-tasks";

export const runtime = "nodejs";
export const maxDuration = 300;

// T-067 Phase 5: 解析対象ファイルの source of truth を
// InterviewAttachment(Supabase) → CandidateFile(category=MEETING, Google Drive) に変更。
// ファイル取得は candidateId 経由で Drive から実体ダウンロードする。

// T-153: 面談ログ(txt)が無い状態での解析は「エラーで止まるのが正しい挙動」と決定した（業務判断）。
// 面談詳細は「面談ログ + 職務経歴書」がセットで初めて完成するもので、PDF単独の中途半端な
// 面談詳細はむしろ害になる。加えて PDF単独解析は Gemini トークンを無駄に消費する。
// よって upstream へは従来どおり空白1文字を送り（＝ upstream が 400 で弾く）、
// UI 側で「txt が無ければ解析ボタンを押せない」ようにして手前で止める。
// 詳細: docs/survey_T-152_T-153_analyze_with_intake.md

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const intakeUrl = process.env.CANDIDATE_INTAKE_URL
      || process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL
      || "https://candidate-intake-production.up.railway.app";
    const secret = process.env.PORTAL_SHARED_SECRET;
    if (!secret) {
      console.error("[analyze-with-intake] PORTAL_SHARED_SECRET is not configured");
      return NextResponse.json(
        { error: "PORTAL_SHARED_SECRETが設定されていません。Railway環境変数を確認してください。" },
        { status: 500 },
      );
    }

    const { id: interviewId } = await params;
    console.log(`[analyze-with-intake] Starting for interview=${interviewId}, intakeUrl=${intakeUrl}`);

    const record = await prisma.interviewRecord.findUnique({
      where: { id: interviewId },
      include: {
        candidate: { select: { id: true, candidateNumber: true } },
      },
    });
    if (!record) {
      return NextResponse.json({ error: "面談レコードが見つかりません" }, { status: 404 });
    }

    // T-067: CandidateFile(category=MEETING) から txt/pdf を取得
    const meetingFiles = await prisma.candidateFile.findMany({
      where: {
        candidateId: record.candidate.id,
        category: "MEETING",
        archivedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    console.log(`[analyze-with-intake] Found ${meetingFiles.length} MEETING files`);

    const isTxt = (f: typeof meetingFiles[number]) =>
      f.mimeType.startsWith("text/") || f.fileName.toLowerCase().endsWith(".txt");
    const isPdf = (f: typeof meetingFiles[number]) =>
      f.mimeType === "application/pdf" || f.fileName.toLowerCase().endsWith(".pdf");

    // T-152: ログは「この面談に紐づくもの（interviewId 一致）」を最優先で使う。
    // 紐付きが無ければ従来どおり求職者の全 txt から最新を使う（過去アップロード分は
    // 全件 interview_id=NULL のため、厳格に絞ると解析が止まる。フォールバック必須）。
    // ★自動入力と T-151 タスク検出は必ず同じファイルを使う（txtFiles[0] が唯一の入力元）。
    const allTxt = meetingFiles.filter(isTxt);
    const linkedTxt = allTxt.filter((f) => f.interviewId === interviewId);
    const txtFiles = linkedTxt.length > 0 ? linkedTxt : allTxt;
    // 最新を優先（findMany が createdAt desc なので先頭が最新）
    const pdfFiles = meetingFiles.filter(isPdf);

    console.log(
      `[analyze-with-intake] txt=${txtFiles.length} (linked=${linkedTxt.length}, all=${allTxt.length}), pdf=${pdfFiles.length}`,
    );

    if (txtFiles.length === 0 && pdfFiles.length === 0) {
      return NextResponse.json(
        { error: "Nottaログ(.txt)または履歴書PDFを添付してください" },
        { status: 400 },
      );
    }

    let interviewLog = "";
    let pdfBuffer = "";

    if (txtFiles.length > 0 && txtFiles[0].driveFileId) {
      const target = txtFiles[0];
      console.log(`[analyze-with-intake] Downloading txt from Drive: ${target.fileName} (${target.driveFileId})`);
      try {
        const { base64 } = await downloadFileFromDrive(target.driveFileId!);
        interviewLog = Buffer.from(base64, "base64").toString("utf-8");
        console.log(`[analyze-with-intake] txt loaded: ${interviewLog.length} chars`);
      } catch (e) {
        console.error("[analyze-with-intake] txt download error:", e);
        return NextResponse.json({ error: "面談ログのダウンロードに失敗しました" }, { status: 500 });
      }
    }

    if (pdfFiles.length > 0 && pdfFiles[0].driveFileId) {
      const target = pdfFiles[0];
      console.log(`[analyze-with-intake] Downloading pdf from Drive: ${target.fileName} (${target.driveFileId})`);
      try {
        const { base64 } = await downloadFileFromDrive(target.driveFileId!);
        pdfBuffer = base64;
        console.log(`[analyze-with-intake] pdf loaded: ${pdfBuffer.length} base64 chars`);
      } catch (e) {
        console.error("[analyze-with-intake] pdf download error:", e);
        return NextResponse.json({ error: "PDFのダウンロードに失敗しました" }, { status: 500 });
      }
    }

    if (!interviewLog && !pdfBuffer) {
      return NextResponse.json(
        { error: "ファイルの読み取りに失敗しました" },
        { status: 500 },
      );
    }

    console.log(`[analyze-with-intake] Calling candidate-intake API...`);
    const res = await fetch(`${intakeUrl}/api/portal/analyze-interview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-portal-secret": secret,
      },
      body: JSON.stringify({
        pdfBuffer: pdfBuffer || "IA==",
        interviewLog: interviewLog || " ",
        candidateNumber: record.candidate.candidateNumber || "0000000",
      }),
    });

    console.log(`[analyze-with-intake] Upstream response: ${res.status}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      // T-153: 内部エラー本文はサーバーログにだけ残す。
      // 画面には英語の upstream メッセージをそのまま出さない（CAが対処できないため）。
      console.error(
        `[analyze-with-intake] Upstream error: status=${res.status} body=${JSON.stringify(err)}`,
      );
      return NextResponse.json(
        {
          error:
            "解析に失敗しました。時間をおいて再度お試しください。解消しない場合は管理者へご連絡ください。",
        },
        { status: 502 },
      );
    }

    const data = await res.json();
    if (!data.success) {
      return NextResponse.json(
        { error: `解析に失敗しました: ${data.error || "Unknown"}` },
        { status: 500 },
      );
    }

    const fmMapping = (data.filemaker_mapping || {}) as Record<string, unknown>;
    const rawWorkHistory = (data.work_history || []) as Record<string, unknown>[];
    const missingItems = (data.missing_items || []) as string[];

    const { detailUpdates, interviewMemo } = mapFilemakerToDetail(fmMapping);
    const workHistories = mapWorkHistoryArray(rawWorkHistory);
    const detailFromWH = workHistoryToDetailSync(workHistories);

    const merged = { ...detailUpdates, ...detailFromWH } as Record<string, unknown>;

    const existing = await prisma.interviewDetail.findUnique({
      where: { interviewRecordId: interviewId },
    });
    const empty = (v: unknown) => v == null || v === "";

    const prefPattern = /^(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/;
    function resolvePrefecture(): string {
      if (!empty(merged.desiredPrefecture)) return String(merged.desiredPrefecture);
      const area = merged.desiredArea;
      if (!area || typeof area !== "string") return "";
      const m = area.match(prefPattern);
      return m ? m[1] : "";
    }

    const REG_MAP: [string, string][] = [
      ["desiredJobType1", "regJobType1"],
      ["desiredJobType2", "regJobType2"],
      ["desiredEmploymentType", "regEmploymentType"],
      ["desiredSalaryMin", "regSalaryMin"],
    ];
    for (const [src, dst] of REG_MAP) {
      if (empty(existing?.[dst as keyof typeof existing]) && !empty(merged[src])) {
        merged[dst] = merged[src];
      }
    }
    const resolvedPref = resolvePrefecture();
    if (empty(existing?.regAreaPrefecture) && resolvedPref) {
      merged.regAreaPrefecture = resolvedPref;
    }

    console.log(`[analyze-with-intake] Success: ${Object.keys(merged).length} detail fields, ${workHistories.length} work histories`);

    // ---- T-151: タスク候補の検出（後段・fail-open） ----
    // ★ここで例外を投げてはいけない。検出が失敗しても解析結果（各カラムへの自動入力）は必ず返す。
    // ★入力は面談ログ(txt)のみ。履歴書PDFを混ぜると書類内の「送付」等で誤検出するため渡さない。
    let suggestedTasks: SuggestedTask[] = [];
    try {
      if (!interviewLog.trim()) {
        console.log("[analyze-with-intake] T-151: txt が無いため候補検出をスキップ");
        // T-151: 破棄済みの面談では候補を出し直さない（CA が「今回は不要」と判断済みのため）。
      } else if (record.suggestedTasksDismissedAt) {
        console.log("[analyze-with-intake] T-151: 破棄済みのため候補検出をスキップ");
      } else {
        const detected = await detectSuggestedTasksFromInterviewLog({
          interviewLog,
          candidateId: record.candidate.id,
        });
        suggestedTasks = detected.suggestedTasks;

        // 候補は面談レコードに保存する（ページ再読込・タブ切替でカードを復元するため）。
        // 0件のときは null に戻す（空配列を残さない＝T-150 の advisor 側と同じ扱い）。
        await prisma.interviewRecord.update({
          where: { id: interviewId },
          data: { suggestedTasks: suggestedTasks.length > 0 ? suggestedTasks : Prisma.DbNull },
        });
      }
    } catch (e) {
      // 保存に失敗しても解析本体は成功扱いにする。
      console.error("[analyze-with-intake] T-151 候補検出に失敗（解析は成功）:", e);
      suggestedTasks = [];
    }

    return NextResponse.json({
      success: true,
      detailUpdates: merged,
      interviewMemo,
      workHistories,
      missingItems,
      suggestedTasks,
    });
  } catch (e) {
    console.error("[analyze-with-intake] Unexpected error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
