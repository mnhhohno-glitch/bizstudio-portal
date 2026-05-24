"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

type Slot = {
  id: string;
  scoutNumber: string;
  deliveryDate: string;
  hourSlot: number;
  searchConditionName: string | null;
  mediaSource: string;
  machine: { recruiterName: string; machineLabel: string } | null;
};

type Props = {
  candidateId: string;
  applicationRoute: string | null;
  currentScoutNumber: string | null;
  recruiterName: string | null;
  scoutLinkedAt: string | null;
  scoutDeliverySlotId: string | null;
  onLinked?: () => void;
};

const VALID = /^SC\d{8}$/;

export default function ScoutLinkPanel({
  candidateId,
  applicationRoute,
  currentScoutNumber,
  recruiterName,
  scoutLinkedAt,
  scoutDeliverySlotId,
  onLinked,
}: Props) {
  const [input, setInput] = useState(currentScoutNumber || "");
  const [linkedSlot, setLinkedSlot] = useState<Slot | null>(null);
  const [suggestions, setSuggestions] = useState<Slot[]>([]);
  const [linking, setLinking] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // 紐付け済みスロット情報取得
  const loadLinkedSlot = useCallback(async () => {
    if (!currentScoutNumber || !VALID.test(currentScoutNumber)) {
      setLinkedSlot(null);
      return;
    }
    try {
      const today = new Date();
      const from = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const res = await fetch(`/api/scout/slots?date=${currentScoutNumber}`);
      if (res.ok) {
        // Best-effort: 単発検索エンドポイントは未実装。link API のレスポンスで取得済の場合のみセット
        void from;
      }
    } catch {
      // silent
    }
  }, [currentScoutNumber]);

  // 担当者ベースの候補補完: 過去60日の同 recruiterName 配信枠
  const loadSuggestions = useCallback(async () => {
    if (!recruiterName) return;
    try {
      // 簡易実装: 当日から過去14日の同担当者枠を取得
      const today = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        dates.push(d.toISOString().slice(0, 10));
      }
      const all: Slot[] = [];
      for (const date of dates.slice(0, 3)) {
        const res = await fetch(`/api/scout/slots?date=${date}`);
        if (res.ok) {
          const data = await res.json();
          for (const s of data.slots || []) {
            if (s.machine?.recruiterName === recruiterName && s.deliveryCount > 0) {
              all.push(s);
            }
          }
        }
      }
      setSuggestions(all.slice(0, 10));
    } catch {
      // silent
    }
  }, [recruiterName]);

  useEffect(() => {
    loadLinkedSlot();
  }, [loadLinkedSlot]);

  const handleLink = async () => {
    const trimmed = input.trim();
    if (!VALID.test(trimmed)) {
      toast.error("スカウト番号は SC + 8桁数字の形式で入力してください");
      return;
    }
    setLinking(true);
    try {
      const res = await fetch("/api/scout/candidates/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, scoutNumber: trimmed }),
      });
      if (res.ok) {
        const data = await res.json();
        setLinkedSlot(data.slot);
        toast.success("スカウト配信枠と紐付けました");
        onLinked?.();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "紐付けに失敗しました");
      }
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm("スカウト紐付けを解除しますか？")) return;
    const res = await fetch(`/api/scout/candidates/link?candidateId=${candidateId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setLinkedSlot(null);
      setInput("");
      toast.success("紐付けを解除しました");
      onLinked?.();
    } else {
      toast.error("解除に失敗しました");
    }
  };

  if (applicationRoute !== "スカウト") return null;

  return (
    <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#374151]">
          スカウト配信枠との紐付け
        </h3>
        {scoutLinkedAt && (
          <span className="text-[12px] text-[#16A34A]">
            紐付け済 ({new Date(scoutLinkedAt).toLocaleDateString("ja-JP")})
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onFocus={() => {
            if (recruiterName) {
              loadSuggestions();
              setShowSuggestions(true);
            }
          }}
          placeholder="SC12345678"
          className="flex-1 rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] font-mono"
        />
        <button
          onClick={handleLink}
          disabled={linking}
          className="rounded-md bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {linking ? "紐付け中..." : "紐付け"}
        </button>
        {scoutDeliverySlotId && (
          <button
            onClick={handleUnlink}
            className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#6B7280] hover:bg-[#F9FAFB]"
          >
            解除
          </button>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="mt-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-2">
          <p className="text-[11px] text-[#6B7280] mb-1">
            候補（担当: {recruiterName}・直近3日の配信あり枠）:
          </p>
          <div className="flex flex-wrap gap-1">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setInput(s.scoutNumber);
                  setShowSuggestions(false);
                }}
                className="rounded border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-mono hover:bg-[#EEF2FF]"
              >
                {s.scoutNumber} ({s.deliveryDate.slice(5, 10)} {s.hourSlot}時)
              </button>
            ))}
          </div>
        </div>
      )}

      {linkedSlot && (
        <div className="mt-3 rounded-md bg-[#EEF2FF] p-3 text-[12px] text-[#374151]">
          <div>
            <span className="text-[#6B7280]">配信日:</span> {linkedSlot.deliveryDate.slice(0, 10)}{" "}
            <span className="text-[#6B7280] ml-2">時間:</span> {linkedSlot.hourSlot}:00
          </div>
          <div>
            <span className="text-[#6B7280]">担当:</span>{" "}
            {linkedSlot.machine?.recruiterName} ({linkedSlot.machine?.machineLabel})
          </div>
          {linkedSlot.searchConditionName && (
            <div>
              <span className="text-[#6B7280]">検索条件:</span> {linkedSlot.searchConditionName}
            </div>
          )}
          <div>
            <span className="text-[#6B7280]">媒体:</span> {linkedSlot.mediaSource}
          </div>
        </div>
      )}

      {!scoutDeliverySlotId && (
        <p className="mt-2 text-[11px] text-[#9CA3AF]">
          応募者画面でスカウト番号を入力して「紐付け」をクリックすると、配信枠との紐付けが記録されます。
        </p>
      )}
    </div>
  );
}
