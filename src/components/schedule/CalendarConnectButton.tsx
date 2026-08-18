"use client";

import { useState } from "react";

interface CalendarConnectButtonProps {
  isConnected: boolean;
  /** T-167: 失敗を握りつぶさない。throw された例外はこのコンポーネントが表示する。 */
  onConnect: () => void | Promise<void>;
  onDisconnect: () => void;
}

export default function CalendarConnectButton({
  isConnected,
  onConnect,
  onDisconnect,
}: CalendarConnectButtonProps) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // T-167: 以前は onConnect 側で catch {} して握りつぶしていたため、
  //   認証URLが取れなくてもボタンが無反応になるだけで原因が分からなかった。
  const handleConnect = async () => {
    setError(null);
    setConnecting(true);
    try {
      await onConnect();
    } catch (e) {
      console.error("[CalendarConnect] 連携の開始に失敗しました:", e);
      setError("連携を開始できませんでした。時間をおいて再度お試しください。");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Googleカレンダーの連携を解除しますか？")) return;
    setError(null);
    setDisconnecting(true);
    try {
      const res = await fetch("/api/calendar/disconnect", { method: "DELETE" });
      if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
      onDisconnect();
    } catch (e) {
      console.error("[CalendarConnect] 連携の解除に失敗しました:", e);
      setError("連携を解除できませんでした。時間をおいて再度お試しください。");
    } finally {
      setDisconnecting(false);
    }
  };

  if (isConnected) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-green-600">✅ Googleカレンダー / ToDo 連携中</span>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="text-[#2563EB] hover:underline disabled:opacity-50"
            title="権限スコープが更新された場合に再認証します"
          >
            {connecting ? "再認証中..." : "再認証"}
          </button>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-gray-400 hover:text-red-500 disabled:opacity-50"
          >
            {disconnecting ? "解除中..." : "解除"}
          </button>
        </div>
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleConnect}
        disabled={connecting}
        className="inline-flex items-center gap-1.5 self-start border border-[#2563EB] text-[#2563EB] bg-white rounded-lg px-3 py-1.5 text-[13px] font-medium cursor-pointer hover:bg-blue-50 disabled:opacity-50 transition-colors"
      >
        🔗 {connecting ? "連携画面へ移動中..." : "Googleカレンダー / ToDo を連携"}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
