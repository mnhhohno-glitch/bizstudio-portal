"use client";

// T-151 Phase 2-2: AI が検出したタスク候補の確認カード。
//
// 元は AdvisorFloatingPanel.tsx にインラインで書かれていたものを、面談ログ経路（T-151）と
// 共有するために切り出した。★見た目・クラス名・挙動は移設前と一切変えていない（純粋移動）。
//
// 期日は必ず年込みで表示する（AI の年ズレを CA が見つける最後の防壁）。

export type SuggestedTaskKind = "JOB_SEARCH_SEND" | "FORM_SURVEY";

/** AI 応答／面談ログから検出したタスク候補。dueDate はサーバーが JST で確定済みの "YYYY-MM-DD"。 */
export type SuggestedTask = {
  kind: SuggestedTaskKind;
  due: string;
  dueDate: string;
};

export const SUGGESTED_TASK_LABEL: Record<SuggestedTaskKind, string> = {
  JOB_SEARCH_SEND: "求人検索・送付",
  FORM_SURVEY: "アンケート送付・回答確認",
};

/**
 * "YYYY-MM-DD" を「2026年8月7日(金)」形式にする。
 * ★年を必ず含めること。AIが年を間違えた場合にCAが気づける最後の防壁のため、省略表記にしない。
 * 曜日は Date.UTC 固定で算出（ブラウザTZに依存させない）。
 */
export function formatDueDateWithYear(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const [, y, mo, d] = m;
  const dow = ["日", "月", "火", "水", "木", "金", "土"][
    new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()
  ];
  return `${Number(y)}年${Number(mo)}月${Number(d)}日(${dow})`;
}

/** 候補の一意キー（親側の busy / error / 期日編集値の管理に使う）。 */
export function suggestedTaskKey(ownerId: string, kind: string): string {
  return `${ownerId}:${kind}`;
}

/** 候補1件ごとの処理済み状態。親が候補キー単位で持つ。 */
export type SuggestedTaskDone = "created" | "dismissed";

type Props = {
  /** 候補の持ち主（advisor なら messageId、面談なら interviewId）。 */
  ownerId: string;
  tasks: SuggestedTask[];
  candidateName: string;
  busy: Record<string, boolean>;
  error: Record<string, string>;
  dueEdits: Record<string, string>;
  /**
   * 処理済みの候補（候補キー → 作成済み / 不要）。
   * 複数候補があるとき、1件処理しても残りは操作できる必要があるため、
   * カード全体ではなく候補ごとに畳む（全件処理済みで閉じるのは親の責務）。
   */
  done: Record<string, SuggestedTaskDone>;
  onDueChange: (key: string, value: string) => void;
  onCreate: (task: SuggestedTask) => void;
  onDismiss: (task: SuggestedTask) => void;
};

export default function SuggestedTaskCard({
  ownerId,
  tasks,
  candidateName,
  busy,
  error,
  dueEdits,
  done,
  onDueChange,
  onCreate,
  onDismiss,
}: Props) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {tasks.map((task) => {
        const key = suggestedTaskKey(ownerId, task.kind);
        const isBusy = !!busy[key];
        const err = error[key];
        const due = dueEdits[key] ?? task.dueDate;
        const doneState = done[key];

        // 処理済みの候補は結果だけを残す（残りの候補は操作できるまま）。
        if (doneState) {
          return (
            <div
              key={key}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-500"
            >
              <span className="font-medium">
                {doneState === "created" ? "✓ 作成済み" : "— 今回は不要"}
              </span>
              <span className="ml-2">タスク候補: {SUGGESTED_TASK_LABEL[task.kind]}</span>
              {doneState === "created" && (
                <span className="ml-2">期日 {formatDueDateWithYear(due)}</span>
              )}
            </div>
          );
        }

        return (
          <div
            key={key}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px]"
          >
            <div className="flex items-center gap-1.5 font-semibold text-amber-900">
              <span>📌</span>
              <span>タスク候補: {SUGGESTED_TASK_LABEL[task.kind]}</span>
            </div>
            <div className="mt-1 text-gray-700">対象: {candidateName} さん</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-gray-700">期日</span>
              <span className="font-semibold text-gray-900">{formatDueDateWithYear(due)}</span>
              <input
                type="date"
                value={due}
                disabled={isBusy}
                onChange={(e) => onDueChange(key, e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-[12px] focus:border-[#2563EB] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => onCreate(task)}
                disabled={isBusy}
                className="rounded-md bg-[#2563EB] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy ? "処理中..." : "タスクを作成"}
              </button>
              <button
                onClick={() => onDismiss(task)}
                disabled={isBusy}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                今回は不要
              </button>
            </div>
            {err && <div className="mt-1.5 text-[12px] text-red-600">{err}</div>}
          </div>
        );
      })}
    </div>
  );
}
