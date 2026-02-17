"use client";

import { useRouter } from "next/navigation";

type Props = {
  userId: string;
  email: string;
  currentStatus: "active" | "disabled";
};

export default function UserStatusButton({ userId, email, currentStatus }: Props) {
  const router = useRouter();

  async function toggleStatus() {
    const nextStatus = currentStatus === "active" ? "disabled" : "active";
    const ok = window.confirm(
      `${email} を ${nextStatus === "disabled" ? "無効化" : "有効化"} しますか？`
    );
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error ?? "更新に失敗しました");
        return;
      }
      router.refresh();
    } catch {
      alert("通信に失敗しました");
    }
  }

  return (
    <button
      className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#F5F7FA]"
      onClick={toggleStatus}
    >
      {currentStatus === "active" ? "無効化" : "有効化"}
    </button>
  );
}
