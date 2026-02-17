"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InviteForm() {
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteErr(null);
    setInviteResult(null);
    setInviteBusy(true);

    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, name: inviteName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteErr(data?.error ?? "招待発行に失敗しました");
        return;
      }
      const inviteUrl = data.inviteUrl as string;
      const full = inviteUrl.startsWith("http")
        ? inviteUrl
        : `${window.location.origin}${inviteUrl}`;
      setInviteResult(full);
      setInviteEmail("");
      setInviteName("");
      router.refresh();
    } catch {
      setInviteErr("通信に失敗しました");
    } finally {
      setInviteBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      alert("コピーしました");
    } catch {
      alert("コピーに失敗しました（手動でコピーしてください）");
    }
  }

  return (
    <>
      <form className="grid gap-4 md:grid-cols-3" onSubmit={createInvite}>
        <div className="md:col-span-1">
          <label className="text-[12px] text-[#374151]/80">名前</label>
          <input
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-[12px] text-[#374151]/80">メール</label>
          <input
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            type="email"
          />
        </div>

        <div className="md:col-span-3 flex items-center gap-3">
          <button
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
            type="submit"
            disabled={inviteBusy}
          >
            {inviteBusy ? "発行中..." : "招待URLを発行"}
          </button>
          {inviteErr && <div className="text-[14px] text-[#DC2626]">{inviteErr}</div>}
        </div>
      </form>

      {inviteResult && (
        <div className="mt-4 rounded-md border border-[#E5E7EB] bg-[#F5F7FA] p-3">
          <div className="text-[12px] text-[#374151]/80">招待URL（このURLを本人に送る）</div>
          <div className="mt-1 break-all font-mono text-[14px]">{inviteResult}</div>
          <button
            className="mt-3 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
            onClick={() => copy(inviteResult)}
          >
            コピー
          </button>
        </div>
      )}
    </>
  );
}
