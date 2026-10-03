"use client";

// T-206: 求職者詳細「面接対策」タブ。
//   面接対策資料（HTML）をアップロード → 下書き → プレビュー → 公開 → URL・案内文コピー → 差し替え／延長／停止／再公開／版の履歴。
//   プレビューは iframe の srcdoc（sandbox="allow-scripts"・allow-same-origin なし）でポータル内に表示し、公開 URL は通さない（閲覧数に数えない）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const STAGES = ["一次面接", "二次面接", "三次面接", "最終面接", "模擬面接まとめ", "その他"] as const;
const MAX_HTML_BYTES = 4 * 1024 * 1024;

type DisplayStatus = "draft" | "published" | "expired" | "stopped" | "closed";

type PageRow = {
  id: string;
  slug: string;
  stage: string;
  title: string;
  entryId: string | null;
  companyName: string | null;
  interviewDate: string | null;
  status: string;
  displayStatus: DisplayStatus;
  publishedAt: string | null;
  expiresAt: string | null;
  lastViewableDay: string | null;
  stoppedAt: string | null;
  useWrapper: boolean;
  requireBirthdate: boolean;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  verifyLockedUntil: string | null;
  versionCount: number;
  currentVersionNo: number;
  createdAt: string;
  createdByName: string;
  publicUrl: string;
  guideMessage: string | null;
  guideMessageUpdated: string | null;
};

type EntryOption = {
  id: string;
  companyName: string;
  entryFlag: string | null;
  entryFlagDetail: string | null;
  closed: boolean;
  firstInterviewDate: string | null;
  secondInterviewDate: string | null;
  finalInterviewDate: string | null;
};

type TabData = {
  candidate: { id: string; name: string; hasBirthday: boolean };
  entries: EntryOption[];
  pages: PageRow[];
};

type VersionRow = { id: string; versionNo: number; note: string | null; createdAt: string; uploadedByName: string };

const STATUS_BADGE: Record<DisplayStatus, { label: string; className: string }> = {
  draft: { label: "下書き", className: "border-gray-200 bg-gray-50 text-gray-600" },
  published: { label: "公開中", className: "border-green-200 bg-green-50 text-green-700" },
  expired: { label: "期限切れ", className: "border-amber-200 bg-amber-50 text-amber-700" },
  stopped: { label: "公開停止", className: "border-red-200 bg-red-50 text-red-700" },
  closed: { label: "選考終了", className: "border-slate-200 bg-slate-100 text-slate-600" },
};

function fmtYmdShort(ymd: string | null): string {
  if (!ymd) return "";
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function fmtJstDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtJstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}をコピーしました`);
  } catch {
    toast.error("コピーできませんでした");
  }
}

async function readHtmlFile(file: File): Promise<{ ok: true; html: string } | { ok: false; message: string }> {
  if (!/\.html?$/i.test(file.name)) return { ok: false, message: "HTML ファイル（.html）を選んでください" };
  if (file.size > MAX_HTML_BYTES) return { ok: false, message: `ファイルが大きすぎます（${(file.size / 1024 / 1024).toFixed(1)}MB）。4MB 以内にしてください` };
  const html = await file.text();
  if (!html.trim()) return { ok: false, message: "ファイルの中身が空です" };
  return { ok: true, html };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

const btnBase = "inline-flex items-center justify-center rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost = `${btnBase} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
const btnPrimary = `${btnBase} border-[#2563EB] bg-[#2563EB] text-white hover:bg-[#1d4ed8]`;
const btnDanger = `${btnBase} border-red-300 bg-white text-red-600 hover:bg-red-50`;

/* ------------------------------------------------------------------ */
/*  Preview modal                                                      */
/* ------------------------------------------------------------------ */

type PreviewState = {
  title: string;
  html: string | null;
  loading: boolean;
  versionNo: number | null;
  /** 確定ボタン（公開／差し替えて公開／差し替える）。無ければ閉じるだけ */
  action?: { label: string; onConfirm: () => Promise<void> };
};

function PreviewModal({ state, onClose }: { state: PreviewState; onClose: () => void }) {
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex h-[92vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#374151]">プレビュー：{state.title}</div>
            <div className="text-[11px] text-gray-500">
              公開時と同じ見た目（共通ヘッダー・フッター込み）{state.versionNo ? `・版 ${state.versionNo}` : ""}。この画面は閲覧数に数えません
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs">
              <button type="button" onClick={() => setMobile(false)} className={`px-3 py-1 ${!mobile ? "bg-[#2563EB] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                PC幅
              </button>
              <button type="button" onClick={() => setMobile(true)} className={`px-3 py-1 ${mobile ? "bg-[#2563EB] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                スマホ幅（390px）
              </button>
            </div>
            {state.action && (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || !state.html}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await state.action!.onConfirm();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "処理中…" : state.action.label}
              </button>
            )}
            <button type="button" className={btnGhost} onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>
        <div className="flex flex-1 items-start justify-center overflow-auto bg-gray-100 p-3">
          {state.loading || !state.html ? (
            <div className="py-20 text-sm text-gray-500">読み込み中…</div>
          ) : (
            <iframe
              title="preview"
              srcDoc={state.html}
              sandbox="allow-scripts"
              className="h-full bg-white shadow"
              style={{ width: mobile ? 390 : "100%", minHeight: "100%", border: 0 }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  File picker (drag & drop)                                          */
/* ------------------------------------------------------------------ */

function HtmlDropZone({ fileName, onFile }: { fileName: string | null; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-6 text-center text-sm ${over ? "border-[#2563EB] bg-blue-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm,text/html"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {fileName ? (
        <div className="text-[#374151]">
          <span className="font-medium">{fileName}</span>
          <span className="ml-2 text-xs text-gray-500">（クリックで選び直し）</span>
        </div>
      ) : (
        <div className="text-gray-600">
          HTML ファイル（.html・4MBまで）をここにドラッグ、またはクリックして選択
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Create modal                                                       */
/* ------------------------------------------------------------------ */

function CreateModal({
  candidateId,
  entries,
  onClose,
  onCreated,
}: {
  candidateId: string;
  entries: EntryOption[];
  onClose: () => void;
  onCreated: (page: PageRow) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [stage, setStage] = useState<string>(STAGES[0]);
  const [entryId, setEntryId] = useState<string>("");
  const [interviewDate, setInterviewDate] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  const entry = entries.find((e) => e.id === entryId) ?? null;
  const autoTitle = useMemo(() => (entry ? `${stage}対策（${entry.companyName}）` : `${stage}対策`), [stage, entry]);
  useEffect(() => {
    if (!titleEdited) setTitle(autoTitle);
  }, [autoTitle, titleEdited]);

  // エントリーを選んだとき、種別に合う面接日があれば初期値に入れる
  useEffect(() => {
    if (!entry || interviewDate) return;
    const d = stage === "一次面接" ? entry.firstInterviewDate : stage === "二次面接" ? entry.secondInterviewDate : stage === "最終面接" ? entry.finalInterviewDate : null;
    if (d) setInterviewDate(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, stage]);

  const handleFile = async (f: File) => {
    const r = await readHtmlFile(f);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    setFileName(f.name);
    setHtml(r.html);
  };

  const save = async () => {
    if (!html) {
      toast.error("HTML ファイルを選んでください");
      return;
    }
    setSaving(true);
    try {
      const data = await api<{ page: PageRow }>(`/api/candidates/${candidateId}/mensetsu-pages`, {
        method: "POST",
        body: JSON.stringify({ stage, entryId: entryId || null, interviewDate: interviewDate || null, title: title.trim() || autoTitle, html }),
      });
      toast.success("下書きを保存しました。プレビューで確認して「公開」を押してください");
      onCreated(data.page);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-[#374151]">面接対策ページを作る</h3>
        <div className="space-y-3">
          <HtmlDropZone fileName={fileName} onFile={handleFile} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-gray-600">
              種別
              <select value={stage} onChange={(e) => setStage(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-gray-600">
              面接日（任意）
              <input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          <label className="block text-xs text-gray-600">
            企業（エントリーから選択・なしも可）
            <select value={entryId} onChange={(e) => setEntryId(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">（ひもづけなし）</option>
              {entries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.companyName}
                  {e.entryFlag ? `（${e.entryFlag}${e.entryFlagDetail ? `・${e.entryFlagDetail}` : ""}）` : ""}
                  {e.closed ? "【選考終了】" : ""}
                </option>
              ))}
            </select>
            {entry?.closed && <div className="mt-1 text-[11px] text-amber-700">このエントリーは選考終了のため、ひもづけると公開できません</div>}
          </label>
          <label className="block text-xs text-gray-600">
            タイトル
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleEdited(true);
              }}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className={btnPrimary} onClick={save} disabled={saving || !html}>
            {saving ? "保存中…" : "下書き保存してプレビュー"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Replace modal                                                      */
/* ------------------------------------------------------------------ */

function ReplaceModal({ page, onClose, onPreview }: { page: PageRow; onClose: () => void; onPreview: (html: string, fileName: string) => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const handleFile = async (f: File) => {
    const r = await readHtmlFile(f);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    setFileName(f.name);
    setHtml(r.html);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-base font-semibold text-[#374151]">差し替え：{page.title}</h3>
        <p className="mb-3 text-xs text-gray-500">URL・公開期限・閲覧記録・本人確認済みの端末はそのまま、中身だけ新しい版にします（現在 版 {page.currentVersionNo}）。</p>
        <HtmlDropZone fileName={fileName} onFile={handleFile} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className={btnPrimary} disabled={!html} onClick={() => html && fileName && onPreview(html, fileName)}>
            プレビュー
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Versions modal                                                     */
/* ------------------------------------------------------------------ */

function VersionsModal({ page, onClose, onPreview }: { page: PageRow; onClose: () => void; onPreview: (versionNo: number) => void }) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  useEffect(() => {
    api<{ versions: VersionRow[] }>(`/api/mensetsu-pages/${page.id}/versions`)
      .then((d) => setVersions(d.versions))
      .catch((e) => toast.error(e instanceof Error ? e.message : "取得に失敗しました"));
  }, [page.id]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-[#374151]">版の履歴：{page.title}</h3>
        {!versions ? (
          <div className="text-sm text-gray-500">読み込み中…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="py-1.5 pr-2">版</th>
                <th className="py-1.5 pr-2">アップロード</th>
                <th className="py-1.5 pr-2">担当</th>
                <th className="py-1.5 pr-2">メモ</th>
                <th className="py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2">
                    版 {v.versionNo}
                    {v.versionNo === page.currentVersionNo && <span className="ml-1 rounded border border-green-200 bg-green-50 px-1 text-[10px] text-green-700">現在</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-xs text-gray-600">{fmtJstDateTime(v.createdAt)}</td>
                  <td className="py-1.5 pr-2 text-xs text-gray-600">{v.uploadedByName}</td>
                  <td className="py-1.5 pr-2 text-xs text-gray-600">{v.note ?? ""}</td>
                  <td className="py-1.5 text-right">
                    <button type="button" className={btnGhost} onClick={() => onPreview(v.versionNo)}>
                      プレビュー
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className={btnGhost} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab                                                                */
/* ------------------------------------------------------------------ */

export default function MensetsuPagesTab({ candidateId }: { candidateId: string }) {
  const [data, setData] = useState<TabData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<PageRow | null>(null);
  const [versionsTarget, setVersionsTarget] = useState<PageRow | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<TabData>(`/api/candidates/${candidateId}/mensetsu-pages`);
      setData(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPage = (page: PageRow) => {
    setData((prev) => {
      if (!prev) return prev;
      const exists = prev.pages.some((p) => p.id === page.id);
      return { ...prev, pages: exists ? prev.pages.map((p) => (p.id === page.id ? page : p)) : [page, ...prev.pages] };
    });
  };

  const runAction = async (page: PageRow, action: string, body?: unknown, successMessage?: string) => {
    setBusyId(page.id);
    try {
      const d = await api<{ page: PageRow }>(`/api/mensetsu-pages/${page.id}/${action}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      applyPage(d.page);
      if (successMessage) toast.success(successMessage);
      return d.page;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "失敗しました");
      return null;
    } finally {
      setBusyId(null);
    }
  };

  /** 保存済みの版のプレビュー。action を渡すと確定ボタンが出る */
  const openPreview = async (page: PageRow, versionNo?: number, action?: PreviewState["action"]) => {
    setPreview({ title: page.title, html: null, loading: true, versionNo: versionNo ?? null, action });
    try {
      const d = await api<{ html: string; versionNo: number }>(`/api/mensetsu-pages/${page.id}/preview${versionNo ? `?version=${versionNo}` : ""}`);
      setPreview((p) => (p ? { ...p, html: d.html, versionNo: d.versionNo, loading: false } : p));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "プレビューの取得に失敗しました");
      setPreview(null);
    }
  };

  const openPublishPreview = (page: PageRow) =>
    openPreview(page, undefined, {
      label: "公開",
      onConfirm: async () => {
        const updated = await runAction(page, "publish", undefined, "公開しました。案内文をコピーして求職者へ送ってください");
        if (updated) setPreview(null);
      },
    });

  /** 差し替え：未保存 HTML をプレビュー → 「差し替えて公開」／「差し替える」 */
  const openReplacePreview = async (page: PageRow, html: string, fileName: string) => {
    setReplaceTarget(null);
    const publishToo = page.status === "draft";
    setPreview({
      title: `${page.title}（新しい版：${fileName}）`,
      html: null,
      loading: true,
      versionNo: null,
      action: {
        label: publishToo ? "差し替えて公開" : "差し替えて公開（版を更新）",
        onConfirm: async () => {
          const updated = await runAction(page, "replace", { html, note: fileName, publish: publishToo }, "差し替えました。必要なら更新の案内文をコピーして送ってください");
          if (updated) setPreview(null);
        },
      },
    });
    try {
      const d = await api<{ html: string }>(`/api/mensetsu-pages/${page.id}/preview`, { method: "POST", body: JSON.stringify({ html }) });
      setPreview((p) => (p ? { ...p, html: d.html, loading: false } : p));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "プレビューの取得に失敗しました");
      setPreview(null);
    }
  };

  const hasBirthday = data?.candidate.hasBirthday ?? false;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[#374151]">面接対策ページ</h2>
          <p className="text-[11px] text-gray-500">中身の確認はプレビューで行ってください（公開URLは生年月日の入力が必要です）</p>
        </div>
        <button type="button" className={btnPrimary} onClick={() => setShowCreate(true)} disabled={!data}>
          ＋ 面接対策ページを作る
        </button>
      </div>

      {!hasBirthday && data && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          この求職者は生年月日が未登録です。公開ページの本人確認に使うため、基本情報で生年月日を登録するまで「公開」はできません。
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-3 py-2">タイトル</th>
              <th className="px-3 py-2">企業名</th>
              <th className="px-3 py-2">面接日</th>
              <th className="px-3 py-2">状態</th>
              <th className="px-3 py-2">公開期限</th>
              <th className="px-3 py-2">閲覧</th>
              <th className="px-3 py-2">版</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                  読み込み中…
                </td>
              </tr>
            ) : !data || data.pages.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                  面接対策ページはまだありません
                </td>
              </tr>
            ) : (
              data.pages.map((p) => {
                const badge = STATUS_BADGE[p.displayStatus];
                const busy = busyId === p.id;
                const locked = p.verifyLockedUntil && new Date(p.verifyLockedUntil).getTime() > Date.now();
                return (
                  <tr key={p.id} className="border-b border-gray-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#374151]">{p.title}</div>
                      <div className="text-[11px] text-gray-500">
                        {p.stage}・作成 {fmtJstDateTime(p.createdAt)}（{p.createdByName}）
                        {!p.requireBirthdate && <span className="ml-1 rounded border border-gray-200 px-1 text-[10px] text-gray-500">本人確認なし</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{p.companyName ?? <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{p.interviewDate ? p.interviewDate.replace(/-/g, "/") : <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${badge.className}`}>{badge.label}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{p.lastViewableDay ? `${fmtYmdShort(p.lastViewableDay)} まで` : <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {p.viewCount > 0 ? (
                        <div>
                          <div>初回 {fmtJstDateTime(p.firstViewedAt)}・{p.viewCount}回</div>
                          <div className="text-[11px] text-gray-500">最終 {fmtJstDateTime(p.lastViewedAt)}</div>
                        </div>
                      ) : (
                        <span className="text-gray-400">未閲覧</span>
                      )}
                      {locked && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-red-600">
                          入力ロック中（〜{fmtJstTime(p.verifyLockedUntil!)}）
                          <button type="button" className={`${btnDanger} !px-1.5 !py-0.5 !text-[10px]`} disabled={busy} onClick={() => void runAction(p, "unlock", undefined, "ロックを解除しました")}>
                            ロック解除
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <button type="button" className="text-[#2563EB] hover:underline" onClick={() => setVersionsTarget(p)}>
                        版 {p.currentVersionNo}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.status === "draft" && (
                          <button type="button" className={btnPrimary} disabled={busy || !hasBirthday} title={!hasBirthday ? "生年月日が未登録のため公開できません" : undefined} onClick={() => void openPublishPreview(p)}>
                            公開
                          </button>
                        )}
                        <button type="button" className={btnGhost} onClick={() => void openPreview(p)}>
                          プレビュー
                        </button>
                        {p.status !== "draft" && (
                          <>
                            <button type="button" className={btnGhost} onClick={() => void copyText(p.publicUrl, "URL")}>
                              URLコピー
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              disabled={!p.guideMessage}
                              onClick={() => void copyText((p.currentVersionNo > 1 ? p.guideMessageUpdated : p.guideMessage) ?? "", "案内文")}
                              title={p.currentVersionNo > 1 ? "差し替え後の案内文（資料を更新しました）" : "案内文"}
                            >
                              案内文コピー
                            </button>
                          </>
                        )}
                        <button type="button" className={btnGhost} disabled={busy} onClick={() => setReplaceTarget(p)}>
                          差し替え
                        </button>
                        {p.status !== "draft" && (
                          <button type="button" className={btnGhost} disabled={busy} onClick={() => void runAction(p, "extend", undefined, "公開期限を今日から30日後に延長しました")}>
                            延長
                          </button>
                        )}
                        {p.status === "published" && (
                          <button type="button" className={btnDanger} disabled={busy} onClick={() => void runAction(p, "stop", { reason: "manual" }, "公開を停止しました")}>
                            公開停止
                          </button>
                        )}
                        {p.status === "stopped" && (
                          <button type="button" className={btnGhost} disabled={busy || !hasBirthday} onClick={() => void runAction(p, "republish", undefined, "再公開しました")}>
                            再公開
                          </button>
                        )}
                        <button type="button" className={btnGhost} onClick={() => setVersionsTarget(p)}>
                          版の履歴
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showCreate && data && (
        <CreateModal
          candidateId={candidateId}
          entries={data.entries}
          onClose={() => setShowCreate(false)}
          onCreated={(page) => {
            setShowCreate(false);
            applyPage(page);
            if (hasBirthday) void openPublishPreview(page);
            else void openPreview(page);
          }}
        />
      )}
      {replaceTarget && <ReplaceModal page={replaceTarget} onClose={() => setReplaceTarget(null)} onPreview={(html, fileName) => void openReplacePreview(replaceTarget, html, fileName)} />}
      {versionsTarget && (
        <VersionsModal
          page={versionsTarget}
          onClose={() => setVersionsTarget(null)}
          onPreview={(versionNo) => {
            const page = versionsTarget;
            setVersionsTarget(null);
            void openPreview(page, versionNo);
          }}
        />
      )}
      {preview && <PreviewModal state={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
