-- 研修メニュー第2弾: クイズ回答履歴の記録
-- 追加系のみ（nullable カラム1 + 新規テーブル2）。既存テーブル・既存レコードへの破壊的変更なし。

-- AlterTable
ALTER TABLE "training_materials" ADD COLUMN     "quizKey" TEXT;

-- CreateTable
CREATE TABLE "training_quiz_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "quizKey" TEXT NOT NULL,
    "quizTitle" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "cleared" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_quiz_answers" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "qid" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "chosenText" TEXT NOT NULL,
    "correctText" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "training_quiz_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_quiz_attempts_userId_quizKey_idx" ON "training_quiz_attempts"("userId", "quizKey");

-- CreateIndex
CREATE INDEX "training_quiz_attempts_quizKey_createdAt_idx" ON "training_quiz_attempts"("quizKey", "createdAt");

-- CreateIndex
CREATE INDEX "training_quiz_answers_attemptId_idx" ON "training_quiz_answers"("attemptId");

-- CreateIndex
CREATE INDEX "training_quiz_answers_qid_isCorrect_idx" ON "training_quiz_answers"("qid", "isCorrect");

-- AddForeignKey
ALTER TABLE "training_quiz_answers" ADD CONSTRAINT "training_quiz_answers_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "training_quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
