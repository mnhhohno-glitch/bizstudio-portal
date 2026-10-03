// T-206: 内部 API（CA がログインして使う）の共通部品。
//   ★ポータルの middleware は /api/ を素通しにしているため、各ルートの冒頭で必ず requireActor() を通す。
import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { MAX_HTML_BYTES, isMensetsuStage } from "./constants";
import { ymdToUtcDate } from "./dates";

export async function requireActor(): Promise<{ actor: SessionUser; res?: undefined } | { actor?: undefined; res: NextResponse }> {
  const actor = await getSessionUser();
  if (!actor) return { res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { actor };
}

export function badRequest(error: string, message?: string): NextResponse {
  return NextResponse.json({ error, message: message ?? error }, { status: 400 });
}

/** アップロード HTML の検証（文字列・空でない・4MB 以内） */
export function validateHtml(html: unknown): { ok: true; html: string } | { ok: false; res: NextResponse } {
  if (typeof html !== "string" || !html.trim()) {
    return { ok: false, res: badRequest("html_required", "HTML ファイルの中身がありません") };
  }
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_HTML_BYTES) {
    return { ok: false, res: badRequest("html_too_large", `HTML が大きすぎます（${(bytes / 1024 / 1024).toFixed(1)}MB）。4MB 以内にしてください`) };
  }
  return { ok: true, html };
}

export function parseStage(v: unknown): string | null {
  return isMensetsuStage(v) ? v : null;
}

/** "YYYY-MM-DD" | null | undefined → Date | null | undefined（undefined=変更なし） */
export function parseInterviewDate(v: unknown): { ok: true; value: Date | null | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const d = ymdToUtcDate(v);
  return d ? { ok: true, value: d } : { ok: false };
}

export function parseOptionalString(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}
