"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";

// T-128 公開準備②: 求人サイトURL発行ボタン＋モーダル（自己完結）。
// 面談後に CA が押すと kyuujinPDF で発行（冪等）し、siteUrl をモーダル表示＋ワンクリックコピー。
// 誕生日未登録の候補者はガード文言を表示して発行しない。
//
// T-158: 案内文の「まとめた求人の説明」を /api/candidates/{id}/site-guide-draft で自動下書き。
// モーダルは API 応答を待たずに開き、下書き部分だけ後から差し込む。生成失敗時は記載例入りの
// 固定文にフォールバック。textarea は CA が自由に編集でき、コピーは画面の現在内容を写す。

// 下書き差し込み位置のプレースホルダ（生成中表示 → 応答が返り次第 replace で差し替える）
const DRAFT_PLACEHOLDER = "（下書きを作成中です…）";

// 生成できなかった場合のフォールバック（CA 手書き用の記載例）
const DRAFT_FALLBACK =
  "（ここに2〜3行、まとめた職種や選定ポイントを記載してください）\n" +
  "\n" +
  "記載例：\n" +
  "職種：法人営業系からルート営業や既存顧客を中心とした営業職\n" +
  "業種：商社やメーカーを中心に幅広く有形商材関連を中心\n" +
  "エリア：ご希望のエリアのみですと数が限られてしまった為、23区全体でまずはまとめさせていただきました\n" +
  "年収：下限年収を400万円で区切っておりますが、数に限りがあります為、若干下限を下回る求人も一部含めております";

const GREETING_LATER = "先日は面談をいただきありがとうございました。";
const GREETING_TODAY = "本日は面談をいただきありがとうございました。";

// 案内文テンプレ（後から調整できる定数）。{NAME} {GREETING} {DRAFT} {URL} を置換して使う。
const ANNOUNCEMENT_TEMPLATE =
  "{NAME}様\n" +
  "\n" +
  "お世話になっております。\n" +
  "{GREETING}\n" +
  "求人を検索しまとめましたのでご案内させていただきます。\n" +
  "\n" +
  "────────────────────────────\n" +
  "{DRAFT}\n" +
  "────────────────────────────\n" +
  "\n" +
  "■非公開求人＆マイページ\n" +
  "{URL}\n" +
  "パスワード：ご自身の西暦生年月日（例：19900101）\n" +
  "\n" +
  "【ご利用方法】\n" +
  "・一般的な求人サイトと同じように、当社保有の非公開求人約8万件を検索できます。ぜひ検索してみてください。\n" +
  "・「担当CAおすすめ」に、私が選定した求人を随時アップデートしています。\n" +
  "・「気になる」「応募したい」を選んで送信するだけでOKです。\n" +
  "・もっと知りたい求人は「詳しく知る」をご覧ください。\n" +
  "・メモや質問もそのまま送れますので、気になることがあればお気軽にご質問ください。\n" +
  "\n" +
  "ご確認のほどよろしくお願いいたします。";

/** 姓 + 様（全角/半角スペースで分割。分割できなければフルネーム） */
function familyName(name: string): string {
  const first = name.trim().split(/[\s　]+/)[0];
  return first || name.trim();
}

function buildAnnouncement(args: {
  name: string;
  url: string;
  draft: string;
  isInterviewToday: boolean;
}): string {
  return ANNOUNCEMENT_TEMPLATE.replace("{NAME}", familyName(args.name))
    .replace("{GREETING}", args.isInterviewToday ? GREETING_TODAY : GREETING_LATER)
    .replace("{DRAFT}", args.draft)
    .replace("{URL}", args.url);
}

interface Props {
  candidateId: string;
  candidateName: string;
  hasBirthday: boolean;
}

type DraftInfo = { draft: string; isInterviewToday: boolean };

export default function IssueSiteTokenButton({ candidateId, candidateName, hasBirthday }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [issued, setIssued] = useState<boolean | null>(null);
  const [noBirthday, setNoBirthday] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 案内文（CA が編集可能）。siteUrl 取得後に組み立てて設定する
  const [announcement, setAnnouncement] = useState<string>("");
  // 下書きAPIの結果（siteUrl より先に返るケースに備えて ref に貯める）
  const draftRef = useRef<DraftInfo | null>(null);
  const overlayClose = useOverlayClose(() => setOpen(false));

  const handleClick = async () => {
    setOpen(true);
    setLoading(true);
    setSiteUrl(null);
    setWarning(null);
    setIssued(null);
    setNoBirthday(false);
    setError(null);
    setAnnouncement("");
    draftRef.current = null;

    // 下書き生成は発行と並行して呼ぶ（モーダル表示をブロックしない・モーダルを開くたびに1回）
    fetch(`/api/candidates/${candidateId}/site-guide-draft`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { draft: string | null; generated: boolean; isInterviewToday?: boolean }) => {
        applyDraft(data.generated && data.draft ? data.draft : DRAFT_FALLBACK, !!data.isInterviewToday);
      })
      .catch(() => {
        applyDraft(DRAFT_FALLBACK, false);
      });

    try {
      const res = await fetch(`/api/candidates/${candidateId}/issue-site-token`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "URL発行に失敗しました");
      } else if (data.ok === false && data.reason === "no-birthday") {
        setNoBirthday(true);
      } else {
        const url: string | null = data.siteUrl ?? null;
        setSiteUrl(url);
        setWarning(data.warning ?? null);
        setIssued(data.issued ?? null);
        if (url) {
          // 下書きが先に返っていればそのまま、まだなら生成中プレースホルダで組む
          // （fetch コールバックが ref を書き換えるため、代入時の null に狭めない）
          const d = draftRef.current as DraftInfo | null;
          setAnnouncement(
            buildAnnouncement({
              name: candidateName,
              url,
              draft: d?.draft ?? DRAFT_PLACEHOLDER,
              isInterviewToday: d?.isInterviewToday ?? false,
            })
          );
        }
      }
    } catch {
      setError("URL発行に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 下書きAPIの結果を反映。案内文が組み立て済みならプレースホルダ部分だけ差し替える */
  const applyDraft = (draft: string, isInterviewToday: boolean) => {
    draftRef.current = { draft, isInterviewToday };
    setAnnouncement((prev) => {
      if (!prev) return prev; // まだ siteUrl 待ち → 組み立て時に draftRef から反映される
      let next = prev.replace(DRAFT_PLACEHOLDER, draft);
      if (isInterviewToday) next = next.replace(GREETING_LATER, GREETING_TODAY);
      return next;
    });
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`コピーしました: ${label}`);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="border border-blue-200 bg-blue-50 text-blue-700 rounded-md px-3 py-1 text-[12px] hover:bg-blue-100 transition-colors font-medium"
      >
        求人サイトURLを発行
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          {...overlayClose}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-[560px] max-w-[92vw] max-h-[92vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-bold text-gray-800">求人サイトURL発行</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            {loading && (
              <div className="py-8 text-center text-[13px] text-gray-500">発行中...</div>
            )}

            {!loading && noBirthday && (
              <div className="py-4 text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3">
                生年月日が未登録のため発行できません（候補者情報に登録してください）。
              </div>
            )}

            {!loading && error && (
              <div className="py-4 text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3">
                {error}
              </div>
            )}

            {!loading && siteUrl && (
              <div className="space-y-3">
                {issued !== null && (
                  <div className="text-[12px] text-gray-500">
                    {issued ? "新規発行しました。" : "既に発行済みのURLです（同じURLが表示されます）。"}
                  </div>
                )}

                {warning && (
                  <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    ⚠️ {warning}
                  </div>
                )}

                {/* URL + コピー */}
                <div>
                  <label className="block text-[12px] text-gray-400 mb-1">発行URL</label>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={siteUrl}
                      className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-[13px] text-gray-700 bg-gray-50"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      onClick={() => copy(siteUrl, "URL")}
                      className="border border-blue-200 bg-blue-50 text-blue-700 rounded-md px-3 py-1.5 text-[12px] hover:bg-blue-100 whitespace-nowrap"
                    >
                      URLをコピー
                    </button>
                    <button
                      onClick={() => window.open(siteUrl, "_blank", "noopener,noreferrer")}
                      disabled={!siteUrl}
                      className="border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-1.5 text-[12px] hover:bg-gray-50 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      URLを開く
                    </button>
                  </div>
                </div>

                {/* 案内文（自動下書き・編集可） + コピー */}
                <div>
                  <label className="block text-[12px] text-gray-400 mb-1">
                    案内文（自動下書き・編集できます）
                  </label>
                  <textarea
                    value={announcement}
                    onChange={(e) => setAnnouncement(e.target.value)}
                    rows={26}
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[13px] text-gray-700 bg-white resize-y leading-relaxed"
                  />
                  <div className="mt-2 text-right">
                    <button
                      onClick={() => copy(announcement, "案内文")}
                      className="border border-blue-200 bg-blue-50 text-blue-700 rounded-md px-3 py-1.5 text-[12px] hover:bg-blue-100"
                    >
                      案内文をコピー
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
