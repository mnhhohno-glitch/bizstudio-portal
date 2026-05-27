"use client";

export type TaskSyncAction = "create" | "update" | "complete";

export type TaskSyncSlot = {
  slot: "first" | "second" | "final";
  label: string;
  detail: string;
};

type Props = {
  open: boolean;
  action: TaskSyncAction;
  slots: TaskSyncSlot[];
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const TITLE_MAP: Record<TaskSyncAction, string> = {
  create: "Google ToDoにタスクを追加しますか?",
  update: "Google ToDoのタスクを変更しますか?",
  complete: "Google ToDoのタスクを完了しますか?",
};

const BUTTON_MAP: Record<TaskSyncAction, string> = {
  create: "追加する",
  update: "変更する",
  complete: "完了する",
};

const LOADING_MAP: Record<TaskSyncAction, string> = {
  create: "追加中...",
  update: "変更中...",
  complete: "完了中...",
};

export default function TaskSyncConfirmDialog({
  open,
  action,
  slots,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-[440px]">
        <h3 className="text-base font-semibold mb-3">{TITLE_MAP[action]}</h3>
        <ul className="border border-gray-200 rounded-md divide-y divide-gray-100 mb-4 max-h-60 overflow-y-auto">
          {slots.map((s) => (
            <li key={s.slot} className="px-3 py-2 text-sm">
              <span className="font-medium">[{s.label}]</span>{" "}
              <span className="text-gray-700">{s.detail}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            しない
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {loading ? LOADING_MAP[action] : BUTTON_MAP[action]}
          </button>
        </div>
      </div>
    </div>
  );
}
