"use client";

// T-208 step4: 面談記録の新規作成（「+ 新規面談」）を、面談履歴タブと面談スクリプトタブで同じ処理にする。
// - ログイン中の CA の社員（Employee.id）は /api/employees の userId で引く（useCurrentEmployeeId）
// - 作成は POST /api/interviews（日付は toLocaleDateString("sv-SE")＝JST の YYYY-MM-DD。toISOString() は使わない）

import { useEffect, useState } from "react";

export type SessionUserLike = { id: string; name: string; email: string; role: string } | null;

/** ログイン中の CA の Employee.id（無ければ null。取得中は undefined） */
export function useCurrentEmployeeId(currentUser: SessionUserLike): string | null | undefined {
  const [employeeId, setEmployeeId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    fetch("/api/employees")
      .then((r) => r.json())
      .then((data: { id: string; userId: string | null }[]) => {
        if (cancelled) return;
        const match = Array.isArray(data) ? data.find((e) => e.userId === currentUser.id) : undefined;
        setEmployeeId(match ? match.id : null);
      })
      .catch(() => {
        if (!cancelled) setEmployeeId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);
  // 未ログインなら null（effect の中で setState しない）
  return currentUser ? employeeId : null;
}

export class InterviewCreateError extends Error {}

/**
 * 面談記録を1件作る。作成した記録の id を返す。
 * @param existingCount その求職者の面談記録の件数（0 なら「初回面談」、それ以外は「フォロー面談」）
 */
export async function createInterviewRecord(input: {
  candidateId: string;
  currentUser: SessionUserLike;
  currentEmployeeId: string | null | undefined;
  existingCount: number;
}): Promise<string> {
  if (!input.currentUser) throw new InterviewCreateError("ログインセッションが取得できません。再ログインしてください。");
  if (!input.currentEmployeeId) throw new InterviewCreateError("社員情報がアカウントに紐づいていません。管理者にお問い合わせください。");
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const res = await fetch("/api/interviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidateId: input.candidateId,
      interviewDate: now.toLocaleDateString("sv-SE"),
      startTime: timeStr,
      endTime: timeStr,
      interviewTool: "電話",
      interviewerUserId: input.currentEmployeeId,
      interviewType: input.existingCount === 0 ? "初回面談" : "フォロー面談",
      status: "draft",
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new InterviewCreateError(err.error || "作成に失敗しました");
  }
  const data = (await res.json()) as { record: { id: string } };
  return data.record.id;
}

/** 面談一覧（/api/candidates/[id]/interviews）の1件。両タブで同じ形を使う */
export type InterviewListRecord = {
  id: string;
  interviewDate: string;
  interviewCount: number;
  status: string;
  isLatest: boolean;
  lastSavedAt: string | null;
  startTime: string | null;
  endTime: string | null;
  interviewTool: string | null;
  interviewType: string | null;
  interviewer: { name: string } | null;
  rating: { overallRank: string | null; grandTotal: number | null } | null;
  _count: { memos: number; attachments: number };
};

/** 面談一覧を日付→id 順に並べて返す（既定で選ぶのは isLatest、無ければ最後） */
export async function fetchInterviewList(candidateId: string): Promise<InterviewListRecord[]> {
  const res = await fetch(`/api/candidates/${candidateId}/interviews`);
  if (!res.ok) throw new Error("面談一覧の取得に失敗しました");
  const data = (await res.json()) as { records?: InterviewListRecord[] };
  const records = data.records || [];
  records.sort((a, b) => new Date(a.interviewDate).getTime() - new Date(b.interviewDate).getTime() || a.id.localeCompare(b.id));
  return records;
}

export function defaultSelectedInterview(records: InterviewListRecord[]): InterviewListRecord | undefined {
  if (records.length === 0) return undefined;
  return records.find((r) => r.isLatest) || records[records.length - 1];
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
