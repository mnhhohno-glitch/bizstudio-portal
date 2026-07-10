import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_CA_SELECT,
  applyJobResponseIntent,
  createOrUpdateResponseTask,
  ensureBookmarkForMypageResponse,
} from "@/lib/mypage-response-sync";

// kyuujinPDF → portal のマイページ回答 webhook。
// T-133 P2: upsert/取り消し/タスク生成の本体を src/lib/mypage-response-sync.ts へ抽出
// （portal内製API response-status / response-submission と共有）。本 route の挙動は従来から不変。

export async function POST(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.KYUUJIN_API_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { candidateId, jobId, response, respondedAt } = body as {
    candidateId: string;
    jobId: number;
    response: string | null;
    respondedAt: string;
  };

  // 構造的必須項目（候補者・求人の特定に不可欠）は fail-closed で 400 のまま。
  if (!candidateId || !jobId) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // T-128 Phase1: 「気になる/応募したい」を未回答へ戻すと mypage は response=null（キーあり・
  // リテラル null）を送ってくる。これを「取り消し」として正当に受理し、該当の
  // CandidateJobResponse を削除する。null/""/"none"/"NONE" を取り消しシグナルとして扱う。
  const isClear =
    response === null ||
    response === undefined ||
    response === "" ||
    response === "none" ||
    response === "NONE";

  const validResponses = ["WANT_TO_APPLY", "INTERESTED"];
  // 取り消しでも既知の値でもない未知の値は従来どおり 400（fail-closed を緩めない）。
  if (!isClear && !validResponses.includes(response as string)) {
    return NextResponse.json(
      { error: "Invalid response value" },
      { status: 400 }
    );
  }

  const candidate = await prisma.candidate.findFirst({
    where: candidateId.startsWith("cm")
      ? { id: candidateId }
      : { candidateNumber: candidateId },
    select: CANDIDATE_CA_SELECT,
  });

  if (!candidate) {
    return NextResponse.json(
      { error: "Candidate not found" },
      { status: 404 }
    );
  }

  // 取り消し: 該当（候補者×求人）の回答レコードを削除。無ければ no-op（冪等）。
  // 正常系（値あり）と同一の複合キーで特定する。タスクの再生成はしない（追加専用のまま）。
  if (isClear) {
    const before = await prisma.candidateJobResponse.count({
      where: { candidateId: candidate.id, externalJobId: jobId },
    });
    await applyJobResponseIntent(candidate.id, jobId, null);
    return NextResponse.json({
      success: true,
      cleared: true,
      deletedCount: before,
    });
  }

  const respondedAtDate = respondedAt ? new Date(respondedAt) : new Date();

  await applyJobResponseIntent(
    candidate.id,
    jobId,
    response as "WANT_TO_APPLY" | "INTERESTED",
    respondedAtDate,
  );

  // 追加（既存処理は不変）: 台帳（CandidateFile BOOKMARK）を確保し、CA画面のブックマークに出るようにする。
  // 既存行があれば何もしない（冪等）。失敗しても回答同期・タスクは維持する。
  try {
    await ensureBookmarkForMypageResponse({
      candidateId: candidate.id,
      candidateNumber: candidate.candidateNumber,
      kyuujinJobId: jobId,
      response: response as "WANT_TO_APPLY" | "INTERESTED",
      respondedAt: respondedAtDate,
    });
  } catch (e) {
    console.error("ブックマーク台帳の確保に失敗:", e);
  }

  try {
    await createOrUpdateResponseTask(candidate);
  } catch (e) {
    console.error("マイページ回答タスク自動生成に失敗:", e);
  }

  return NextResponse.json({ success: true, updated: true });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-secret",
    },
  });
}
