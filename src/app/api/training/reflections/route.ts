import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// JST の当日日付文字列（罠#17: Railway 本番は UTC のため toISOString 由来は使わない）
function todayJst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

// 当日分の作成・更新（upsert）: ログイン済み全員
// reportDate はリクエストから受け取らず、サーバー側で JST 当日を算出する
export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });
  }

  const { learned, confused, questions, freeNote } = body;

  if (typeof learned !== "string" || learned.trim().length === 0) {
    return NextResponse.json({ error: "「今日一番の学び」は必須です" }, { status: 400 });
  }
  if (typeof confused !== "string" || confused.trim().length === 0) {
    return NextResponse.json({ error: "「一番分からなかったこと」は必須です" }, { status: 400 });
  }
  if (typeof questions !== "string" || questions.trim().length === 0) {
    return NextResponse.json({ error: "「明日聞きたいこと」は必須です" }, { status: 400 });
  }
  if (freeNote !== undefined && freeNote !== null && typeof freeNote !== "string") {
    return NextResponse.json({ error: "自由記述の形式が不正です" }, { status: 400 });
  }

  const reportDate = todayJst();
  const freeNoteValue =
    typeof freeNote === "string" && freeNote.trim().length > 0 ? freeNote.trim() : null;

  const reflection = await prisma.trainingReflection.upsert({
    where: { userId_reportDate: { userId: actor.id, reportDate } },
    update: {
      userName: actor.name ?? actor.email ?? "不明",
      learned: learned.trim(),
      confused: confused.trim(),
      questions: questions.trim(),
      freeNote: freeNoteValue,
    },
    create: {
      userId: actor.id,
      userName: actor.name ?? actor.email ?? "不明",
      reportDate,
      learned: learned.trim(),
      confused: confused.trim(),
      questions: questions.trim(),
      freeNote: freeNoteValue,
    },
  });

  return NextResponse.json({ id: reflection.id, reportDate: reflection.reportDate });
}

// 一覧: admin は全員分（userId で絞り込み可）、member は自分の分のみ
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const isAdmin = actor.role === "admin";

  const userIdParam = sp.get("userId");
  const userId = isAdmin ? userIdParam || undefined : actor.id;

  // reportDate は "YYYY-MM-DD" の文字列なので範囲は文字列比較でよい
  const from = sp.get("from");
  const to = sp.get("to");
  const reportDate: { gte?: string; lte?: string } = {};
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) reportDate.gte = from;
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) reportDate.lte = to;

  const reflections = await prisma.trainingReflection.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(reportDate.gte || reportDate.lte ? { reportDate } : {}),
    },
    orderBy: [{ reportDate: "desc" }, { userName: "asc" }],
  });

  // selfId はフォームのプリフィル用（admin は全員分が返るため自分の当日分を特定する必要がある）
  return NextResponse.json({ reflections, isAdmin, today: todayJst(), selfId: actor.id });
}
