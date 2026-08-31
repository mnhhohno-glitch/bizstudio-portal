-- T-185: セキュアファイル送信のテンプレート（宛先テンプレート＋担当者＋文面テンプレート）
-- 新規テーブル3つの追加のみ。既存テーブルへの変更は一切含めない。
-- （migrate diff の出力に含まれた scout_* 系の DROP DEFAULT は本件と無関係な既存ドリフトのため除外した）

-- CreateTable
CREATE TABLE "secure_transfer_recipient_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_name" TEXT,
    "memo" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secure_transfer_recipient_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secure_transfer_recipient_contacts" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "default_field" TEXT NOT NULL DEFAULT 'TO',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "secure_transfer_recipient_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secure_transfer_message_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signature" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secure_transfer_message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "secure_transfer_recipient_templates_is_archived_idx" ON "secure_transfer_recipient_templates"("is_archived");

-- CreateIndex
CREATE INDEX "secure_transfer_recipient_templates_company_name_idx" ON "secure_transfer_recipient_templates"("company_name");

-- CreateIndex
CREATE INDEX "secure_transfer_recipient_contacts_template_id_idx" ON "secure_transfer_recipient_contacts"("template_id");

-- CreateIndex
CREATE INDEX "secure_transfer_message_templates_is_archived_idx" ON "secure_transfer_message_templates"("is_archived");

-- AddForeignKey
ALTER TABLE "secure_transfer_recipient_contacts" ADD CONSTRAINT "secure_transfer_recipient_contacts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "secure_transfer_recipient_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
