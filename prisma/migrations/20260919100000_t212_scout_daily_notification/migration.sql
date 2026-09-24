-- T-212: 朝の「本日の配信条件」まとめ通知を JST 1日1回に抑えるための送信済みマーク。
--   07:00 以降に最初に GET /api/external/scout-conditions/current を呼んだ号機だけが
--   その日の行を INSERT でき、その1回だけ LINE WORKS へ全号機分のまとめを送る。
--   新規テーブルの追加のみ（既存テーブル・既存レコードには触れない）。
CREATE TABLE "scout_daily_notifications" (
    "date" DATE NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_daily_notifications_pkey" PRIMARY KEY ("date")
);
