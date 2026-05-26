"use client";

export type SyncSlot = {
  slot: "first" | "second" | "final";
  label: string;
  datetime: string;
};

type Props = {
  open: boolean;
  slots: SyncSlot[];
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function CalendarSyncConfirmDialog({
  open,
  slots,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-[440px]">
        <h3 className="text-base font-semibold mb-3">
          Googleカレンダーに同期しますか？
        </h3>
        <p className="text-sm text-gray-600 mb-3">
          以下の面接日時をログイン中のユーザーのGoogleカレンダーに同期します。
        </p>
        <ul className="border border-gray-200 rounded-md divide-y divide-gray-100 mb-4 max-h-60 overflow-y-auto">
          {slots.map((s) => (
            <li key={s.slot} className="px-3 py-2 text-sm">
              <span className="font-medium">[{s.label}]</span>{" "}
              <span className="text-gray-700">{s.datetime}</span>
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
            {loading ? "同期中..." : "同期する"}
          </button>
        </div>
      </div>
    </div>
  );
}
