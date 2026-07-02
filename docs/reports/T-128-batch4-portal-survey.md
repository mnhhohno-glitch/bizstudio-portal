# T-128 改修バッチ4: お気に入りメモ・CAコメント・CA質問タスク化 — portal側調査報告

調査日: 2026-07-03 ／ 対象: bizstudio-portal master

---

## 1. お気に入りの保存構造（機能A・B共通）

### 1-1. candidate-site favorites API

**ファイル:** `src/app/api/external/candidate-site/favorites/route.ts`（275行）

3メソッド（GET/POST/DELETE）を同一ファイルで実装。認証は `verifyCandidateSiteKey`（X-Auth-Key）。

#### GET（一覧）

```typescript
// line 69-82
const files = await prisma.candidateFile.findMany({
  where: { candidateId: candidate.id, category: "BOOKMARK", archivedAt: null },
  select: {
    id: true,
    externalJobRef: true,
    sourceType: true,
    origin: true,
    fileName: true,
    memo: true,          // ← 現在 jobUrl の格納に使用
    aiMatchRating: true,
    createdAt: true,
  },
  orderBy: { createdAt: "desc" },
});
```

レスポンス DTO 変換（line 91-102）:

```typescript
const favorites: FavoriteDTO[] = files.map((f) => ({
  id: f.id,
  externalJobRef: f.externalJobRef,
  sourceType: f.sourceType,
  origin: f.origin === "candidate" ? "candidate" : "ca",
  fileName: f.fileName,
  companyName: parseCompanyFromFileName(f.fileName),  // fileName からベストエフォート抽出
  jobUrl: f.memo,                                     // ★ memo を jobUrl として返却
  aiMatchRating: f.aiMatchRating,
  createdAt: f.createdAt.toISOString(),
  applied: f.externalJobRef ? appliedRefs.has(f.externalJobRef) : false,
}));
```

#### POST（本人お気に入り追加）

```typescript
// line 172-188
const created = await prisma.candidateFile.create({
  data: {
    candidateId: candidate.id,
    category: "BOOKMARK",
    fileName,
    fileSize: extractedText ? Buffer.byteLength(extractedText, "utf8") : 0,
    mimeType: "text/plain",
    sourceType: "job-platform",
    externalJobRef,
    origin: "candidate",          // ← 本人追加を明示
    memo: jobUrl,                 // ★ memo に jobUrl を格納
    ...(extractedText ? { extractedText, extractedAt: new Date() } : {}),
    uploadedByUserId: systemUserId,
  },
});
```

#### DELETE（本人お気に入り解除）

- `origin !== "candidate"` は 403（CA追加は本人操作で削除不可・line 232）。
- 物理削除でなくアーカイブ運用（`archivedAt`+`archivedReason: "candidate-unfavorite"`・line 240-242）。

### 1-2. CandidateFile Prisma スキーマ定義（全文）

**ファイル:** `prisma/schema.prisma` line 1402-1445

```prisma
enum CandidateFileCategory {
  RESUME
  WORK_HISTORY
  RECOMMENDATION
  OTHER
  RPA_RESUME
  RPA_WORK_HISTORY
  BS_DOCUMENT
  APPLICATION
  INTERVIEW_PREP
  MEETING
  BOOKMARK
}

model CandidateFile {
  id                String                @id @default(cuid())
  candidateId       String                @map("candidate_id")
  candidate         Candidate             @relation(fields: [candidateId], references: [id])
  folderId          String?               @map("folder_id")
  folder            BSDocumentFolder?     @relation(fields: [folderId], references: [id], onDelete: SetNull)
  category          CandidateFileCategory
  fileName          String                @map("file_name")
  fileSize          Int                   @map("file_size")
  mimeType          String                @map("mime_type")
  sourceType        String?               @map("source_type") // "PDF" / "job-platform"
  externalJobRef    String?               @map("external_job_ref") // job-platform 求人ID
  origin            String?               @map("origin") // null|"ca" / "candidate"
  driveFileId       String?               @map("drive_file_id")
  driveViewUrl      String?               @map("drive_view_url")
  driveFolderId     String?               @map("drive_folder_id")
  memo              String?               @db.Text
  extractedText     String?               @map("extracted_text") @db.Text
  extractedAt       DateTime?             @map("extracted_at")
  aiMatchRating     String?               @map("ai_match_rating")
  aiAnalysisComment String?               @map("ai_analysis_comment") @db.Text
  aiAnalyzedAt      DateTime?             @map("ai_analyzed_at")
  lastExportedAt    DateTime?             @map("last_exported_at")
  lastExportedTo    String?               @map("last_exported_to")
  uploadedByUserId  String                @map("uploaded_by_user_id")
  uploadedBy        User                  @relation("UserCandidateFiles", fields: [uploadedByUserId], references: [id])
  archivedAt        DateTime?             @map("archived_at")
  archivedReason    String?               @map("archived_reason")
  archivedNote      String?               @map("archived_note") @db.Text
  archivedById      String?               @map("archived_by_id")
  archivedBy        User?                 @relation("CandidateFileArchivedBy", fields: [archivedById], references: [id])
  createdAt         DateTime              @default(now()) @map("created_at")
  updatedAt         DateTime              @updatedAt @map("updated_at")

  @@index([candidateId, category, archivedAt])
  @@index([folderId])
  @@index([uploadedByUserId, createdAt])
  @@index([uploadedByUserId, lastExportedAt])
  @@map("candidate_files")
}
```

### 1-3. 求職者メモ・CAコメント用の既存テキスト列の有無

| 列名 | 型 | 現在の用途 | メモ/コメント流用可否 |
|---|---|---|---|
| `memo` | `String? @db.Text` | **jobUrl の格納に使用中**（favorites POST/from-job-platform 両方）。GET では `jobUrl: f.memo` として返却。 | **不可**。流用すると既存の jobUrl データと衝突する。 |
| `extractedText` | `String? @db.Text` | 求人本文の保持（AI分析の入力素材） | 不可。別用途。 |
| `aiAnalysisComment` | `String? @db.Text` | AI求人分析結果の保持 | 不可。別用途。 |
| `archivedNote` | `String? @db.Text` | アーカイブ時の理由メモ | 不可。別用途。 |

**所見:** 求職者メモ（機能A）・CAコメント（機能B）を格納する既存テキスト列は**ない**。以下いずれかの新設が必要:

- 案1: CandidateFile に `candidateNote String? @db.Text` + `caComment String? @db.Text` を追加（nullable ALTER = 無停止）
- 案2: 別テーブル `CandidateFileMemo(id, candidateFileId, authorType["candidate"|"ca"], content, createdAt)` を新設

---

## 2. CAが求人を追加する経路（機能B）

### 2-1. 経路一覧

CAが候補者に求人（BOOKMARK）を追加する経路は**3つ**ある。

| # | 経路 | UI | API | 認証 |
|---|---|---|---|---|
| 1 | PDFアップロード | `HistoryTab.tsx` BookmarkSection 「+ アップロード」ボタン | `POST /api/candidates/[candidateId]/files/upload` | セッション認証 |
| 2 | job-platform検索から追加 | job-platform CA検索UI（portal外） | `POST /api/external/bookmarks/from-job-platform` | `x-api-secret`（JOB_PLATFORM_API_SECRET） |
| 3 | 求職者本人追加 | 求職者サイト | `POST /api/external/candidate-site/favorites` | `X-Auth-Key`（CANDIDATE_SITE_API_KEY） |

### 2-2. 経路1: PDFアップロード（CA操作）

**UI:** `src/components/candidates/HistoryTab.tsx` BookmarkSection（line 681付近）
- ファイル入力ボタン + ドラッグ&ドロップ
- `category: "BOOKMARK"` でマルチパートPOST

**API:** `src/app/api/candidates/[candidateId]/files/upload/route.ts`
- セッション認証（getSessionUser）
- Google Drive 保管 + CandidateFile レコード作成
- origin は設定なし（null = CA追加扱い）

### 2-3. 経路2: job-platform 検索から追加（CA操作・外部API）

**API:** `src/app/api/external/bookmarks/from-job-platform/route.ts`（275行）

```typescript
// line 113-118: 認証
const secret = request.headers.get("x-api-secret");
const expectedSecret = process.env.JOB_PLATFORM_API_SECRET;
if (!expectedSecret || secret !== expectedSecret) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

処理フロー:
1. `candidateId`/`candidateNumber` で候補者解決
2. `savedByUserId` があれば実在＆active 確認 → `uploadedByUserId` に採用（CA本人表示用）
3. `jobs[]` をループし、各求人で:
   - 冪等チェック（同一 candidateId×externalJobRef の既存 BOOKMARK）
   - 既存あり → スナップショット更新（extractedText/fileName/memo）
   - 新規 → CandidateFile 作成 + PDF生成・Drive保管（失敗隔離）
4. `memo` に `jobUrl` を格納（line 188: `const memo = str(j.jobUrl)`）

### 2-4. CAコメント追加の実装時に必要な変更ファイル

機能B「CAが求人追加時にコメントを付ける」を実装する場合:

| 変更対象 | ファイル | 変更内容 |
|---|---|---|
| **スキーマ** | `prisma/schema.prisma` | CandidateFile に `caComment String? @db.Text` 追加（nullable ALTER） |
| **マイグレーション** | `prisma/migrations/` | `ALTER TABLE candidate_files ADD COLUMN ca_comment TEXT` |
| **経路2 API** | `src/app/api/external/bookmarks/from-job-platform/route.ts` | `body.caComment` → create/update に `caComment` 追加 |
| **経路1 API** | `src/app/api/candidates/[candidateId]/files/upload/route.ts` | フォームデータに `caComment` フィールド追加 |
| **経路1 UI** | `src/components/candidates/HistoryTab.tsx` | アップロードモーダルにコメント入力欄追加 |
| **favorites GET** | `src/app/api/external/candidate-site/favorites/route.ts` | select に `caComment` 追加、DTO に `caComment` 追加 |

---

## 3. タスク機構（機能C）

### 3-1. Task Prisma モデル定義（全文）

**ファイル:** `prisma/schema.prisma` line 79-909

#### Enum

```prisma
enum TaskStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
}

enum TaskPriority {
  HIGH
  MEDIUM
  LOW
}

enum TaskFieldType {
  TEXT
  TEXTAREA
  SELECT
  MULTI_SELECT
  DATE
  CHECKBOX
  RADIO
}
```

#### Task 本体（line 803-831）

```prisma
model Task {
  id              String        @id @default(cuid())
  title           String
  description     String?       @db.Text
  categoryId      String?       @map("category_id")
  category        TaskCategory? @relation(fields: [categoryId], references: [id])
  candidateId     String?       @map("candidate_id")
  candidate       Candidate?    @relation(fields: [candidateId], references: [id])
  status          TaskStatus    @default(NOT_STARTED)
  priority        TaskPriority?
  dueDate         DateTime?     @map("due_date")
  createdByUserId String        @map("created_by_user_id")
  createdByUser   User          @relation("TaskCreator", fields: [createdByUserId], references: [id])

  completionType      String  @default("any") @map("completion_type") // "any" or "all"
  notificationPending Boolean @default(false) @map("notification_pending")
  manualSortOrder     Int?    @map("manual_sort_order")

  assignees        TaskAssignee[]
  assigneeStatuses TaskAssigneeStatus[]
  fieldValues      TaskFieldValue[]
  attachments      TaskAttachment[]
  comments         TaskComment[]

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("tasks")
}
```

#### TaskAssignee（line 834-845）

```prisma
model TaskAssignee {
  id         String   @id @default(cuid())
  taskId     String   @map("task_id")
  task       Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  employeeId String   @map("employee_id")
  employee   Employee @relation(fields: [employeeId], references: [id])

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([taskId, employeeId])
  @@map("task_assignees")
}
```

#### TaskAssigneeStatus（line 848-862）

```prisma
model TaskAssigneeStatus {
  id          String    @id @default(cuid())
  taskId      String    @map("task_id")
  task        Task      @relation(fields: [taskId], references: [id], onDelete: Cascade)
  userId      String    @map("user_id")
  user        User      @relation("UserAssigneeStatuses", fields: [userId], references: [id])
  isCompleted Boolean   @default(false) @map("is_completed")
  completedAt DateTime? @map("completed_at")

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([taskId, userId])
  @@index([taskId])
  @@map("task_assignee_statuses")
}
```

#### TaskFieldValue（line 865-875）

```prisma
model TaskFieldValue {
  id      String            @id @default(cuid())
  taskId  String            @map("task_id")
  task    Task              @relation(fields: [taskId], references: [id], onDelete: Cascade)
  fieldId String            @map("field_id")
  field   TaskTemplateField @relation(fields: [fieldId], references: [id])
  value   String            @db.Text

  @@unique([taskId, fieldId])
  @@map("task_field_values")
}
```

#### TaskAttachment（line 878-894）/ TaskComment（line 897-909）

```prisma
model TaskAttachment {
  id               String @id @default(cuid())
  taskId           String @map("task_id")
  task             Task   @relation(fields: [taskId], references: [id], onDelete: Cascade)
  fileName         String @map("file_name")
  fileSize         Int    @map("file_size")
  mimeType         String @map("mime_type")
  storagePath      String @map("storage_path")
  publicUrl        String @map("public_url")
  uploadedByUserId String @map("uploaded_by_user_id")
  uploadedByUser   User   @relation("UploadedAttachments", fields: [uploadedByUserId], references: [id])

  createdAt DateTime @default(now()) @map("created_at")

  @@index([taskId])
  @@map("task_attachments")
}

model TaskComment {
  id      String @id @default(cuid())
  taskId  String @map("task_id")
  task    Task   @relation(fields: [taskId], references: [id], onDelete: Cascade)
  userId  String @map("user_id")
  user    User   @relation("TaskComments", fields: [userId], references: [id])
  content String @db.Text

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("task_comments")
}
```

### 3-2. createOrUpdateResponseTask 実装（全文）

**ファイル:** `src/app/api/external/candidate-response/route.ts` line 124-189

```typescript
const DEDUP_WINDOW_MINUTES = 10; // line 5

async function createOrUpdateResponseTask(candidate: CandidateWithCA) {
  if (!candidate.employee?.userId || !candidate.employee.user) {
    console.warn(
      `求職者 ${candidate.name} に担当CAが設定されていないため、タスク生成をスキップ`
    );
    return;
  }

  const employee = candidate.employee;
  const user = employee.user!;
  const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1000);
  const titlePrefix = `【マイページ回答】${candidate.name}`;

  // 10分以内に同一候補者・同一タイトルプレフィックスで未完了のタスクを探す
  const existingTask = await prisma.task.findFirst({
    where: {
      candidateId: candidate.id,
      title: { startsWith: titlePrefix },
      createdAt: { gte: dedupCutoff },
      status: { not: "COMPLETED" },
    },
    orderBy: { createdAt: "desc" },
  });

  const recentResponses = await prisma.candidateJobResponse.findMany({
    where: {
      candidateId: candidate.id,
      response: { in: ["WANT_TO_APPLY", "INTERESTED"] },
      updatedAt: { gte: existingTask?.createdAt ?? dedupCutoff },
    },
    orderBy: { respondedAt: "desc" },
  });

  if (recentResponses.length === 0) return;

  const jobMap = await fetchJobMap(candidate.candidateNumber);
  const { title, description } = buildTaskContent(
    candidate.name,
    recentResponses,
    jobMap
  );

  if (existingTask) {
    // 既存タスクを更新（10分以内の再回答をまとめる）
    await prisma.task.update({
      where: { id: existingTask.id },
      data: { title, description },
    });
  } else {
    // 新規タスク作成
    const task = await prisma.task.create({
      data: {
        title,
        description,
        candidateId: candidate.id,
        status: "NOT_STARTED",
        priority: "MEDIUM",
        dueDate: new Date(),
        createdByUserId: user.id,
        completionType: "any",
        assignees: {
          create: [{ employeeId: employee.id }],
        },
      },
    });

    // 新規作成時のみ LINE WORKS 通知
    await notifyMypageResponse(task.id, title, candidate.name, employee, user);
  }
}
```

#### 10分 dedup の仕組み

1. `dedupCutoff = now - 10分` を算出
2. `Task.findFirst` で `candidateId` + `title STARTS WITH '【マイページ回答】{名前}'` + `createdAt >= dedupCutoff` + `status != COMPLETED` を検索
3. 該当あり → タスクの title/description を最新の回答リストで **上書き更新**（LINE WORKS 通知は送らない）
4. 該当なし → 新規 Task 作成 + LINE WORKS 通知

#### 機能Cでの流用可否

**流用不可（新規関数が必要）。** 理由:

- `createOrUpdateResponseTask` は `candidateJobResponse` テーブルの回答を集約してタスク description を組み立てる。機能C（質問タスク）は質問テキストを description に入れるため、タスク組み立てロジックが全く異なる。
- タイトルプレフィックス `【マイページ回答】` による dedup は質問タスクには不適合。
- ただし、**タスク作成のパターン**（`prisma.task.create` + `assignees.create` + LINE WORKS 通知）は同形なので、それらをコピーして `createQuestionTask` のような新関数を作るのが妥当。

### 3-3. タスク一覧UI

**ファイル:** `src/app/(app)/tasks/page.tsx`（890行）

- ビューモード: 「自分のタスク」/「依頼中」/「すべて」（管理者のみ）
- フィルタ: ステータス / カテゴリグループ・カテゴリ / 優先度 / 候補者名 / 担当者 / 完了含む
- ソート: ステータス / タイトル / 優先度 / 期限 / 作成日 / カテゴリ（手動並び替え対応）
- 一括操作: 一括完了 / 一括削除
- 20件/ページのページネーション

### 3-4. タスクカテゴリ（種別）一覧

**ファイル:** `prisma/seed.ts` line 436-599

| # | カテゴリ名 | 用途 |
|---|---|---|
| 1 | 履歴書作成 | 志望動機分類（大/中/小）、追加メモ |
| 2 | 職務経歴書作成 | 応募職種、作成ポイント、実績有無、自己PR |
| 3 | 推薦状作成 | 在籍状況、入社時期、年収、人物像、転職理由 |
| 4 | エントリー対応 | エントリー日、件数、コメント |
| 5 | その他 | タスク内容（TEXTAREA） |
| 6 | 日程調整 | 希望日時、面談形式、備考 |

機能Cで「質問対応」カテゴリを新設するか、「その他」に含めるかは要判断。カテゴリ追加は `task_categories` テーブルへの INSERT で済む（スキーマ変更不要）。

---

## 4. LINE WORKS 通知経路（機能C）

### 4-1. 候補者→担当CA→LINE WORKS の解決チェーン

```
Candidate.employeeId → Employee.lineUserId → LINE WORKS API
```

**DB上の解決:**

```typescript
// src/app/api/external/candidate-site/apply/route.ts line 69-72
const ca = await prisma.candidate.findUnique({
  where: { id: candidate.id },
  select: { employee: { select: { name: true, lineUserId: true } } },
});
```

- `Candidate.employeeId` → `Employee` へのリレーション
- `Employee.lineUserId` (String?) → LINE WORKS のユーザーID（メンションに使用）
- `User.lineworksId` (String?) → LINE WORKS のアカウントID（例: `masayuki_oono@bizstudio.co.jp`）。candidate-response の通知ではこちらを使用。

### 4-2. LINE WORKS コア: sendBotMessage

**ファイル:** `src/lib/lineworks.ts`（90行）

```typescript
// line 8-59: JWT認証でアクセストークン取得（5分マージンでキャッシュ）
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.token;
  }
  // LINEWORKS_CLIENT_ID, LINEWORKS_CLIENT_SECRET, LINEWORKS_SERVICE_ACCOUNT, LINEWORKS_PRIVATE_KEY
  // → RS256 JWT assertion → POST https://auth.worksmobile.com/oauth2/v2.0/token
  // → access_token キャッシュ
}

// line 64-89: ボットメッセージ送信
export async function sendBotMessage(
  botId: string,
  channelId: string,
  text: string
): Promise<void> {
  const token = await getAccessToken();
  // POST https://www.worksapis.com/v1.0/bots/{botId}/channels/{channelId}/messages
  // body: { content: { type: "text", text } }
}
```

### 4-3. 応募通知の実装（apply-notification.ts）

**ファイル:** `src/lib/candidate-site/apply-notification.ts`（80行）

```typescript
export async function notifyCandidateApplication(
  params: ApplyNotificationParams
): Promise<boolean> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  // ...
  // caLineworksId があれば <m userId="..."> でメンション
  // 無ければ担当CA名プレフィックスでフォールバック
  await sendBotMessage(botId, channelId, message);
  return true;
}
```

### 4-4. candidate-response のタスク通知（notifyMypageResponse）

**ファイル:** `src/app/api/external/candidate-response/route.ts` line 275-327

```typescript
async function notifyMypageResponse(
  taskId: string, title: string, candidateName: string,
  employee: { name: string },
  user: { lineworksId: string | null }
) {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL;
  if (!botId || !channelId) return;

  const lines = [
    "📋 マイページ回答タスクが自動生成されました",
    "", "■ タイトル", title,
    "", "■ 求職者", `${candidateName} 様`,
    "", "■ 担当者", employee.name,
    "", "■ ステータス", "未着手",
    "", "🔗 タスク詳細", `${baseUrl}/tasks/${taskId}`,
  ];

  // user.lineworksId があれば <m userId="..."> でメンション
  if (user.lineworksId) {
    // メンション付きで送信 → 失敗時はメンションなしで再送
  }
  await sendBotMessage(botId, channelId, lines.join("\n"));
}
```

### 4-5. 機能Cでの流用方法

`notifyCandidateApplication`（apply用）と `notifyMypageResponse`（タスク生成用）の**両方のパターンが参考になる**。

質問タスク通知は `notifyMypageResponse` と同形で実装可能:
1. `sendBotMessage` を import
2. `LINEWORKS_TASK_BOT_ID` / `LINEWORKS_TASK_CHANNEL_ID` で同一チャンネルに送信
3. メンションは `employee.lineUserId`（apply系）または `user.lineworksId`（response系）で解決。**2つの ID が微妙に異なる点に注意**:
   - `Employee.lineUserId` → メッセージ送信API向け
   - `User.lineworksId` → メンション向け（例: `masayuki_oono@bizstudio.co.jp`）

**要確認:** apply 系は `Employee.lineUserId` を使い、response 系は `User.lineworksId` を使う。どちらが正しいか（あるいは同値か）は Employee/User テーブルの実データで確認が必要。

### 4-6. 環境変数一覧

| 変数名 | 用途 |
|---|---|
| `LINEWORKS_CLIENT_ID` | JWT 認証 |
| `LINEWORKS_CLIENT_SECRET` | JWT 認証 |
| `LINEWORKS_SERVICE_ACCOUNT` | JWT assertion の sub |
| `LINEWORKS_PRIVATE_KEY` | RS256 署名 |
| `LINEWORKS_TASK_BOT_ID` | タスク通知ボットID |
| `LINEWORKS_TASK_CHANNEL_ID` | タスク通知チャンネルID |
| `PORTAL_BASE_URL` | 通知メッセージ内リンク用 |

---

## 5. AI呼び出しの現状（機能C）

### 5-1. AI API 利用一覧

#### Claude（Anthropic SDK）

**設定ファイル:** `src/lib/claude.ts`（32行）

```typescript
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const CLAUDE_MODEL_DEFAULT = "claude-sonnet-4-6";     // 汎用
export const CLAUDE_MODEL_ANALYSIS = "claude-opus-4-6";      // 求人分析（高価値）
export const CLAUDE_MODEL_LIGHT = "claude-haiku-4-5";        // 軽処理（OCR等）
```

| # | ファイル | 用途 | モデル |
|---|---|---|---|
| 1 | `src/app/api/daily-report/chat/route.ts` | 日報チャット | CLAUDE_MODEL_DEFAULT |
| 2 | `src/app/api/daily-report/assist/route.ts` | 日報AI補助（T-069③） | CLAUDE_MODEL_DEFAULT |
| 3 | `src/app/api/schedule/chat/route.ts` | スケジュールチャット | CLAUDE_MODEL_DEFAULT |
| 4 | `src/app/api/schedule/review/route.ts` | 前日振り返り・翌日計画 | CLAUDE_MODEL_DEFAULT |
| 5 | `src/app/api/rpa-error/chat/[chatId]/message/route.ts` | RPAエラー対応チャット | CLAUDE_MODEL_DEFAULT |
| 6 | `src/app/api/candidates/[candidateId]/bookmarks/analyze-batch/route.ts` | 求人AI分析（T-123） | CLAUDE_MODEL_ANALYSIS |

環境変数: `ANTHROPIC_API_KEY`

#### Gemini（REST API直接呼び出し）

**設定ファイル:** `src/lib/ai/gemini-client.ts`（181行・**変更禁止ファイルではない**）

```typescript
const MODEL_NAME = "gemini-3-flash-preview";
// generateWithGemini(), generateWithGeminiWithPdf(), generateWithGeminiWithImage(), parseJsonResponse()
```

| # | ファイル | 用途 | モデル |
|---|---|---|---|
| 1 | `src/app/api/interviews/analyze/route.ts` | 面談ログ分析 | gemini-3-flash-preview |
| 2 | `src/app/api/ai/health/route.ts` | AIヘルスチェック | gemini-3-flash-preview |
| 3 | `src/lib/gemini-resume-parser.ts` | 履歴書PDF解析 | gemini-3-flash-preview |
| 4 | `src/app/api/guides/parse-resume/route.ts` | ガイド履歴書解析 | gemini-3-flash-preview |
| 5 | `src/app/api/guides/generate-axis/route.ts` | ガイド軸生成 | gemini-3-flash-preview |

環境変数: `GEMINI_API_KEY`

#### OpenAI

| # | ファイル | 用途 | モデル |
|---|---|---|---|
| 1 | `src/app/api/candidates/[candidateId]/summarize-end-comment/route.ts` | 支援終了コメント要約 | gpt-5.4 |
| 2 | `src/app/api/entries/generate-end-notice/route.ts` | お見送り文面生成 | GPT系 |

環境変数: `OPENAI_API_KEY`

### 5-2. 変更禁止ファイルの流用可否

| ファイル | 変更禁止 | import可否 |
|---|---|---|
| `src/services/geminiClient.ts` | **はい** | **要確認** — `src/lib/ai/gemini-client.ts` とは別ファイル。services 版の存在と内容を要確認。 |
| `src/lib/ai/gemini-client.ts` | いいえ | **可** — `generateWithGemini()` を import して使える。 |
| `src/lib/claude.ts` | いいえ | **可** — `anthropic` + `CLAUDE_MODEL_LIGHT` を import して使える。 |
| `loadSpec.ts` | **はい** | 読み取り専用。YAML prompt spec ローダー。 |
| `candidate-flags.ts` | **はい** | 無関係。 |

### 5-3. 質問要約の推奨実装位置

**推奨: portal API内**（例: `src/app/api/external/candidate-site/questions/route.ts` 内で直接呼出）

理由:
1. **キー管理**: portal には `ANTHROPIC_API_KEY`（Claude）と `GEMINI_API_KEY`（Gemini）の両方が既に設定済み。mypage BFF 側にはどちらもない（要確認）。
2. **既存パターン**: portal の全AI呼び出しは portal API 内で完結（外部BFFに委譲しているものはない）。
3. **コスト**: 質問要約は 1コール・短文。Claude Haiku (`CLAUDE_MODEL_LIGHT` = $1/$5 per 1M) が最安かつ十分。Gemini Flash でも可だが Claude の方が SDK が整備されていて呼び出しが簡素。

**推奨実装コード（概要）:**

```typescript
import { anthropic, CLAUDE_MODEL_LIGHT } from "@/lib/claude";

const summary = await anthropic.messages.create({
  model: CLAUDE_MODEL_LIGHT,
  max_tokens: 200,
  messages: [{ role: "user", content: `以下の質問を1-2文で要約:\n\n${questionText}` }],
});
```

---

## 6. candidate-site API群の認証・追加余地

### 6-1. 認証ヘルパー

**ファイル:** `src/lib/candidate-site-auth.ts`（63行）

```typescript
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export const CANDIDATE_SITE_AUTH_HEADER = "x-auth-key";

export function verifyCandidateSiteKey(request: Request): boolean {
  const expected = process.env.CANDIDATE_SITE_API_KEY;
  if (!expected) return false;        // fail-closed: キー未設定 → 全拒否
  const provided = request.headers.get(CANDIDATE_SITE_AUTH_HEADER);
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);     // タイミング攻撃対策
  } catch {
    return false;
  }
}

export type ScopedCandidate = { id: string; candidateNumber: string; name: string };

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export async function resolveScopedCandidate(input: {
  candidateId?: unknown;
  candidateNumber?: unknown;
}): Promise<ScopedCandidate | null> {
  const idRaw = str(input.candidateId);
  const numRaw = str(input.candidateNumber);
  const key = idRaw ?? numRaw;
  if (!key) return null;

  const candidate = await prisma.candidate.findFirst({
    where: idRaw
      ? { id: idRaw }
      : key.startsWith("cm")
        ? { id: key }
        : { candidateNumber: key },
    select: { id: true, candidateNumber: true, name: true },
  });
  return candidate;
}
```

### 6-2. IDすり替え防止

`resolveScopedCandidate` は入力から**1名の候補者**を解決し `{ id, candidateNumber, name }` を返す。以降の全クエリで `candidateId: candidate.id` を WHERE 条件に含めることで、他候補者のデータへのアクセスを防止。

### 6-3. 既存エンドポイント一覧と共通パターン

| エンドポイント | メソッド | ファイル |
|---|---|---|
| `/api/external/candidate-site/apply` | POST | `src/app/api/external/candidate-site/apply/route.ts` |
| `/api/external/candidate-site/favorites` | GET/POST/DELETE | `src/app/api/external/candidate-site/favorites/route.ts` |
| `/api/external/candidate-site/preferences` | GET | `src/app/api/external/candidate-site/preferences/route.ts` |
| `/api/external/candidate-site/applications` | GET | `src/app/api/external/candidate-site/applications/route.ts` |

**共通パターン（全4エンドポイントで完全統一）:**

```typescript
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";

export async function POST(request: Request) {
  // 1. 認証（fail-closed）
  if (!verifyCandidateSiteKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. ボディ解析
  const body = await request.json();

  // 3. 候補者スコープ解決
  const candidate = await resolveScopedCandidate({
    candidateId: body.candidateId,
    candidateNumber: body.candidateNumber,
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // 4. ビジネスロジック（全クエリで candidateId: candidate.id を WHERE に含める）
  // ...

  // 5. レスポンス（ホワイトリスト方式・内部運用情報を返さない）
  return NextResponse.json({ ok: true, ... });
}
```

### 6-4. 新規エンドポイント追加時のチェックリスト

1. `verifyCandidateSiteKey(request)` → 401
2. `resolveScopedCandidate()` → 404
3. 全 DB クエリに `candidateId: candidate.id` 制約
4. レスポンスはホワイトリスト方式（内部データを返さない）
5. 冪等性の検討（重複リクエストの扱い）
6. `str()` ヘルパーで入力サニタイズ（null/undefined/空文字）
7. `{ ok: true, ... }` / `{ ok: false, reason: ... }` のレスポンス形式

---

## まとめ: 機能A・B・C 実装時の変更ファイル一覧

### 機能A: 求職者お気に入りメモ

| 変更対象 | ファイル | 内容 |
|---|---|---|
| スキーマ | `prisma/schema.prisma` | CandidateFile に `candidateNote String? @db.Text` 追加 |
| マイグレーション | `prisma/migrations/` | ALTER TABLE |
| favorites POST API | `src/app/api/external/candidate-site/favorites/route.ts` | body から `candidateNote` を受け取り create に追加 |
| favorites GET API | 同上 | select に `candidateNote` 追加、DTO に `candidateNote` フィールド追加 |
| ※ portal UI | 変更不要（求職者サイト側の UI は別リポ） | - |

### 機能B: CAコメント

| 変更対象 | ファイル | 内容 |
|---|---|---|
| スキーマ | `prisma/schema.prisma` | CandidateFile に `caComment String? @db.Text` 追加 |
| マイグレーション | `prisma/migrations/` | ALTER TABLE |
| from-job-platform API | `src/app/api/external/bookmarks/from-job-platform/route.ts` | `body.caComment` 受取→保存 |
| files/upload API | `src/app/api/candidates/[candidateId]/files/upload/route.ts` | フォームデータから `caComment` 受取 |
| HistoryTab UI | `src/components/candidates/HistoryTab.tsx` | アップロードモーダルにコメント入力欄追加 |
| favorites GET API | `src/app/api/external/candidate-site/favorites/route.ts` | select/DTO に `caComment` 追加 |

### 機能C: 質問タスク化 + LINE WORKS通知

| 変更対象 | ファイル | 内容 |
|---|---|---|
| 新規API | `src/app/api/external/candidate-site/questions/route.ts` | POST 質問受付。AI要約（Claude Haiku）→ Task 作成 → LINE WORKS 通知。既存パターン踏襲。 |
| タスクカテゴリ | DB seed or 直接INSERT | 「質問対応」カテゴリの新設（任意。「その他」でも可） |
| LINE WORKS通知 | 新規 or 既存流用 | `sendBotMessage` を import し `LINEWORKS_TASK_BOT_ID`/`LINEWORKS_TASK_CHANNEL_ID` で送信。`notifyMypageResponse` と同形。 |
| スキーマ | 変更なし（既存 Task モデルで十分） | title/description に質問内容・AI要約を格納。assignees に担当CA。 |
| ※ 求職者サイト側 | 別リポ | 質問入力UI + POST 呼び出し |
