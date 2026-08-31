"use client";

// T-147: セキュアファイル送信の新規作成画面。
// - ファイルはブラウザから Supabase へ直接アップロード（署名付きアップロードURL・XHRで進捗表示）。
//   ファイル本体を portal サーバー経由で流さない（確定仕様）。
// - 宛先（TO）と CC を分けた通常のメール1通を送る。URL・パスワードは1組で全受信者共通（TO+CC 合計 最大10件）。
//
// 2026-08-06 改修（2カラム化）:
//   左＝入力欄 / 右＝メール全文プレビュー。右のプレビュー上で（1）本文と（4）署名を直接編集する。
//   固定ブロック（案内文・URL・パスワード・有効期限・ファイル）と注意書きは編集不可のまま。
//   プレビューは実送信と同じ buildTransferNoticeBody 系（secure-transfer-shared.ts）で組み立てる。
//   画面が狭いときは grid が1カラムに落ちて上下2段になる。
//
//   本文の初期値は空（添え書きが入力されていればそれのみ）。固定の挨拶文は廃止した。
//   添え書きは「本文をまだ触っていない間だけ」本文へ反映する（bodyTouched）。
//   一度でも本文を編集したら添え書きでは上書きしない＝手入力を消さない。
//
// - 送信ボタン → 確認画面（編集不可・最終確認のみ）→ 送信、の2段階。
//   確認画面から戻っても本文・署名は再合成しない（編集内容が保持される）。
// - 送信完了画面で URL とパスワードを一度だけ表示する（再表示不可・DBに平文なし）。

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  buildDefaultTransferBodyIntro,
  buildTransferFixedBlock,
  buildTransferNoticeBody,
  buildTransferSignature,
  calcExpiresAt,
  hasMixedEmailDomains,
  parseEmailList,
  MAX_TRANSFER_RECIPIENTS,
  TRANSFER_MAIL_SUBJECT,
} from "@/lib/secure-transfer-shared";
import {
  applyTransferTemplateTags,
  extractTransferTemplateTags,
  hasUnresolvedTemplateBraces,
  type ContactField,
  type TransferTemplateTagName,
} from "@/lib/secure-transfer-templates";

const MAX_FILES = 10;
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB（サーバー側と同値）

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// プレビューでは実値がまだ無いのでプレースホルダを出す（実送信時に置き換わる）
const URL_PLACEHOLDER = "（送信時に自動発行されます）";
const PW_PLACEHOLDER = "（送信時に自動生成されます）";

type UploadState = {
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  storagePath?: string;
};

// T-185: 送信画面で使うテンプレートの型（一覧APIのレスポンス形）
type RecipientTemplateOption = {
  id: string;
  name: string;
  companyName: string | null;
  contacts: { id: string; name: string | null; email: string; defaultField: string }[];
};

type MessageTemplateOption = {
  id: string;
  name: string;
  subject: string;
  body: string;
  signature: string | null;
};

// 宛先テンプレート選択時のチェックリスト1行分（適用前にその場で付け替えできる）
type ContactCheckRow = {
  name: string | null;
  email: string;
  field: ContactField; // TO / CC / NONE（NONE = 入れない）
};

type SendResult = {
  id: string;
  recipientEmails: string[];
  ccEmails: string[];
  passwordInEmail: boolean;
  expiresAt: string;
  files: { fileName: string; fileSize: number }[];
  url: string;
  password: string;
  copyRequested: boolean;
  copySent: boolean;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatJst(dt: string): string {
  return new Date(dt).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 署名付きURLへ XHR で PUT（fetch はアップロード進捗が取れないため）。 */
function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("upload failed: network error"));
    xhr.send(file);
  });
}

/** 入力されたアドレスをチップ表示する。形式不正は赤くして ⚠ を付ける。 */
function EmailChips({ emails, tone }: { emails: string[]; tone: "blue" | "gray" }) {
  if (emails.length === 0) return null;
  const validCls = tone === "blue" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600";
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {emails.map((r, i) => {
        const valid = EMAIL_RE.test(r);
        return (
          <span
            key={`${r}-${i}`}
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${
              valid ? validCls : "bg-red-50 text-red-600 border border-red-200"
            }`}
          >
            {r}
            {!valid && " ⚠"}
          </span>
        );
      })}
    </div>
  );
}

export default function NewTransferPage() {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [recipientsText, setRecipientsText] = useState("");
  const [ccText, setCcText] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState(""); // 添え書き（本文の下書き）
  const [expiresDays, setExpiresDays] = useState(30);
  const [passwordInEmail, setPasswordInEmail] = useState(true);
  const [sendCopyToSender, setSendCopyToSender] = useState(true); // 既定ON
  const [step, setStep] = useState<"form" | "confirm">("form");
  // 右カラムのプレビュー上で直接編集する（1）本文と（4）署名。確認画面へ行き来しても再合成しない
  const [editableBody, setEditableBody] = useState("");
  const [editableSignature, setEditableSignature] = useState("");
  // 本文を手入力したら添え書きでの上書きを止める（ヒント文言の出し分けにも使うので state）
  const [bodyTouched, setBodyTouched] = useState(false);
  const signatureInitialized = useRef(false); // 署名の既定値投入は1回だけ
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [senderInfo, setSenderInfo] = useState<{ name: string; email: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- T-185: テンプレート ----------
  const [recipientTemplates, setRecipientTemplates] = useState<RecipientTemplateOption[]>([]);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplateOption[]>([]);
  // 宛先テンプレート: 選択→担当者チェックリスト展開→「適用」でTO/CC欄へ反映（反映後は手入力と同じ扱い）
  const [selectedRecipientTplId, setSelectedRecipientTplId] = useState("");
  const [contactChecks, setContactChecks] = useState<ContactCheckRow[]>([]);
  const [appliedRecipientTplId, setAppliedRecipientTplId] = useState<string | null>(null);
  // 文面テンプレート: 既に入力がある場合は上書き確認をインラインで出す（window.confirm は使わない）
  const [selectedMessageTplId, setSelectedMessageTplId] = useState("");
  const [pendingMessageTplId, setPendingMessageTplId] = useState<string | null>(null);
  const [appliedMessageTplId, setAppliedMessageTplId] = useState<string | null>(null);
  // 差し込みタグの入力値（件名・本文・署名に {{タグ}} が含まれるものだけ入力欄を出す）
  const [tagValues, setTagValues] = useState<Record<TransferTemplateTagName, string>>({
    企業名: "",
    担当者名: "",
    候補者名: "",
  });
  // 「この宛先/文面をテンプレートに保存」のインライン保存フォーム
  const [savingTplKind, setSavingTplKind] = useState<"recipient" | "message" | null>(null);
  const [savingTplName, setSavingTplName] = useState("");
  const [tplSaving, setTplSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/transfers/templates/recipients").then((r) => (r.ok ? r.json() : { templates: [] })),
      fetch("/api/transfers/templates/messages").then((r) => (r.ok ? r.json() : { templates: [] })),
    ])
      .then(([r, m]) => {
        setRecipientTemplates(r.templates || []);
        setMessageTemplates(m.templates || []);
      })
      .catch(() => {});
  }, []);

  // 署名の既定値に送信者名・メールが要るのでログイン中ユーザーを取得する
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (u?.email) setSenderInfo({ name: u.name ?? u.email, email: u.email });
      })
      .catch(() => {});
  }, []);

  // 署名の初期値は一度だけ入れる（以降はユーザーの編集を尊重して上書きしない）
  useEffect(() => {
    if (!senderInfo || signatureInitialized.current) return;
    signatureInitialized.current = true;
    setEditableSignature(buildTransferSignature(senderInfo.name, senderInfo.email));
  }, [senderInfo]);

  // 添え書きは「本文をまだ触っていない間だけ」本文へ反映する
  useEffect(() => {
    if (bodyTouched) return;
    setEditableBody(buildDefaultTransferBodyIntro(message));
  }, [message, bodyTouched]);

  // 宛先・CC: 改行・カンマ・セミコロン区切りで複数入力（空要素は無視・重複はそのまま許容）
  const recipients = useMemo(() => parseEmailList(recipientsText), [recipientsText]);
  const ccRecipients = useMemo(() => parseEmailList(ccText), [ccText]);
  const invalidRecipients = useMemo(
    () => recipients.filter((r) => !EMAIL_RE.test(r)),
    [recipients]
  );
  const invalidCc = useMemo(() => ccRecipients.filter((r) => !EMAIL_RE.test(r)), [ccRecipients]);
  // 上限は TO + CC の合計（1通のメールに載る受信者の総数）
  const totalRecipients = recipients.length + ccRecipients.length;
  const tooManyRecipients = totalRecipients > MAX_TRANSFER_RECIPIENTS;
  // CC は受信者全員に見えるため、別会社のアドレスが混ざっていたら確認画面で警告する
  const mixedDomains = useMemo(
    () => hasMixedEmailDomains([...recipients, ...ccRecipients]),
    [recipients, ccRecipients]
  );

  const fileNames = useMemo(() => uploads.map((u) => u.file.name), [uploads]);
  const previewExpiresAt = useMemo(() => calcExpiresAt(expiresDays), [expiresDays]);

  // T-185: 差し込みタグの解決。件名・本文・署名の入力値にはタグをそのまま保持し、
  // プレビュー・確認画面・実送信の直前に置換する。値が空のタグは {{...}} のまま残り、
  // 確認画面の unresolvedTags 判定で送信ボタンが無効化される（未展開のまま届く事故防止）。
  const activeTags = useMemo(
    () => extractTransferTemplateTags(subject, editableBody, editableSignature),
    [subject, editableBody, editableSignature]
  );
  const resolvedSubjectRaw = useMemo(
    () => applyTransferTemplateTags(subject, tagValues),
    [subject, tagValues]
  );
  const resolvedBody = useMemo(
    () => applyTransferTemplateTags(editableBody, tagValues),
    [editableBody, tagValues]
  );
  const resolvedSignature = useMemo(
    () => applyTransferTemplateTags(editableSignature, tagValues),
    [editableSignature, tagValues]
  );
  const unresolvedTags = useMemo(
    () => hasUnresolvedTemplateBraces(resolvedSubjectRaw, resolvedBody, resolvedSignature),
    [resolvedSubjectRaw, resolvedBody, resolvedSignature]
  );
  const resolvedSubject = resolvedSubjectRaw.trim() || TRANSFER_MAIL_SUBJECT;

  // （2）（3）は自動挿入・編集不可。実送信と同じ関数で組み立てる
  const fixedPreview = useMemo(
    () =>
      buildTransferFixedBlock({
        url: URL_PLACEHOLDER,
        password: PW_PLACEHOLDER,
        passwordInEmail,
        expiresAt: previewExpiresAt,
        fileNames,
      }),
    [passwordInEmail, previewExpiresAt, fileNames]
  );

  // 確認画面で見せるメール全文（実送信と同じ組み立て）。差し込みタグは置換後の姿を見せる
  const fullPreview = useMemo(
    () =>
      buildTransferNoticeBody({
        body: resolvedBody,
        signature: resolvedSignature,
        url: URL_PLACEHOLDER,
        password: PW_PLACEHOLDER,
        passwordInEmail,
        expiresAt: previewExpiresAt,
        fileNames,
      }),
    [resolvedBody, resolvedSignature, passwordInEmail, previewExpiresAt, fileNames]
  );

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const next = [...uploads];
    for (const file of Array.from(fileList)) {
      if (next.length >= MAX_FILES) {
        toast.error(`ファイルは最大${MAX_FILES}件までです`);
        break;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`1GBを超えるファイルは送信できません: ${file.name}`);
        continue;
      }
      if (next.some((u) => u.file.name === file.name && u.file.size === file.size)) {
        continue; // 同名同サイズの重複追加はスキップ
      }
      next.push({ file, progress: 0, status: "pending" });
    }
    setUploads(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== index));
  };

  const updateUpload = (index: number, patch: Partial<UploadState>) => {
    setUploads((prev) => prev.map((u, i) => (i === index ? { ...u, ...patch } : u)));
  };

  const canProceed =
    uploads.length > 0 &&
    recipients.length > 0 &&
    invalidRecipients.length === 0 &&
    invalidCc.length === 0 &&
    !tooManyRecipients &&
    !sending;

  const handleProceed = () => {
    if (!canProceed) return;
    // ★本文・署名は再合成しない（確認画面から戻っても編集内容が残る）
    setStep("confirm");
    window.scrollTo({ top: 0 });
  };

  // ---------- T-185: テンプレート操作 ----------

  /** 宛先テンプレートを選択 → 担当者チェックリストを展開（defaultField を初期値にする）。 */
  const handleSelectRecipientTpl = (id: string) => {
    setSelectedRecipientTplId(id);
    const tpl = recipientTemplates.find((t) => t.id === id);
    setContactChecks(
      tpl
        ? tpl.contacts.map((c) => ({
            name: c.name,
            email: c.email,
            field: (["TO", "CC", "NONE"].includes(c.defaultField) ? c.defaultField : "TO") as ContactField,
          }))
        : []
    );
  };

  /**
   * チェックリストの内容を TO / CC 欄へ反映する。
   * 反映後は通常の手入力と同じ扱い（自由に追加・削除でき、件数上限・ドメイン混在警告も既存のまま効く）。
   * 企業名・担当者名の差し込み値もここで自動で埋める（手で上書き可能）。
   */
  const handleApplyRecipientTpl = () => {
    const tpl = recipientTemplates.find((t) => t.id === selectedRecipientTplId);
    if (!tpl) return;
    const toAdd = contactChecks.filter((c) => c.field === "TO").map((c) => c.email);
    const ccAdd = contactChecks.filter((c) => c.field === "CC").map((c) => c.email);
    if (toAdd.length === 0 && ccAdd.length === 0) {
      toast.error("TOまたはCCに入れる担当者を選択してください");
      return;
    }
    // 既存入力の末尾へ改行区切りで追記（既に入力済みの同一アドレスは追記しない）
    const appendEmails = (current: string, add: string[]): string => {
      const existing = new Set(parseEmailList(current).map((e) => e.toLowerCase()));
      const news = add.filter((e) => !existing.has(e.toLowerCase()));
      return [current.trim(), ...news].filter(Boolean).join("\n");
    };
    setRecipientsText((cur) => appendEmails(cur, toAdd));
    setCcText((cur) => appendEmails(cur, ccAdd));
    // 差し込み値の自動埋め: 企業名＝テンプレートの企業名 / 担当者名＝TOに入れた先頭1名の名前
    const firstToName = contactChecks.find((c) => c.field === "TO" && c.name?.trim())?.name?.trim();
    setTagValues((prev) => ({
      ...prev,
      企業名: tpl.companyName?.trim() || prev.企業名,
      担当者名: firstToName || prev.担当者名,
    }));
    setAppliedRecipientTplId(tpl.id);
    setSelectedRecipientTplId("");
    setContactChecks([]);
    toast.success(`宛先テンプレート「${tpl.name}」を反映しました`);
  };

  /** 文面テンプレートを実際に流し込む（上書き確認済みの前提）。 */
  const applyMessageTpl = (tpl: MessageTemplateOption) => {
    setSubject(tpl.subject);
    setEditableBody(tpl.body);
    // テンプレートを明示的に選んだ時だけ上書きする。以降は添え書きで本文を上書きしない
    setBodyTouched(true);
    if (tpl.signature !== null && tpl.signature.trim()) {
      setEditableSignature(tpl.signature);
    }
    // 署名が未設定のテンプレートは現行の署名（自動署名 or 編集済み）をそのまま使う
    setAppliedMessageTplId(tpl.id);
    setSelectedMessageTplId("");
    setPendingMessageTplId(null);
    toast.success(`文面テンプレート「${tpl.name}」を適用しました`);
  };

  /** 文面テンプレートを選択。既に件名・本文の入力がある場合はインラインで上書き確認を出す。 */
  const handleSelectMessageTpl = (id: string) => {
    setSelectedMessageTplId(id);
    setPendingMessageTplId(null);
    if (!id) return;
    const tpl = messageTemplates.find((t) => t.id === id);
    if (!tpl) return;
    if (subject.trim() || editableBody.trim()) {
      setPendingMessageTplId(id); // 「上書きします」の確認パネルを出す
    } else {
      applyMessageTpl(tpl);
    }
  };

  /** 現在の入力をテンプレートとして保存（画面遷移せず、保存後もそのまま送信操作を続けられる）。 */
  const handleSaveTemplate = async () => {
    if (!savingTplKind || tplSaving) return;
    const name = savingTplName.trim();
    if (!name) {
      toast.error("テンプレート名を入力してください");
      return;
    }
    setTplSaving(true);
    try {
      let res: Response;
      if (savingTplKind === "recipient") {
        const contacts = [
          ...recipients.map((email) => ({ name: "", email, defaultField: "TO" })),
          ...ccRecipients.map((email) => ({ name: "", email, defaultField: "CC" })),
        ];
        if (contacts.length === 0) {
          toast.error("宛先（TO）またはCCを入力してから保存してください");
          setTplSaving(false);
          return;
        }
        res = await fetch("/api/transfers/templates/recipients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, contacts }),
        });
      } else {
        // ★保存するのは自由文部分（件名・本文・署名）の生の入力値のみ。
        //   固定生成部（URL・パスワード・有効期限・ファイル名）は editableBody / editableSignature に
        //   そもそも含まれない構造（buildTransferFixedBlock は別領域）なので保存対象外になる
        res = await fetch("/api/transfers/templates/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            subject,
            body: editableBody,
            signature: editableSignature,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      toast.success(
        savingTplKind === "recipient" ? "宛先テンプレートを保存しました" : "文面テンプレートを保存しました"
      );
      setSavingTplKind(null);
      setSavingTplName("");
      // 保存直後から選択肢に出るよう一覧を再取得（このまま送信操作を続けられる）
      const [r, m] = await Promise.all([
        fetch("/api/transfers/templates/recipients").then((x) => (x.ok ? x.json() : { templates: [] })),
        fetch("/api/transfers/templates/messages").then((x) => (x.ok ? x.json() : { templates: [] })),
      ]);
      setRecipientTemplates(r.templates || []);
      setMessageTemplates(m.templates || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setTplSaving(false);
    }
  };

  const handleSend = async () => {
    if (sending) return;
    setSending(true);
    try {
      // 1) 各ファイルを Supabase へ直接アップロード
      const uploaded: { fileName: string; fileSize: number; storagePath: string }[] = [];
      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        if (u.status === "done" && u.storagePath) {
          uploaded.push({ fileName: u.file.name, fileSize: u.file.size, storagePath: u.storagePath });
          continue; // 前回送信失敗時の再試行ではアップロード済み分をスキップ
        }
        updateUpload(i, { status: "uploading", progress: 0 });

        const res = await fetch("/api/transfers/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: u.file.name, fileSize: u.file.size }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "アップロードURLの発行に失敗しました");

        await uploadToSignedUrl(data.signedUrl, u.file, (p) => updateUpload(i, { progress: p }));
        updateUpload(i, { status: "done", progress: 100, storagePath: data.storagePath });
        uploaded.push({ fileName: u.file.name, fileSize: u.file.size, storagePath: data.storagePath });
      }

      // 2) 送信レコード作成（1送信=1レコード・URL/パスワードは1組）＋メール1通送信
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmails: recipients,
          ccEmails: ccRecipients,
          // T-185: 差し込みタグを置換した最終形を送る（確認画面のプレビューと同じ値）
          subject: resolvedSubjectRaw.trim() || undefined,
          message: resolvedBody.trim() || undefined,
          signature: resolvedSignature.trim(), // 空文字 = 署名なしの明示指定
          expiresDays,
          passwordInEmail,
          sendCopyToSender,
          files: uploaded,
          // 使用したテンプレートの lastUsedAt を送信成功時に更新してもらう
          recipientTemplateId: appliedRecipientTplId ?? undefined,
          messageTemplateId: appliedMessageTplId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 送信失敗時はサーバー側で Storage ごとロールバック済み → 再アップロードが必要
        if (res.status === 502) {
          setUploads((prev) =>
            prev.map((u) => ({ ...u, status: "pending", progress: 0, storagePath: undefined }))
          );
        }
        throw new Error(data.error || "送信に失敗しました");
      }
      if ((data as SendResult).copyRequested && !(data as SendResult).copySent) {
        toast.error("相手へは送信できましたが、控えメールの送信に失敗しました");
      }
      setResult(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "送信に失敗しました");
      setStep("form");
    } finally {
      setSending(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}をコピーしました`);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  // ---------- 送信完了画面 ----------
  if (result) {
    return (
      <div className="max-w-xl">
        <h1 className="mb-4 text-xl font-bold text-[#374151]">送信が完了しました</h1>
        <div className="rounded-xl bg-white p-6 shadow-sm space-y-4">
          <p className="text-sm text-gray-600">
            ダウンロード案内メールを1通送信しました。URL とパスワードは受信者全員で共通です。
          </p>

          <div className="space-y-1 text-sm">
            <p className="text-gray-800">
              <span className="text-xs font-semibold text-gray-500">宛先: </span>
              {result.recipientEmails.join(", ")}
            </p>
            {result.ccEmails.length > 0 && (
              <p className="text-gray-800">
                <span className="text-xs font-semibold text-gray-500">CC: </span>
                {result.ccEmails.join(", ")}
              </p>
            )}
            <p className="text-gray-600">
              <span className="text-xs font-semibold text-gray-500">送信控え: </span>
              {!result.copyRequested
                ? "送信しない設定です"
                : result.copySent
                  ? "ご自身宛に送信しました（パスワードは含まれません）"
                  : "⚠ 送信に失敗しました"}
            </p>
          </div>

          {!result.passwordInEmail && (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-800">
                パスワードはメールに記載されていません。
              </p>
              <p className="mt-1 text-xs text-amber-800">
                下記のパスワードを、SMS・電話など、メール以外の方法で受信者へお伝えください。
              </p>
              <p className="mt-1 text-sm font-semibold text-red-600">
                ⚠ この画面を閉じるとパスワードは二度と表示できません。
              </p>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">ダウンロードURL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  {result.url}
                </code>
                <button
                  onClick={() => copyText(result.url, "URL")}
                  className="shrink-0 rounded border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                >
                  コピー
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">パスワード</p>
              <div className="flex items-center gap-2">
                <code
                  className={`flex-1 rounded px-3 py-2 font-mono tracking-widest ${
                    result.passwordInEmail
                      ? "bg-gray-50 text-lg text-gray-800"
                      : "bg-amber-50 text-2xl text-gray-900 border border-amber-200"
                  }`}
                >
                  {result.password}
                </code>
                <button
                  onClick={() => copyText(result.password, "パスワード")}
                  className="shrink-0 rounded border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                >
                  コピー
                </button>
              </div>
            </div>
          </div>

          <p className="text-xs text-red-500">
            ⚠ パスワードはこの画面でのみ表示されます。この画面を閉じると再表示できません
            {result.passwordInEmail ? "（送信したメールにも記載済みです）。" : "。"}
          </p>

          <div className="text-xs text-gray-500">
            <p>有効期限: {formatJst(result.expiresAt)} まで（日本時間）</p>
            <p className="mt-1">ファイル: {result.files.map((f) => f.fileName).join(" / ")}</p>
          </div>

          <div className="flex gap-2 pt-2">
            <Link
              href="/transfers"
              className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D4ED8]"
            >
              送信一覧へ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 送信前の確認画面（編集不可・最終確認のみ） ----------
  if (step === "confirm") {
    return (
      <div className="max-w-2xl">
        <h1 className="mb-4 text-xl font-bold text-[#374151]">送信内容の確認</h1>
        <div className="rounded-xl bg-white p-6 shadow-sm space-y-5">
          <div className="rounded-lg bg-blue-50 px-4 py-3">
            <p className="text-sm font-semibold text-blue-800">
              この内容でメールを1通送信します（宛先{recipients.length}件
              {ccRecipients.length > 0 && ` / CC ${ccRecipients.length}件`}）
            </p>
            <p className="mt-1 text-xs text-blue-700">
              ここでは編集できません。修正する場合は「戻って修正する」を押してください。
            </p>
          </div>

          {mixedDomains && (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">
                ⚠ 宛先に複数の会社のアドレスが含まれています
              </p>
              <p className="mt-1 text-xs text-amber-800">
                CCに入れたアドレスは受信者全員に表示されます。送信先をご確認ください。
              </p>
            </div>
          )}

          {unresolvedTags && (
            <div className="rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3">
              <p className="text-sm font-semibold text-red-700">⚠ 差し込みが埋まっていません</p>
              <p className="mt-1 text-xs text-red-700">
                件名・本文・署名に {"{{ }}"} のまま残っている箇所があります。
                このままでは送信できません。「戻って修正する」から差し込み欄を入力するか、本文を直接修正してください。
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">宛先（{recipients.length}件）</p>
              <ul className="space-y-1">
                {recipients.map((r, i) => (
                  <li key={`${r}-${i}`} className="text-sm text-gray-800">
                    ・{r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">
                CC（{ccRecipients.length}件）
              </p>
              {ccRecipients.length === 0 ? (
                <p className="text-sm text-gray-400">なし</p>
              ) : (
                <ul className="space-y-1">
                  {ccRecipients.map((r, i) => (
                    <li key={`${r}-${i}`} className="text-sm text-gray-800">
                      ・{r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">メール件名</p>
            <p className="text-sm text-gray-800">{resolvedSubject}</p>
            {!subject.trim() && (
              <p className="mt-0.5 text-xs text-gray-400">
                件名が未入力のため既定の件名を使用します
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">ファイル</p>
              <ul className="space-y-0.5">
                {uploads.map((u) => (
                  <li key={`${u.file.name}-${u.file.size}`} className="text-sm text-gray-700">
                    📄 {u.file.name}
                    <span className="ml-1 text-xs text-gray-400">
                      {formatFileSize(u.file.size)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">有効期限</p>
              <p className="text-sm text-gray-800">
                {previewExpiresAt.toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}{" "}
                まで
              </p>
              <p className="mt-2 text-xs font-semibold text-gray-500">送信控え</p>
              <p className="text-sm text-gray-800">
                {sendCopyToSender ? "自分にも送る" : "送らない"}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">メール本文（全文）</p>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-700 font-sans">
              {fullPreview}
            </pre>
          </div>

          {sending && uploads.some((u) => u.status === "uploading") && (
            <ul className="space-y-2">
              {uploads.map((u) => (
                <li
                  key={`${u.file.name}-${u.file.size}`}
                  className="rounded border border-gray-100 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-gray-700">📄 {u.file.name}</span>
                    <span className="w-10 text-right text-xs text-gray-400">
                      {u.status === "done" ? "完了" : u.status === "uploading" ? `${u.progress}%` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setStep("form")}
              disabled={sending}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              戻って修正する
            </button>
            <button
              onClick={handleSend}
              disabled={sending || unresolvedTags}
              className="flex-1 rounded-lg bg-[#2563EB] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {sending
                ? "アップロード・送信中..."
                : unresolvedTags
                  ? "差し込みが埋まっていません"
                  : "送信する"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 入力フォーム（左＝入力 / 右＝プレビュー） ----------
  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/transfers" className="text-sm text-gray-400 hover:text-gray-600">
          ← 一覧へ
        </Link>
        <h1 className="text-xl font-bold text-[#374151]">ファイルを送信</h1>
      </div>

      {/* lg 未満（タブレット・スマホ）は1カラムに落ちて上下2段になる */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ============================ 左: 入力欄 ============================ */}
        <div className="rounded-xl bg-white p-6 shadow-sm space-y-5">
          {/* ファイル選択 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              ファイル（複数可・1件1GBまで）
            </label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => addFiles(e.target.files)}
              disabled={sending}
              className="block w-full text-sm text-gray-500 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:text-gray-700 hover:file:bg-gray-200"
            />
            {uploads.length > 0 && (
              <ul className="mt-3 space-y-2">
                {uploads.map((u, i) => (
                  <li
                    key={`${u.file.name}-${u.file.size}`}
                    className="rounded border border-gray-100 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-gray-700">
                        📄 {u.file.name}
                        <span className="ml-2 text-xs text-gray-400">
                          {formatFileSize(u.file.size)}
                        </span>
                      </span>
                      {!sending && u.status !== "done" && (
                        <button
                          onClick={() => removeFile(i)}
                          className="shrink-0 text-xs text-gray-400 hover:text-red-500"
                        >
                          削除
                        </button>
                      )}
                    </div>
                    {(u.status === "uploading" || u.status === "done") && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-100">
                          <div
                            className={`h-full transition-all ${u.status === "done" ? "bg-green-500" : "bg-[#2563EB]"}`}
                            style={{ width: `${u.progress}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs text-gray-400">
                          {u.status === "done" ? "完了" : `${u.progress}%`}
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* T-185: 宛先テンプレート */}
          {recipientTemplates.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                宛先テンプレートから選ぶ
              </label>
              <select
                value={selectedRecipientTplId}
                onChange={(e) => handleSelectRecipientTpl(e.target.value)}
                disabled={sending}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
              >
                <option value="">（選択してください）</option>
                {recipientTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.companyName ? `${t.name}（${t.companyName}）` : t.name}
                  </option>
                ))}
              </select>
              {selectedRecipientTplId && (
                <div className="mt-2 space-y-1.5">
                  {contactChecks.length === 0 && (
                    <p className="text-xs text-gray-400">このテンプレートに担当者が登録されていません</p>
                  )}
                  {contactChecks.map((c, i) => (
                    <div
                      key={`${c.email}-${i}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 bg-white px-3 py-1.5"
                    >
                      <span className="text-xs text-gray-700">
                        {c.name ? `${c.name}（${c.email}）` : c.email}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-gray-600">
                        {(["TO", "CC", "NONE"] as const).map((f) => (
                          <label key={f} className="flex cursor-pointer items-center gap-1">
                            <input
                              type="radio"
                              name={`apply-contact-${i}`}
                              checked={c.field === f}
                              onChange={() =>
                                setContactChecks((prev) =>
                                  prev.map((row, idx) => (idx === i ? { ...row, field: f } : row))
                                )
                              }
                            />
                            {f === "NONE" ? "入れない" : f}
                          </label>
                        ))}
                      </span>
                    </div>
                  ))}
                  {contactChecks.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleApplyRecipientTpl}
                        disabled={sending}
                        className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                      >
                        適用（TO/CC欄へ反映）
                      </button>
                      <button
                        onClick={() => {
                          setSelectedRecipientTplId("");
                          setContactChecks([]);
                        }}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
                      >
                        キャンセル
                      </button>
                      <span className="text-xs text-gray-400">反映後も自由に追加・削除できます</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 宛先（TO） */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              宛先（TO） <span className="text-red-500">*</span>
              <span className="ml-2 text-xs font-normal text-gray-400">
                改行またはカンマ区切りで複数可
              </span>
            </label>
            <textarea
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              disabled={sending}
              rows={2}
              placeholder={"example1@client.co.jp\nexample2@client.co.jp"}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
            <EmailChips emails={recipients} tone="blue" />
            {invalidRecipients.length > 0 && (
              <p className="mt-1 text-xs text-red-500">
                形式が正しくないアドレスがあります: {invalidRecipients.join(", ")}
              </p>
            )}
          </div>

          {/* CC */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              CC（任意）
              <span className="ml-2 text-xs font-normal text-gray-400">
                改行またはカンマ区切りで複数可
              </span>
            </label>
            <textarea
              value={ccText}
              onChange={(e) => setCcText(e.target.value)}
              disabled={sending}
              rows={2}
              placeholder={"cc@client.co.jp"}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
            <EmailChips emails={ccRecipients} tone="gray" />
            {invalidCc.length > 0 && (
              <p className="mt-1 text-xs text-red-500">
                形式が正しくないアドレスがあります: {invalidCc.join(", ")}
              </p>
            )}
            {tooManyRecipients && (
              <p className="mt-1 text-xs text-red-500">
                宛先とCCの合計は最大{MAX_TRANSFER_RECIPIENTS}件までです（現在 {totalRecipients}件）
              </p>
            )}
            <p className="mt-1 text-xs text-gray-400">
              宛先とCCを含めた1通のメールを送信します。CCのアドレスは受信者全員に表示されます。
            </p>
            {/* T-185: 現在のTO/CCを宛先テンプレートとして保存（画面遷移しない） */}
            <div className="mt-2">
              {savingTplKind === "recipient" ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2">
                  <input
                    type="text"
                    value={savingTplName}
                    onChange={(e) => setSavingTplName(e.target.value)}
                    placeholder="テンプレート名（例: ○○社｜候補者ご紹介）"
                    className="min-w-[220px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                  <button
                    onClick={handleSaveTemplate}
                    disabled={tplSaving}
                    className="rounded bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {tplSaving ? "保存中..." : "保存"}
                  </button>
                  <button
                    onClick={() => {
                      setSavingTplKind(null);
                      setSavingTplName("");
                    }}
                    disabled={tplSaving}
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setSavingTplKind("recipient");
                    setSavingTplName("");
                  }}
                  disabled={sending || (recipients.length === 0 && ccRecipients.length === 0)}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  この宛先をテンプレートに保存
                </button>
              )}
            </div>
          </div>

          {/* T-185: 文面テンプレート */}
          {messageTemplates.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                文面テンプレートから選ぶ
              </label>
              <select
                value={selectedMessageTplId}
                onChange={(e) => handleSelectMessageTpl(e.target.value)}
                disabled={sending}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
              >
                <option value="">（選択してください）</option>
                {messageTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {pendingMessageTplId && (
                <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800">
                    入力済みの件名・本文を上書きします。よろしいですか？
                  </p>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      onClick={() => {
                        const tpl = messageTemplates.find((t) => t.id === pendingMessageTplId);
                        if (tpl) applyMessageTpl(tpl);
                      }}
                      className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                    >
                      上書きして適用
                    </button>
                    <button
                      onClick={() => {
                        setPendingMessageTplId(null);
                        setSelectedMessageTplId("");
                      }}
                      className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* T-185: 差し込みタグの入力欄（件名・本文・署名に {{タグ}} が含まれる分だけ出す） */}
          {activeTags.length > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <p className="mb-2 text-xs font-medium text-gray-600">
                差し込み項目
                <span className="ml-2 font-normal text-gray-400">
                  未入力のままだと {"{{ }}"} が残り、確認画面で送信できません
                </span>
              </p>
              <div className="space-y-2">
                {activeTags.map((tag) => (
                  <div key={tag} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-gray-600">{tag}</span>
                    <input
                      type="text"
                      value={tagValues[tag]}
                      onChange={(e) =>
                        setTagValues((prev) => ({ ...prev, [tag]: e.target.value }))
                      }
                      disabled={sending}
                      placeholder={
                        tag === "候補者名" ? "例: 山田 太郎" : `{{${tag}}} に入る値`
                      }
                      className="flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 件名 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">件名（任意）</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={sending}
              placeholder="例: ご契約書類の送付"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
            <p className="mt-1 text-xs text-gray-400">
              そのままメールの件名になります。空欄の場合は「{TRANSFER_MAIL_SUBJECT}」が使われます。
            </p>
          </div>

          {/* 添え書き */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">添え書き（任意）</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={sending}
              rows={3}
              placeholder="メール本文に入れるメッセージ"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
            <p className="mt-1 text-xs text-gray-400">
              {bodyTouched
                ? "本文を直接編集済みのため、ここの変更は本文へ反映されません。"
                : "プレビューの本文欄に反映されます。本文欄で直接書いても構いません。"}
            </p>
          </div>

          {/* パスワード送付方式 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">パスワードの伝え方</label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="passwordInEmail"
                  checked={passwordInEmail}
                  onChange={() => setPasswordInEmail(true)}
                  disabled={sending}
                  className="mt-0.5"
                />
                <span>
                  パスワードをメールに記載する（既定）
                  <span className="block text-xs text-gray-400">
                    URLと同じメールにパスワードも記載されます
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="passwordInEmail"
                  checked={!passwordInEmail}
                  onChange={() => setPasswordInEmail(false)}
                  disabled={sending}
                  className="mt-0.5"
                />
                <span>
                  メールに記載しない
                  <span className="block text-xs text-gray-400">
                    送信完了画面にパスワードが表示されるので、SMS・電話など別の方法で伝えます
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* 有効期限 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">有効期限</label>
            <select
              value={expiresDays}
              onChange={(e) => setExpiresDays(parseInt(e.target.value, 10))}
              disabled={sending}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
            >
              {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}日{d === 30 ? "（推奨）" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              期限日の23:59（日本時間）まで有効。期限を過ぎるとファイルは自動削除されます。
            </p>
          </div>

          {/* 送信控え */}
          <div>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={sendCopyToSender}
                onChange={(e) => setSendCopyToSender(e.target.checked)}
                disabled={sending}
                className="mt-0.5"
              />
              <span>
                自分にも控えを送る
                <span className="block text-xs text-gray-400">
                  送信内容とメール本文の控えが自分宛に届きます（パスワードは含まれません）
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* ============================ 右: メール全文プレビュー ============================ */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl bg-white p-6 shadow-sm space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-700">メールプレビュー</p>
              <p className="mt-0.5 text-xs text-gray-400">
                実際に送られる全文です。本文と署名はこの画面で直接編集できます。
              </p>
            </div>

            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">
                <span className="font-semibold">件名: </span>
                {resolvedSubject}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                <span className="font-semibold">宛先: </span>
                {recipients.length > 0 ? recipients.join(", ") : "（未入力）"}
              </p>
              {ccRecipients.length > 0 && (
                <p className="mt-0.5 text-xs text-gray-500">
                  <span className="font-semibold">CC: </span>
                  {ccRecipients.join(", ")}
                </p>
              )}
            </div>

            {/* （1）本文: 自由入力・初期値なし */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">本文（編集できます）</p>
              <textarea
                value={editableBody}
                onChange={(e) => {
                  setBodyTouched(true);
                  setEditableBody(e.target.value);
                }}
                disabled={sending}
                rows={12}
                placeholder="宛名・挨拶・本題を自由にご記入ください（空のままでも送信できます）"
                className="w-full resize-y rounded-lg border border-gray-300 px-4 py-3 text-xs leading-5 text-gray-700 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>

            {/* （2）（3）: 編集不可 */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">
                以下は自動で挿入されます（編集不可）
              </p>
              <pre className="whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-100 px-4 py-3 text-xs leading-5 text-gray-500 font-sans">
                {fixedPreview}
              </pre>
            </div>

            {/* （4）署名: 編集可能 */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">署名（編集できます）</p>
              <textarea
                value={editableSignature}
                onChange={(e) => setEditableSignature(e.target.value)}
                disabled={sending}
                rows={Math.min(10, Math.max(4, editableSignature.split("\n").length + 1))}
                className="w-full resize-y rounded-lg border border-gray-300 px-4 py-3 text-xs leading-5 text-gray-700 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              />
              <p className="mt-1 text-xs text-gray-400">
                役職・住所・電話番号などを自由に追記できます。空にすると署名なしで送信されます。
              </p>
            </div>

            {/* T-185: 現在の件名・本文・署名を文面テンプレートとして保存（画面遷移しない）。
                固定生成部（URL・パスワード・有効期限・ファイル名）は本文・署名の入力欄に含まれないため保存されない */}
            <div>
              {savingTplKind === "message" ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2">
                  <input
                    type="text"
                    value={savingTplName}
                    onChange={(e) => setSavingTplName(e.target.value)}
                    placeholder="テンプレート名（例: 新規候補者のご紹介）"
                    className="min-w-[220px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                  <button
                    onClick={handleSaveTemplate}
                    disabled={tplSaving}
                    className="rounded bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {tplSaving ? "保存中..." : "保存"}
                  </button>
                  <button
                    onClick={() => {
                      setSavingTplKind(null);
                      setSavingTplName("");
                    }}
                    disabled={tplSaving}
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setSavingTplKind("message");
                    setSavingTplName("");
                  }}
                  disabled={sending || (!subject.trim() && !editableBody.trim())}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  この文面をテンプレートに保存
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <button
              onClick={handleProceed}
              disabled={!canProceed}
              className="w-full rounded-lg bg-[#2563EB] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              パスワードを発行してメール送信
            </button>
            <p className="mt-2 text-center text-xs text-gray-400">
              次の画面で最終確認してから送信します
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
