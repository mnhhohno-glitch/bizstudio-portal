"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { formatRecruiterName } from "@/lib/recruiterDisplay";

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
  const [input, setInput] = useState("");
  const [linkedSlot, setLinkedSlot] = useState<Slot | null>(null);
  const [suggestions, setSuggestions] = useState<Slot[]>([]);
  const [linking, setLinking] = useState(false);
  const [showRelink, setShowRelink] = useState(false);

  // 紐付け済みスロット詳細取得
  const loadLinkedSlot = useCallback(async () => {
    if (!scoutDeliverySlotId || !currentScoutNumber || !VALID.test(currentScoutNumber)) {
      setLinkedSlot(null);
      return;
    }
    try {
      // 直近60日の候補日から探索
      const today = new Date();
      for (let i = 0; i < 60; i++) {
        const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = d.toISOString().slice(0, 10);
        const res = await fetch(`/api/scout/slots?date=${dateStr}`);
        if (!res.ok) continue;
        const data = await res.json();
        const match = (data.slots || []).find(
          (s: Slot) => s.scoutNumber === currentScoutNumber,
        );
        if (match) {
          setLinkedSlot(match);
          return;
        }
      }
    } catch {
      // silent
    }
  }, [currentScoutNumber, scoutDeliverySlotId]);

  // 担当者ベースの候補補完: 直近3日の同 recruiterName 配信枠
  const loadSuggestions = useCallback(async () => {
    if (!recruiterName) return;
    try {
      const today = new Date();
      const all: Slot[] = [];
      for (let i = 0; i < 3; i++) {
        const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = d.toISOString().slice(0, 10);
        const res = await fetch(`/api/scout/slots?date=${dateStr}`);
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
        setShowRelink(false);
        setInput("");
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

  const isLinked = !!scoutDeliverySlotId;

  return (
    <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#374151]">
          スカウト配信枠との紐付け
        </h3>
        {isLinked && scoutLinkedAt && (
          <span className="text-[12px] text-[#16A34A]">
            紐付け済 ({new Date(scoutLinkedAt).toLocaleDateString("ja-JP")})
          </span>
        )}
      </div>

      {/* 自動紐付け失敗の警告 */}
      {!isLinked && (
        <div className="mb-3 rounded-md border border-[#F59E0B] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#92400E]">
          自動紐付けに失敗しています。下のフォームから手動で紐付けてください。
        </div>
      )}

      {/* 紐付け済み表示 */}
      {isLinked && (
        <div className="rounded-md bg-[#EEF2FF] p-3 text-[12px] text-[#374151]">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[13px]">{currentScoutNumber}</span>
            <div className="flex gap-1">
              <button
                onClick={() => setShowRelink((v) => !v)}
                className="rounded border border-[#E5E7EB] bg-white px-2 py-0.5 text-[11px] text-[#6B7280] hover:bg-[#F9FAFB]"
              >
                {showRelink ? "閉じる" : "再紐付け"}
              </button>
              <button
                onClick={handleUnlink}
                className="rounded border border-[#E5E7EB] bg-white px-2 py-0.5 text-[11px] text-[#6B7280] hover:bg-[#F9FAFB]"
              >
                解除
              </button>
            </div>
          </div>
          {linkedSlot ? (
            <>
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
            </>
          ) : (
            <div className="text-[#9CA3AF]">枠詳細を読み込み中...</div>
          )}
        </div>
      )}

      {/* 紐付け入力（未紐付け or 再紐付けモード） */}
      {(!isLinked || showRelink) && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] text-[#6B7280]">
            {isLinked ? "別のスカウトNOに変更する場合:" : "スカウトNOを入力して紐付け:"}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onFocus={() => {
                if (recruiterName) loadSuggestions();
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
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-2">
              <p className="text-[11px] text-[#6B7280] mb-1">
                候補（担当: {formatRecruiterName(recruiterName)}・直近3日の配信あり枠）:
              </p>
              <div className="flex flex-wrap gap-1">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setInput(s.scoutNumber)}
                    className="rounded border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-mono hover:bg-[#EEF2FF]"
                  >
                    {s.scoutNumber} ({s.deliveryDate.slice(5, 10)} {s.hourSlot}時)
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
