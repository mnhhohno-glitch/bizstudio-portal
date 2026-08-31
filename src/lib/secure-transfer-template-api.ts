// T-185: 宛先・文面テンプレートAPIのサーバー側共通ヘルパー。
// route.ts は HTTP メソッド以外を export できない（Next のルート検証で落ちる）ため、ここに置く。

import { prisma } from "@/lib/prisma";
import { isContactField } from "@/lib/secure-transfer-templates";
import { MAX_TRANSFER_RECIPIENTS } from "@/lib/secure-transfer-shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactInput = {
  name?: string | null;
  email?: string;
  defaultField?: string;
};

export type NormalizedContact = {
  name: string | null;
  email: string;
  defaultField: string;
  sortOrder: number;
};

/** 担当者入力の検証と正規化。不正があれば { error } を返す。 */
export function normalizeContacts(
  input: unknown
): { contacts: NormalizedContact[] } | { error: string } {
  const list = Array.isArray(input) ? (input as ContactInput[]) : [];
  if (list.length === 0) {
    return { error: "担当者を1件以上登録してください" };
  }
  if (list.length > 30) {
    return { error: "担当者は最大30件までです" };
  }
  const contacts: NormalizedContact[] = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const email = typeof c.email === "string" ? c.email.trim() : "";
    if (!EMAIL_RE.test(email)) {
      return { error: `メールアドレスの形式が正しくありません: ${email || "（未入力）"}` };
    }
    const field = c.defaultField ?? "TO";
    if (!isContactField(field)) {
      return { error: "宛先区分（TO/CC/入れない）が不正です" };
    }
    contacts.push({
      name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : null,
      email,
      defaultField: field,
      sortOrder: i, // 並び順は配列順で採番し直す
    });
  }
  // 既定で TO/CC に入る件数が送信時の上限を超えていたら保存時点で弾く（使うたびに毎回削らせない）
  const defaultCount = contacts.filter((c) => c.defaultField !== "NONE").length;
  if (defaultCount > MAX_TRANSFER_RECIPIENTS) {
    return {
      error: `既定でTO/CCに入る担当者は合計${MAX_TRANSFER_RECIPIENTS}件までにしてください`,
    };
  }
  return { contacts };
}

/** createdByUserId → 表示名の解決（FKを張らない方針のため都度引く）。 */
export async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/**
 * 文面テンプレートの本文・署名に固定生成部の見出しが紛れ込んでいないかの検査。
 * 実送信メールの全文を管理画面へ貼り付けてテンプレート化すると、
 * 過去の URL・パスワードがテンプレートに固定保存される事故になるため保存時に弾く（確定仕様）。
 */
export function findForbiddenFixedBlockMarker(...texts: (string | null | undefined)[]): string | null {
  const markers = ["■ダウンロードURL", "■パスワード", "■有効期限", "■ファイル"];
  for (const text of texts) {
    if (!text) continue;
    for (const m of markers) {
      if (text.includes(m)) return m;
    }
  }
  return null;
}
