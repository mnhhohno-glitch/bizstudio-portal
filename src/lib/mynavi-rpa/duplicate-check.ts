import { prisma } from "@/lib/prisma";
import { normalizePhoneNumber } from "@/lib/phone-normalize";

/**
 * 二重処理スキップを表す処理ログ status。
 * 旧値 "DUPLICATE_SKIP"（〜2026-09-06）と新値 "DUPLICATE_SKIPPED" の両方を扱う。
 */
export const DUPLICATE_SKIP_STATUSES = ["DUPLICATE_SKIP", "DUPLICATE_SKIPPED"] as const;

/** 同一人物と判定した根拠のキー */
export type DuplicateMatchKey = "mynaviMemberNo" | "phone" | "nameBirthday";

export const DUPLICATE_MATCH_LABELS: Record<DuplicateMatchKey, string> = {
  mynaviMemberNo: "マイナビ会員No",
  phone: "電話番号",
  nameBirthday: "氏名＋生年月日",
};

export type DuplicateCandidateHit = {
  id: string;
  candidateNumber: string;
  name: string;
  supportStatus: string;
  applicationDate: Date | null;
  mediaSource: string | null;
  phone: string | null;
  mynaviMemberNo: string | null;
  reapplicationCount: number;
  matchedBy: DuplicateMatchKey;
};

export type DuplicateCandidateInput = {
  /** マイナビ会員No（10桁）。最も信頼できるキー */
  mynaviMemberNo?: string | null;
  /** 電話番号（生でも正規化済みでも可。内部で normalizePhoneNumber する） */
  phone?: string | null;
  /** 氏名（内部で空白を除去して照合） */
  name?: string | null;
  /** 生年月日（UTC暦日で照合。保存側が UTC 00:00 / 12:00 で揺れているため日単位で見る） */
  birthday?: Date | null;
  /** 自分自身を除外したいとき（既存レコードの編集など）に指定 */
  excludeCandidateId?: string | null;
};

/** 氏名の照合用正規化: 半角/全角スペース・タブを全て除去 */
function normalizeNameForMatch(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name.replace(/[\s　]+/g, "");
  return s || null;
}

/** 生年月日を UTC暦日の [開始, 翌日) に変換 */
function birthdayDayRange(birthday: Date): { from: Date; to: Date } {
  const from = new Date(
    Date.UTC(birthday.getUTCFullYear(), birthday.getUTCMonth(), birthday.getUTCDate()),
  );
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

/** raw クエリ結果 → DuplicateCandidateHit */
type RawRow = {
  id: string;
  candidate_number: string;
  name: string;
  support_status: string;
  application_date: Date | null;
  media_source: string | null;
  phone: string | null;
  mynavi_member_no: string | null;
  reapplication_count: number;
};

function toHit(row: RawRow, matchedBy: DuplicateMatchKey): DuplicateCandidateHit {
  return {
    id: row.id,
    candidateNumber: row.candidate_number,
    name: row.name,
    supportStatus: row.support_status,
    applicationDate: row.application_date,
    mediaSource: row.media_source,
    phone: row.phone,
    mynaviMemberNo: row.mynavi_member_no,
    reapplicationCount: Number(row.reapplication_count ?? 0),
    matchedBy,
  };
}

/**
 * 同一人物の既存求職者を探す（1人1レコード運用の要）。
 *
 * 判定は Candidate テーブルそのものを見る。処理ログ（MynaviRpaProcessingLog）は
 * 「求職者だけ作られてログが無い」中断ケースで抜けるため、主たる判定には使わない。
 *
 * キーは優先順に、いずれか1つでも一致すれば同一人物とみなす:
 *   1. mynaviMemberNo（完全一致・最も信頼できる）
 *   2. 電話番号（正規化後の完全一致）
 *   3. 氏名 ＋ 生年月日（両方一致。片方だけでは一致としない）
 *
 * - 期間では絞らない（1人1レコードなので、いつの登録でも同一人物なら重複）
 * - supportStatus = "ARCHIVED" は除外（過去に終了した人の再応募は新規として扱う）
 * - 媒体（mediaSource）は判定に使わない（マイナビ転職→マイナビエージェント等で二重になるため）
 *
 * 同一キーで複数ヒットした場合は created_at の古い方（＝元のレコード）を返す。
 *
 * @returns 既存求職者。無ければ null
 */
export async function findDuplicateCandidate(
  input: DuplicateCandidateInput,
): Promise<DuplicateCandidateHit | null> {
  const exclude = input.excludeCandidateId ?? null;

  // ---- 1. マイナビ会員No ----
  const memberNo = (input.mynaviMemberNo ?? "").trim();
  if (memberNo) {
    const hit = await prisma.candidate.findFirst({
      where: {
        mynaviMemberNo: memberNo,
        supportStatus: { not: "ARCHIVED" },
        ...(exclude ? { id: { not: exclude } } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        candidateNumber: true,
        name: true,
        supportStatus: true,
        applicationDate: true,
        mediaSource: true,
        phone: true,
        mynaviMemberNo: true,
        reapplicationCount: true,
      },
    });
    if (hit) return { ...hit, matchedBy: "mynaviMemberNo" };
  }

  // ---- 2. 電話番号（正規化後の完全一致）----
  // Candidate.phone は正規化済み（RPA経路）とハイフン付き手入力（手動経路）が混在するため、
  // DB側で全角数字→半角・数字以外除去をしてから比較する。
  // 国際表記（+81…）で保存された行も拾えるよう、81始まりの表記も候補に入れる。
  const phoneNormalized = normalizePhoneNumber(input.phone);
  if (phoneNormalized) {
    const intl = `81${phoneNormalized.slice(1)}`;
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT id, candidate_number, name, support_status, application_date,
             media_source, phone, mynavi_member_no, reapplication_count
      FROM candidates
      WHERE support_status <> 'ARCHIVED'
        AND phone IS NOT NULL
        AND regexp_replace(
              translate(phone, '０１２３４５６７８９', '0123456789'),
              '[^0-9]', '', 'g'
            ) IN (${phoneNormalized}, ${intl})
        AND (${exclude}::text IS NULL OR id <> ${exclude}::text)
      ORDER BY created_at ASC
      LIMIT 1
    `;
    if (rows.length > 0) return toHit(rows[0], "phone");
  }

  // ---- 3. 氏名 ＋ 生年月日（両方一致）----
  const nameKey = normalizeNameForMatch(input.name);
  if (nameKey && input.birthday) {
    const { from, to } = birthdayDayRange(input.birthday);
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT id, candidate_number, name, support_status, application_date,
             media_source, phone, mynavi_member_no, reapplication_count
      FROM candidates
      WHERE support_status <> 'ARCHIVED'
        AND birthday >= ${from} AND birthday < ${to}
        AND regexp_replace(name, '[[:space:]]|　', '', 'g') = ${nameKey}
        AND (${exclude}::text IS NULL OR id <> ${exclude}::text)
      ORDER BY created_at ASC
      LIMIT 1
    `;
    if (rows.length > 0) return toHit(rows[0], "nameBirthday");
  }

  return null;
}

/**
 * 重複を検知したときに既存レコードへ再応募の記録を残す。
 * applicationDate は上書きしない（集計が過去にずれるため）。
 */
export async function recordReapplication(candidateId: string): Promise<void> {
  await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      reapplicationCount: { increment: 1 },
      lastReapplicationAt: new Date(),
    },
  });
}

/**
 * 「処理した」側に数える処理ログ status。
 * NORMAL（新規登録して返信可）と RETRY_RECOVERED（リトライ救済して返信可）は同じ扱いにする。
 */
export const PROCESSED_LOG_STATUSES = ["NORMAL", "RETRY_RECOVERED"] as const;

/** リトライ救済の対象とみなす登録経過時間の上限（24時間） */
export const RETRY_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type RetryRecoveryDecision =
  | {
      recovered: true;
      /** 救済の根拠にした既存処理ログのID（サーバーログ用） */
      existingLogIds: string[];
      /** 既存 Candidate の配信枠紐付け（レスポンスの scoutLinkedSlotId に使う） */
      scoutDeliverySlotId: string | null;
    }
  | {
      recovered: false;
      /** 救済しなかった理由（切り分け用。レスポンスには載せない） */
      skipReason: string;
    };

/**
 * 「portal 登録成功・応答未達 → RPA がリトライ」を救済してよいかを判定する。
 *
 * 2026-09-16、portal は正常に登録を終えたのに RPA へは 502 で届かず、RPA が失敗扱いで
 * リトライした結果、1回目で作った本人と会員No が一致して DUPLICATE_SKIPPED になり
 * 一次返信の経路が塞がった（返信も返信メールも未送信のまま取り残し）。
 * この「自分自身との二重判定」だけを、以下を **すべて** 満たすときに限り解除する。
 *
 *   a. 一致キーがマイナビ会員Noの完全一致（電話・氏名+生年月日のヒットは対象外）
 *   b. 既存 Candidate の supportStatus が ARCHIVED でない
 *   c. 既存 Candidate の createdAt が直近24時間以内
 *   d. 既存 Candidate に NORMAL / RETRY_RECOVERED の処理ログが1件以上ある
 *      （＝RPA 経由で登録された求職者。処理ログの無い手動登録は対象外）
 *   e. 既存 Candidate の処理ログに replyResult = "SUCCESS" が1件も無い
 *   f. 既存 Candidate の mynaviFirstReplyMailSentAt が null
 *
 * 1つでも欠ければ従来どおり DUPLICATE_SKIPPED に落とす（挙動は変えない）。
 */
export async function evaluateRetryRecovery(
  hit: DuplicateCandidateHit,
  opts?: { now?: Date },
): Promise<RetryRecoveryDecision> {
  const now = opts?.now ?? new Date();

  // a. 会員No一致のみ救済する
  if (hit.matchedBy !== "mynaviMemberNo") {
    return {
      recovered: false,
      skipReason: `一致キーが${DUPLICATE_MATCH_LABELS[hit.matchedBy]}（会員No一致ではない）`,
    };
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: hit.id },
    select: {
      id: true,
      createdAt: true,
      supportStatus: true,
      mynaviFirstReplyMailSentAt: true,
      scoutDeliverySlotId: true,
    },
  });
  if (!candidate) {
    return { recovered: false, skipReason: "既存求職者を再取得できなかった" };
  }

  // b. 終了済みの人の再応募は新規扱い（救済しない）
  if (candidate.supportStatus === "ARCHIVED") {
    return { recovered: false, skipReason: "既存求職者が ARCHIVED" };
  }

  // c. 直近24時間以内の登録に限る（本当の再応募まで救済しないため）
  const elapsedMs = now.getTime() - candidate.createdAt.getTime();
  if (elapsedMs > RETRY_RECOVERY_WINDOW_MS) {
    return { recovered: false, skipReason: "既存求職者の登録から24時間を超えている" };
  }

  // f. 一次返信メールを送っていないこと
  if (candidate.mynaviFirstReplyMailSentAt) {
    return { recovered: false, skipReason: "一次返信メール送信済み" };
  }

  const logs = await prisma.mynaviRpaProcessingLog.findMany({
    where: { candidateId: candidate.id },
    select: { id: true, status: true, replyResult: true },
  });

  // e. 一次返信が成功していないこと（成功済みなら二重送信になる）
  if (logs.some((l) => l.replyResult === "SUCCESS")) {
    return { recovered: false, skipReason: "一次返信が送信済み（replyResult=SUCCESS）" };
  }

  // d. RPA 経由で登録された求職者であること
  const processedLogs = logs.filter((l) =>
    (PROCESSED_LOG_STATUSES as readonly string[]).includes(l.status),
  );
  if (processedLogs.length === 0) {
    return { recovered: false, skipReason: "RPA の処理ログ（NORMAL/RETRY_RECOVERED）が無い" };
  }

  return {
    recovered: true,
    existingLogIds: processedLogs.map((l) => l.id),
    scoutDeliverySlotId: candidate.scoutDeliverySlotId,
  };
}
