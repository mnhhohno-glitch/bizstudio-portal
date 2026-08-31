"use client";

// T-159: 新着お知らせのポップアップ。
// - 「公開日〜翌営業日」の表示期間内（src/lib/announcements/display-period.ts）かつ未読のお知らせを
//   すべて 1 つのポップアップにリスト表示する（ポップアップを複数個出さない）。
// - 行をクリックするとそのお知らせの詳細ページ /announcements/[id] へ直接遷移する。
// - 4 件以上あるときは先頭 3 件だけ出し、末尾に「他 N 件」（一覧 /announcements へ）を添える。
// - 閉じる／行クリックのいずれでも「表示中の全件」を既読にする。
//   （1 件だけ既読にすると、遷移先から戻ったときに残りが再表示されて煩わしいため）
// - 認証済み共通レイアウト src/app/(app)/layout.tsx に配置。ログイン画面には出ない。
//
// 【既知の制約・仕様として受け入れる】
//   既読情報は localStorage に持つためブラウザ単位。別のPC・別ブラウザでログインすると
//   同じポップアップが再表示される。今回は DB 変更を伴わない方針のためこの挙動を許容する。

import { useEffect, useState } from "react";
import Link from "next/link";
import { isWithinDisplayPeriod } from "@/lib/announcements/display-period";
import { todayJstDateString, toJstDateString } from "@/lib/dailyReport/jstDate";
import { ANNOUNCEMENT_CATEGORIES, AnnouncementCategoryKey } from "@/lib/constants/announcement";

type PopupAnnouncement = {
  id: string;
  title: string;
  category: AnnouncementCategoryKey;
  publishedAt: string | null;
};

// 旧実装は `announcement-popup-dismissed:<id>` に単一 ID を持たせていたが、
// 複数件対応で値の形式（JSON 配列）が変わるためキー名を変える。旧キーは無視してよい（移行不要）。
const READ_IDS_KEY = "announcementPopupReadIds";
// 配列が肥大化しないよう、保持は直近 100 件まで（超えた分は古いものから捨てる）
const MAX_READ_IDS = 100;
// 1 つのポップアップにリスト表示する最大件数。超えた分は「他 N 件」に畳む
const MAX_VISIBLE = 3;

function loadReadIds(): string[] {
  try {
    const raw = window.localStorage.getItem(READ_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // プライベートモード等で localStorage が使えない／壊れた値が入っている場合は「未読ゼロ」扱い
    return [];
  }
}

function saveReadIds(ids: string[]) {
  try {
    window.localStorage.setItem(READ_IDS_KEY, JSON.stringify(ids.slice(-MAX_READ_IDS)));
  } catch {
    // 保存できなくても閉じる動作自体は成立させる（他画面の機能に影響を出さない）
  }
}

function formatJstDate(publishedAt: string): string {
  // 一覧画面と同じ「YYYY年M月D日」表記。JST 基準の日付文字列から組み立てる（罠 #17）
  const [y, m, d] = toJstDateString(new Date(publishedAt)).split("-").map((s) => parseInt(s, 10));
  return `${y}年${m}月${d}日`;
}

export default function AnnouncementPopup() {
  const [targets, setTargets] = useState<PopupAnnouncement[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/announcements/latest");
        if (!res.ok) return;
        const data = (await res.json()) as { announcements: PopupAnnouncement[] };
        if (cancelled || !Array.isArray(data.announcements)) return;

        const today = todayJstDateString();
        const readIds = new Set(loadReadIds());

        // 表示期間内（公開日〜翌営業日）かつ未読のものだけ。API が公開日時の降順で返すので並び順はそのまま
        const fresh = data.announcements.filter((a) => {
          if (!a.publishedAt) return false;
          if (readIds.has(a.id)) return false;
          return isWithinDisplayPeriod(toJstDateString(new Date(a.publishedAt)), today);
        });

        if (fresh.length > 0) setTargets(fresh);
      } catch {
        // ポップアップは補助的な導線なので、取得失敗は無視して何も出さない
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 閉じる・行クリックのどちらでも、表示中の全件をまとめて既読にする
  const markAllReadAndClose = () => {
    if (targets.length > 0) {
      const ids = loadReadIds();
      const merged = ids.concat(targets.map((a) => a.id).filter((id) => !ids.includes(id)));
      saveReadIds(merged);
    }
    setTargets([]);
  };

  if (targets.length === 0) return null;

  const visible = targets.slice(0, MAX_VISIBLE);
  const restCount = targets.length - visible.length;
  const heading =
    targets.length === 1 ? "新しいお知らせがあります" : `新しいお知らせが ${targets.length} 件あります`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-800">{heading}</h2>
          <button
            onClick={markAllReadAndClose}
            aria-label="閉じる"
            className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 divide-y divide-gray-100">
          {visible.map((a) => {
            const cat = ANNOUNCEMENT_CATEGORIES[a.category];
            return (
              <Link
                key={a.id}
                href={`/announcements/${a.id}`}
                onClick={markAllReadAndClose}
                className="block py-3 -mx-2 px-2 rounded-md hover:bg-gray-50"
              >
                <div className="flex items-center gap-2 text-[12px] text-[#6B7280]">
                  {cat && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                      style={{ backgroundColor: cat.bgColor, color: cat.color }}
                    >
                      {cat.icon} {cat.label}
                    </span>
                  )}
                  <span>・</span>
                  <span>{a.publishedAt ? formatJstDate(a.publishedAt) : ""}</span>
                </div>
                <p className="text-sm font-medium text-gray-800 mt-1 break-words">{a.title}</p>
              </Link>
            );
          })}

          {restCount > 0 && (
            <Link
              href="/announcements"
              onClick={markAllReadAndClose}
              className="block py-3 text-[13px] text-[#2563EB] hover:underline"
            >
              他 {restCount} 件
            </Link>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
          <button
            onClick={markAllReadAndClose}
            className="px-4 py-2 text-sm font-medium border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50"
          >
            閉じる
          </button>
          <Link
            href="/announcements"
            onClick={markAllReadAndClose}
            className="px-4 py-2 text-sm font-medium bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8]"
          >
            お知らせ一覧へ
          </Link>
        </div>
      </div>
    </div>
  );
}
