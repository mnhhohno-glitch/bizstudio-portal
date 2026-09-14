-- T-196 追補: 送信結果が不明（要目視確認）の打刻。nullable・既存行は影響なし
ALTER TABLE "tasks" ADD COLUMN     "mynavi_reply_unconfirmed_at" TIMESTAMP(3);
