"use client";

// T-185: セキュアファイル送信のテンプレート管理画面（タブ2枚: 宛先 / 文面）。
// - 全社共有: 一覧・使用・編集は誰でも可。アーカイブ（論理削除）は作成者本人と admin のみ（canArchive）。
// - 最終使用日が90日以上前 or 未使用の行はグレー表示＋「長期間未使用」注記
//   （担当者の異動・退職で死んだアドレスに気づけるようにする・確定仕様）。
// - アーカイブ済みは既定で非表示。「アーカイブを表示」チェックで表示。
// - 複製は「編集フォームを既存内容で開いて新規作成する」方式（API側に複製専用エンドポイントは作らない）。

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { isTemplateStale } from "@/lib/secure-transfer-templates";

type ContactRow = {
  id?: string;
  name: string;
  email: string;
  defaultField: "TO" | "CC" | "NONE";
};

type RecipientTemplate = {
  id: string;
  name: string;
  companyName: string | null;
  memo: string | null;
  createdByName: string;
  lastUsedAt: string | null;
  isArchived: boolean;
  canArchive: boolean;
  contacts: { id: string; name: string | null; email: string; defaultField: string }[];
};

type MessageTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  signature: string | null;
  createdByName: string;
  lastUsedAt: string | null;
  isArchived: boolean;
  canArchive: boolean;
};

function formatJstDate(dt: string | null): string {
  if (!dt) return "未使用";
  return new Date(dt).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 「長期間未使用」の注記付き最終使用日セル。 */
function LastUsedCell({ lastUsedAt }: { lastUsedAt: string | null }) {
  const stale = isTemplateStale(lastUsedAt);
  return (
    <span>
      {formatJstDate(lastUsedAt)}
      {stale && (
        <span className="ml-1.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
          長期間未使用
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 宛先テンプレートの編集フォーム（新規・編集・複製の3用途で共用）
// ---------------------------------------------------------------------------
function RecipientEditor({
  initial,
  editingId,
  onClose,
  onSaved,
}: {
  initial: { name: string; companyName: string; memo: string; contacts: ContactRow[] };
  editingId: string | null; // null = 新規作成（複製含む）
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [memo, setMemo] = useState(initial.memo);
  const [contacts, setContacts] = useState<ContactRow[]>(
    initial.contacts.length > 0 ? initial.contacts : [{ name: "", email: "", defaultField: "TO" }]
  );
  const [saving, setSaving] = useState(false);

  const updateContact = (i: number, patch: Partial<ContactRow>) => {
    setContacts((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const moveContact = (i: number, dir: -1 | 1) => {
    setContacts((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        name,
        companyName,
        memo,
        contacts: contacts
          .filter((c) => c.email.trim())
          .map((c) => ({ name: c.name, email: c.email, defaultField: c.defaultField })),
      };
      const res = await fetch(
        editingId ? `/api/transfers/templates/recipients/${editingId}` : "/api/transfers/templates/recipients",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      toast.success(editingId ? "更新しました" : "作成しました");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-blue-100 bg-white p-6 shadow-sm space-y-4">
      <p className="text-sm font-semibold text-gray-700">
        {editingId ? "宛先テンプレートを編集" : "宛先テンプレートを作成"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            表示名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: スライヴネット｜候補者ご紹介"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            企業名（{"{{企業名}}"} の差し込み値になります）
          </label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="例: 株式会社スライヴネット"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">メモ（任意）</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
        />
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-600">
          担当者 <span className="text-red-500">*</span>
          <span className="ml-2 font-normal text-gray-400">
            先頭のTO担当者の名前が {"{{担当者名}}"} の差し込み値になります
          </span>
        </p>
        <div className="space-y-2">
          {contacts.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <input
                type="text"
                value={c.name}
                onChange={(e) => updateContact(i, { name: e.target.value })}
                placeholder="担当者名（任意）"
                className="w-36 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none"
              />
              <input
                type="text"
                value={c.email}
                onChange={(e) => updateContact(i, { email: e.target.value })}
                placeholder="email@example.co.jp"
                className="min-w-[200px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none"
              />
              <div className="flex items-center gap-2 text-xs text-gray-600">
                {(["TO", "CC", "NONE"] as const).map((f) => (
                  <label key={f} className="flex cursor-pointer items-center gap-1">
                    <input
                      type="radio"
                      name={`contact-field-${i}`}
                      checked={c.defaultField === f}
                      onChange={() => updateContact(i, { defaultField: f })}
                    />
                    {f === "NONE" ? "入れない" : f}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => moveContact(i, -1)}
                  disabled={i === 0}
                  className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                  title="上へ"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveContact(i, 1)}
                  disabled={i === contacts.length - 1}
                  className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                  title="下へ"
                >
                  ↓
                </button>
                <button
                  onClick={() => setContacts((prev) => prev.filter((_, idx) => idx !== i))}
                  className="ml-1 text-xs text-gray-400 hover:text-red-500"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setContacts((prev) => [...prev, { name: "", email: "", defaultField: "TO" }])}
          className="mt-2 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          ＋ 担当者を追加
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 文面テンプレートの編集フォーム
// ---------------------------------------------------------------------------
function MessageEditor({
  initial,
  editingId,
  onClose,
  onSaved,
}: {
  initial: { name: string; subject: string; body: string; signature: string };
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [signature, setSignature] = useState(initial.signature);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        editingId ? `/api/transfers/templates/messages/${editingId}` : "/api/transfers/templates/messages",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, subject, body, signature }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      toast.success(editingId ? "更新しました" : "作成しました");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-blue-100 bg-white p-6 shadow-sm space-y-4">
      <p className="text-sm font-semibold text-gray-700">
        {editingId ? "文面テンプレートを編集" : "文面テンプレートを作成"}
      </p>
      <p className="text-xs text-gray-500">
        件名・本文・署名には差し込みタグ {"{{企業名}} {{担当者名}} {{候補者名}}"}{" "}
        が使えます。送信画面で適用すると、タグごとの入力欄が表示されます。
        URL・パスワード・有効期限・ファイル名は送信のたびに自動挿入されるため、ここには書かないでください。
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            テンプレート名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 新規候補者のご紹介"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">件名の雛形</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="例: 【ビズスタジオ】候補者（{{候補者名}}様）のご紹介"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">本文の雛形（自由文部分のみ）</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder={"{{企業名}}\n{{担当者名}} 様\n\nいつもお世話になっております。..."}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-5 focus:border-[#2563EB] focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          署名の雛形（空欄なら送信者の自動署名を使います）
        </label>
        <textarea
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-5 focus:border-[#2563EB] focus:outline-none"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ページ本体
// ---------------------------------------------------------------------------
export default function TransferTemplatesPage() {
  const [tab, setTab] = useState<"recipients" | "messages">("recipients");
  const [showArchived, setShowArchived] = useState(false);
  const [recipients, setRecipients] = useState<RecipientTemplate[]>([]);
  const [messages, setMessages] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  // 編集フォームの状態: null=閉、{editingId:null}=新規（initial に複製元を入れると複製になる）
  const [recipientEditor, setRecipientEditor] = useState<{
    editingId: string | null;
    initial: { name: string; companyName: string; memo: string; contacts: ContactRow[] };
  } | null>(null);
  const [messageEditor, setMessageEditor] = useState<{
    editingId: string | null;
    initial: { name: string; subject: string; body: string; signature: string };
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = showArchived ? "?includeArchived=1" : "";
      const [r, m] = await Promise.all([
        fetch(`/api/transfers/templates/recipients${q}`).then((res) => res.json()),
        fetch(`/api/transfers/templates/messages${q}`).then((res) => res.json()),
      ]);
      setRecipients(r.templates || []);
      setMessages(m.templates || []);
    } catch {
      toast.error("テンプレートの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const setArchived = async (
    kind: "recipients" | "messages",
    id: string,
    isArchived: boolean
  ) => {
    try {
      const res = await fetch(`/api/transfers/templates/${kind}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作に失敗しました");
      toast.success(isArchived ? "アーカイブしました" : "復元しました");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作に失敗しました");
    }
  };

  const recipientRows = useMemo(
    () => recipients.filter((t) => showArchived || !t.isArchived),
    [recipients, showArchived]
  );
  const messageRows = useMemo(
    () => messages.filter((t) => showArchived || !t.isArchived),
    [messages, showArchived]
  );

  const rowCls = (isArchived: boolean, stale: boolean) =>
    `border-b border-gray-50 ${isArchived ? "bg-gray-50 text-gray-400" : stale ? "bg-gray-50/80 text-gray-400" : ""}`;

  return (
    <div className="max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/transfers" className="text-sm text-gray-400 hover:text-gray-600">
          ← 送信一覧へ
        </Link>
        <h1 className="text-xl font-bold text-[#374151]">送信テンプレート管理</h1>
      </div>

      <p className="mb-4 text-xs text-gray-500">
        宛先（企業・担当者）と文面のテンプレートを全社で共有します。編集は誰でも可能、アーカイブは作成者本人と管理者のみです。
        グレー表示の行は90日以上使われていないテンプレートです。担当者の異動・退職がないかご確認ください。
      </p>

      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {(
            [
              ["recipients", "宛先テンプレート"],
              ["messages", "文面テンプレート"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === key ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            アーカイブを表示
          </label>
          <button
            onClick={() => {
              if (tab === "recipients") {
                setRecipientEditor({
                  editingId: null,
                  initial: { name: "", companyName: "", memo: "", contacts: [] },
                });
              } else {
                setMessageEditor({
                  editingId: null,
                  initial: { name: "", subject: "", body: "", signature: "" },
                });
              }
            }}
            className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D4ED8]"
          >
            ＋ 新規作成
          </button>
        </div>
      </div>

      {tab === "recipients" && recipientEditor && (
        <div className="mb-4">
          <RecipientEditor
            initial={recipientEditor.initial}
            editingId={recipientEditor.editingId}
            onClose={() => setRecipientEditor(null)}
            onSaved={() => {
              setRecipientEditor(null);
              load();
            }}
          />
        </div>
      )}
      {tab === "messages" && messageEditor && (
        <div className="mb-4">
          <MessageEditor
            initial={messageEditor.initial}
            editingId={messageEditor.editingId}
            onClose={() => setMessageEditor(null)}
            onSaved={() => {
              setMessageEditor(null);
              load();
            }}
          />
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm overflow-x-auto">
        {tab === "recipients" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                <th className="px-4 py-3 font-medium">名前</th>
                <th className="px-4 py-3 font-medium">企業名</th>
                <th className="px-4 py-3 font-medium">担当者数</th>
                <th className="px-4 py-3 font-medium">最終使用日</th>
                <th className="px-4 py-3 font-medium">作成者</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    読み込み中...
                  </td>
                </tr>
              )}
              {!loading && recipientRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    宛先テンプレートはまだありません
                  </td>
                </tr>
              )}
              {recipientRows.map((t) => (
                <tr key={t.id} className={rowCls(t.isArchived, isTemplateStale(t.lastUsedAt))}>
                  <td className="px-4 py-3 text-gray-800">
                    {t.name}
                    {t.isArchived && (
                      <span className="ml-1.5 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500">
                        アーカイブ済み
                      </span>
                    )}
                    {t.memo && <div className="text-xs text-gray-400">{t.memo}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{t.companyName ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{t.contacts.length}名</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    <LastUsedCell lastUsedAt={t.lastUsedAt} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{t.createdByName}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() =>
                          setRecipientEditor({
                            editingId: t.id,
                            initial: {
                              name: t.name,
                              companyName: t.companyName ?? "",
                              memo: t.memo ?? "",
                              contacts: t.contacts.map((c) => ({
                                name: c.name ?? "",
                                email: c.email,
                                defaultField: (c.defaultField as ContactRow["defaultField"]) || "TO",
                              })),
                            },
                          })
                        }
                        className="text-blue-600 hover:underline"
                      >
                        編集
                      </button>
                      <button
                        onClick={() =>
                          setRecipientEditor({
                            editingId: null,
                            initial: {
                              name: `${t.name}のコピー`,
                              companyName: t.companyName ?? "",
                              memo: t.memo ?? "",
                              contacts: t.contacts.map((c) => ({
                                name: c.name ?? "",
                                email: c.email,
                                defaultField: (c.defaultField as ContactRow["defaultField"]) || "TO",
                              })),
                            },
                          })
                        }
                        className="text-gray-500 hover:underline"
                      >
                        複製
                      </button>
                      {t.canArchive && (
                        <button
                          onClick={() => setArchived("recipients", t.id, !t.isArchived)}
                          className="text-gray-500 hover:text-red-500 hover:underline"
                        >
                          {t.isArchived ? "復元" : "アーカイブ"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                <th className="px-4 py-3 font-medium">名前</th>
                <th className="px-4 py-3 font-medium">件名</th>
                <th className="px-4 py-3 font-medium">最終使用日</th>
                <th className="px-4 py-3 font-medium">作成者</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    読み込み中...
                  </td>
                </tr>
              )}
              {!loading && messageRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    文面テンプレートはまだありません
                  </td>
                </tr>
              )}
              {messageRows.map((t) => (
                <tr key={t.id} className={rowCls(t.isArchived, isTemplateStale(t.lastUsedAt))}>
                  <td className="px-4 py-3 text-gray-800">
                    {t.name}
                    {t.isArchived && (
                      <span className="ml-1.5 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500">
                        アーカイブ済み
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{t.subject || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    <LastUsedCell lastUsedAt={t.lastUsedAt} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{t.createdByName}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() =>
                          setMessageEditor({
                            editingId: t.id,
                            initial: {
                              name: t.name,
                              subject: t.subject,
                              body: t.body,
                              signature: t.signature ?? "",
                            },
                          })
                        }
                        className="text-blue-600 hover:underline"
                      >
                        編集
                      </button>
                      <button
                        onClick={() =>
                          setMessageEditor({
                            editingId: null,
                            initial: {
                              name: `${t.name}のコピー`,
                              subject: t.subject,
                              body: t.body,
                              signature: t.signature ?? "",
                            },
                          })
                        }
                        className="text-gray-500 hover:underline"
                      >
                        複製
                      </button>
                      {t.canArchive && (
                        <button
                          onClick={() => setArchived("messages", t.id, !t.isArchived)}
                          className="text-gray-500 hover:text-red-500 hover:underline"
                        >
                          {t.isArchived ? "復元" : "アーカイブ"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
