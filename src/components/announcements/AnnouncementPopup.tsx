"use client";

// T-159: 新着お知らせのポップアップ。
// - 最新の公開済みお知らせ 1 件が「公開日〜翌営業日」の範囲内なら表示（src/lib/announcements/display-period.ts）。
// - 閉じる／リンククリックで localStorage に記録し、同じお知らせは二度と出さない（端末単位・DB保存なし）。
// - 認証済み共通レイアウト src/app/(app)/layout.tsx に配置。ログイン画面には出ない。

import { useEffect, useState } from "react";
import Link from "next/link";
import { isWithinDisplayPeriod } from "@/lib/announcements/display-period";
import { todayJstDateString, toJstDateString } from "@/lib/dailyReport/jstDate";

type LatestAnnouncement = {
  id: string;
  title: string;
  publishedAt: string | null;
};

const dismissKey = (id: string) => `announcement-popup-dismissed:${id}`;

export default function AnnouncementPopup() {
  const [announcement, setAnnouncement] = useState<LatestAnnouncement | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/announcements/latest");
        if (!res.ok) return;
        const data = (await res.json()) as { announcement: LatestAnnouncement | null };
        const latest = data.announcement;
        if (cancelled || !latest || !latest.publishedAt) return;

        // 表示期間の判定は JST 日付文字列で行う（罠 #17：toISOString は使わない）
        const publishedJst = toJstDateString(new Date(latest.publishedAt));
        if (!isWithinDisplayPeriod(publishedJst, todayJstDateString())) return;

        // 既に閉じたお知らせは出さない
        try {
          if (window.localStorage.getItem(dismissKey(latest.id))) return;
        } catch {
          // localStorage が使えない環境（プライベートモード等）は毎回表示でよい
        }

        setAnnouncement(latest);
      } catch {
        // ポップアップは補助的な導線なので、取得失敗は無視して何も出さない
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    if (announcement) {
      try {
        window.localStorage.setItem(dismissKey(announcement.id), "1");
      } catch {
        // 記録できなくても閉じる動作自体は成立させる
      }
    }
    setAnnouncement(null);
  };

  if (!announcement) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-800">
            新たなお知らせがアップされました
          </h2>
          <button
            onClick={dismiss}
            aria-label="閉じる"
            className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-gray-800 break-words">{announcement.title}</p>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
          <button
            onClick={dismiss}
            className="px-4 py-2 text-sm font-medium border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50"
          >
            閉じる
          </button>
          <Link
            href="/announcements"
            onClick={dismiss}
            className="px-4 py-2 text-sm font-medium bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8]"
          >
            お知らせを見る
          </Link>
        </div>
      </div>
    </div>
  );
}
