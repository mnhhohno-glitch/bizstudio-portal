-- T-196: 日程調整フォームの返信をマイナビのメッセージでも送るための持ち回り列（すべて nullable・既存行は影響なし）
ALTER TABLE "tasks" ADD COLUMN     "mynavi_reply_text" TEXT,
ADD COLUMN     "mynavi_reply_subject" TEXT,
ADD COLUMN     "mynavi_reply_member_no" TEXT,
ADD COLUMN     "mynavi_reply_sent_at" TIMESTAMP(3),
ADD COLUMN     "mynavi_reply_skip_reason" TEXT;
