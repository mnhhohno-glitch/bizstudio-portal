"use client";

// T-183 Phase 2: 面談履歴（InterviewForm）右カラムの「面談サポート」タブ。
// Notta のマイノート一覧を参考に、この求職者に紐づく全サポートセッションの
// 一覧・閲覧（行クリックで展開）・削除・新規作成をここで完結させる。
// InterviewForm 本体にはタブ登録と条件分岐レンダリングのみ追加し、中身はこのコンポーネントに閉じる。

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type SessionRow = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  /** transcript 最終行の時刻。endedAt null（記録中/中断）の長さ概算に使う。 */
  lastTranscriptAt: string | null;
  interviewId: string;
  interviewCount: number | null;
  interviewDate: string | null;
  createdByName: string;
};

type TranscriptItem = { t: string; text: string };
// mode: recent/selection = 手動解説（Phase 1）/ auto-term/auto-job/auto-reason = 自動検知3種（Phase 3）
type ExplanationMode = "recent" | "selection" | "auto-term" | "auto-job" | "auto-reason";
// Phase 5: auto-job/auto-reason は questions（確認ポイント）を持ちうる（Phase 4 以前の保存データには
// 無いので optional）。Phase 5 の一時期に保存された source フィールドは Phase 6 で廃止（読み飛ばすだけ）。
type ExplanationItem = {
  t: string;
  mode: ExplanationMode;
  sourceText: string;
  resultText: string;
  questions?: string[];
};

const EXPLANATION_LABEL: Record<ExplanationMode, string> = {
  recent: "直近30秒",
  selection: "選択部分",
  "auto-term": "自動・用語",
  "auto-job": "業務内容",
  "auto-reason": "転職理由",
};

type SessionDetail = {
  id: string;
  transcript: TranscriptItem[];
  explanations: ExplanationItem[];
};

/** 一覧行のタイトル。面談回次があれば「N回目面談サポート」、なければ面談日から生成する。 */
function sessionTitle(s: SessionRow): string {
  if (s.interviewCount) return `${s.interviewCount}回目面談サポート`;
  return "面談サポート";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
}

function formatDurationMs(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (totalMin === 0) return "1分未満";
  return `${m}分`;
}

/** 長さ表示。endedAt が無い場合は transcript 最終時刻から概算し「記録中/中断」を添える。 */
function durationLabel(s: SessionRow): string {
  const start = new Date(s.startedAt).getTime();
  if (s.endedAt) return formatDurationMs(new Date(s.endedAt).getTime() - start);
  if (s.lastTranscriptAt) {
    return `${formatDurationMs(new Date(s.lastTranscriptAt).getTime() - start)}（記録中/中断）`;
  }
  return "記録中/中断";
}

export default function InterviewSupportLogTab({
  candidateId,
  interviewId,
}: {
  candidateId: string;
  interviewId: string;
}) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, SessionDetail | "loading" | "error">>({});

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/interview-support/sessions?candidateId=${encodeURIComponent(candidateId)}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
      setLoadError(null);
    } catch {
      setLoadError("サポート記録の取得に失敗しました");
    }
  }, [candidateId]);

  useEffect(() => {
    setSessions(null);
    void loadList();
  }, [loadList]);

  const toggleExpand = useCallback(
    async (sessionId: string) => {
      if (expandedId === sessionId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(sessionId);
      if (details[sessionId] && details[sessionId] !== "error") return;
      setDetails((prev) => ({ ...prev, [sessionId]: "loading" }));
      try {
        const res = await fetch(`/api/interview-support/sessions/${sessionId}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        setDetails((prev) => ({
          ...prev,
          [sessionId]: {
            id: sessionId,
            transcript: Array.isArray(data.session?.transcript) ? data.session.transcript : [],
            explanations: Array.isArray(data.session?.explanations) ? data.session.explanations : [],
          },
        }));
      } catch {
        setDetails((prev) => ({ ...prev, [sessionId]: "error" }));
      }
    },
    [expandedId, details]
  );

  const handleDelete = useCallback(async (sessionId: string) => {
    if (!window.confirm("このサポート記録を削除しますか？")) return;
    try {
      const res = await fetch(`/api/interview-support/sessions/${sessionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== sessionId) : prev));
      setExpandedId((prev) => (prev === sessionId ? null : prev));
      toast.success("サポート記録を削除しました");
    } catch {
      toast.error("削除に失敗しました");
    }
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      {/* 新規作成: ヘッダーの「面談サポート」ボタンと同じ遷移（別タブで支援画面を開く） */}
      <button
        type="button"
        onClick={() => window.open(`/interview-support/${interviewId}`, "_blank")}
        disabled={!interviewId}
        className="cursor-pointer"
        style={{
          padding: "8px 12px", fontSize: 12, borderRadius: 6, fontFamily: "inherit",
          border: "0.5px dashed var(--im-bdr2)", background: "transparent",
          color: interviewId ? "var(--im-fg2)" : "var(--im-fg3)",
          opacity: interviewId ? 1 : 0.5, cursor: interviewId ? "pointer" : "not-allowed",
        }}
      >＋ 新規面談サポート</button>

      {loadError && <p style={{ fontSize: 12, color: "#dc2626" }}>{loadError}</p>}
      {!loadError && sessions === null && (
        <p style={{ fontSize: 12, color: "var(--im-fg3)" }}>読み込み中...</p>
      )}
      {sessions !== null && sessions.length === 0 && !loadError && (
        <p style={{ fontSize: 12, color: "var(--im-fg3)", textAlign: "center", padding: "16px 0" }}>
          面談サポートの記録はありません
        </p>
      )}

      {sessions?.map((s) => {
        const detail = details[s.id];
        const expanded = expandedId === s.id;
        return (
          <div key={s.id} style={{ border: "0.5px solid var(--im-bdr)", borderRadius: 6, background: "var(--im-bg)" }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => void toggleExpand(s.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void toggleExpand(s.id); }}
              className="cursor-pointer"
              style={{ padding: "8px 10px" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--im-fg)" }}>{sessionTitle(s)}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleDelete(s.id); }}
                  className="cursor-pointer shrink-0"
                  title="このサポート記録を削除"
                  style={{
                    padding: "2px 8px", fontSize: 11, borderRadius: 4, fontFamily: "inherit",
                    border: "0.5px solid var(--im-bdr)", background: "transparent", color: "#dc2626",
                  }}
                >削除</button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5" style={{ marginTop: 3, fontSize: 11, color: "var(--im-fg2)" }}>
                <span>{formatDateTime(s.startedAt)}</span>
                <span>{durationLabel(s)}</span>
                <span>{s.createdByName}</span>
              </div>
            </div>

            {expanded && (
              <div style={{ borderTop: "0.5px solid var(--im-bdr)", padding: "8px 10px", maxHeight: 360, overflowY: "auto" }}>
                {detail === "loading" && <p style={{ fontSize: 12, color: "var(--im-fg3)" }}>読み込み中...</p>}
                {detail === "error" && <p style={{ fontSize: 12, color: "#dc2626" }}>内容の取得に失敗しました</p>}
                {detail && detail !== "loading" && detail !== "error" && (
                  <SessionTimeline detail={detail} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 文字起こしログと解説履歴を時系列にマージして表示する（読み取り専用）。解説はログと区別できる見た目にする。
 * Phase 3: 更新型カード（業務内容・転職理由。保存されるのは最新版のみ）はサマリーとして先頭にまとめ、
 * 用語・手動解説は従来どおり時系列に混ぜる。 */
function SessionTimeline({ detail }: { detail: SessionDetail }) {
  const pinned = detail.explanations.filter((e) => e.mode === "auto-job" || e.mode === "auto-reason");
  const timelineExplanations = detail.explanations.filter(
    (e) => e.mode !== "auto-job" && e.mode !== "auto-reason"
  );
  const items: Array<
    | { kind: "log"; t: string; item: TranscriptItem }
    | { kind: "explain"; t: string; item: ExplanationItem }
  > = [
    ...detail.transcript.map((item) => ({ kind: "log" as const, t: item.t, item })),
    ...timelineExplanations.map((item) => ({ kind: "explain" as const, t: item.t, item })),
  ].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  if (items.length === 0 && pinned.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--im-fg3)" }}>記録がありません</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {pinned.map((item, idx) => (
        <div
          key={`pinned-${idx}`}
          style={{
            border: "0.5px solid #c7d2fe", background: "#eef2ff", borderRadius: 6,
            padding: "6px 8px", fontSize: 12,
          }}
        >
          <div className="flex items-center gap-2" style={{ marginBottom: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 500, color: "#4338ca", background: "#e0e7ff", borderRadius: 3, padding: "1px 5px" }}>
              {EXPLANATION_LABEL[item.mode] ?? item.mode}
            </span>
            {item.mode === "auto-job" && (
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--im-fg)" }}>{item.sourceText}</span>
            )}
            <span className="font-mono" style={{ fontSize: 10.5, color: "var(--im-fg3)" }}>{formatTime(item.t)}</span>
          </div>
          <div style={{ color: "var(--im-fg)", whiteSpace: "pre-wrap" }}>{item.resultText}</div>
          {/* Phase 5: 確認ポイント（深掘り質問）。保存時点の最新版を閲覧でも見られるようにする。 */}
          {Array.isArray(item.questions) && item.questions.length > 0 && (
            <div style={{ marginTop: 4, borderTop: "0.5px solid #c7d2fe", paddingTop: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 500, color: "var(--im-fg3)", marginBottom: 2 }}>確認ポイント</div>
              {item.questions.map((q, qi) => (
                <div key={qi} style={{ fontSize: 11.5, color: "var(--im-fg2)" }}>・{q}</div>
              ))}
            </div>
          )}
        </div>
      ))}
      {items.map((entry, idx) =>
        entry.kind === "log" ? (
          <div key={idx} className="flex gap-2" style={{ fontSize: 12 }}>
            <span className="shrink-0 font-mono" style={{ fontSize: 10.5, color: "var(--im-fg3)", paddingTop: 1.5 }}>
              {formatTime(entry.t)}
            </span>
            <span style={{ color: "var(--im-fg)", whiteSpace: "pre-wrap" }}>{entry.item.text}</span>
          </div>
        ) : (
          <div
            key={idx}
            style={{
              border: "0.5px solid #fcd34d", background: "#fffbeb", borderRadius: 6,
              padding: "6px 8px", fontSize: 12,
            }}
          >
            <div className="flex items-center gap-2" style={{ marginBottom: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: "#b45309", background: "#fef3c7", borderRadius: 3, padding: "1px 5px" }}>
                AI解説（{EXPLANATION_LABEL[entry.item.mode] ?? entry.item.mode}）
              </span>
              <span className="font-mono" style={{ fontSize: 10.5, color: "var(--im-fg3)" }}>{formatTime(entry.t)}</span>
            </div>
            <div className="truncate" title={entry.item.sourceText} style={{ fontSize: 10.5, color: "var(--im-fg3)", marginBottom: 3 }}>
              「{entry.item.sourceText}」
            </div>
            <div style={{ color: "var(--im-fg)", whiteSpace: "pre-wrap" }}>{entry.item.resultText}</div>
          </div>
        )
      )}
    </div>
  );
}
