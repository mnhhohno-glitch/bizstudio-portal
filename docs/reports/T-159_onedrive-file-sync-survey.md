# T-159 Phase 1: portal のファイルを OneDrive へ自動コピーする仕組み 調査報告

- 対象: `bizstudio-portal` master（`acad168` 時点）
- 調査日: 2026-08-17
- 実測データ源: 本番 Postgres（master worktree の `.env` の `DATABASE_URL` = 本番 proxy 直結・**SELECT のみ**）
- 本書は**調査のみ**。コードの変更・追加・DB への書き込みは行っていない。Graph API への実接続テストも行っていない。

> **表記ルール**: 【実測】は本番 DB / 実コードから取得した値。【推測】は検証していない見積もり。

---

## 0. 結論サマリ

| 問い | 結論 |
|--|--|
| upload route に処理を差し込めるか | **差し込める。**Drive アップロード成功（153行）→ CandidateFile 作成（161行）→ レスポンス（200行）が直列に並んでおり、間に任意の処理を入れられる。既存の `recalculateSubStatusIfAuto`（192-198行）が「失敗を握り潰して本流を止めない」前例として同じ位置にある |
| ファイル本体のバイト列は手元に残るか | **残る。**`upload/route.ts:152` の `fileBuffer`（`Buffer`）が Drive アップロード後もスコープ内に生存。**Drive から再取得は不要**。ただし後述の**再試行経路では手元に無い**ため `downloadFileFromDrive()` での再取得が必須 |
| OneDrive のパスを URL から復元できるか | **1734件中1734件（100%）成功。失敗パターンは0件。**`%2E`/`%5F`/`%20` はすべて正しく戻る。UPN も全件 `masayuki_oono_bizstudio_co_jp` の1種類 |
| パス保持方式の推奨 | **都度復元。**`Candidate` に列を足さない。実際に書いた先は `OneDriveSyncLog.targetPath` に記録して監査可能にする |
| Microsoft / Azure / Graph の既存実装 | **ゼロ。**`src/` 配下に `graph.microsoft` / `AZURE_` / `MSAL` / `tenant` の実装は1件も無い。`package.json` に Microsoft 系依存も無い。**全部これから作る** |
| 定期実行の基盤 | **Railway cron は使っていない。GitHub Actions cron + `/api/internal/*` + `INTERNAL_API_KEY` が既存パターン**（稼働中4本）。同じ形に乗せられる |
| 想定実装規模 | 新規6ファイル約555行 / 変更8ファイル約143行 |

### 稼働後の流量【実測・直近30日】

| カテゴリ | 新規件数 | うち OneDrive 登録済み求職者 | うち Drive 実体あり（＝コピー可能） |
|--|--|--|--|
| BOOKMARK | 1,899 | 1,574 | 1,502 |
| BS_DOCUMENT | 221 | 187 | 187 |
| **合計** | **2,120** | **1,761** | **1,689** |

→ **1日あたり約56件**のコピーが走る想定。

---

## Step 1: portal 側のファイルアップロード経路

### 1-1. `src/app/api/candidates/[candidateId]/files/upload/route.ts`

#### リクエストの受け取り形式（83-90行）

```ts
// upload/route.ts:83-90
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const category = formData.get("category") as string | null;
  const memo = formData.get("memo") as string | null;
  const folderIdRaw = formData.get("folderId") as string | null;
  // T-152: 面談画面の専用アップロード欄からのみ渡される任意パラメータ。
  // 渡された場合のみ「この面談のログ」として紐付ける。既存の添付タブ経由は従来どおり null。
  const interviewIdRaw = formData.get("interviewId") as string | null;
```

`multipart/form-data`。**1リクエスト＝1ファイル**。複数選択時はクライアント（`FileUploadModal.tsx:149-159`）が **for ループで1件ずつ直列に POST** している。

```tsx
// FileUploadModal.tsx:149-160
    for (let i = 0; i < selectedFiles.length; i++) {
      setUploadProgress({ current: i + 1, total: selectedFiles.length });
      try {
        const formData = new FormData();
        formData.append("file", selectedFiles[i]);
        formData.append("category", category);
        if (effectiveFolderId) formData.append("folderId", effectiveFolderId);
        if (memo.trim()) formData.append("memo", memo.trim());

        const res = await fetch(`/api/candidates/${candidateId}/files/upload`, {
          method: "POST",
```

→ **同期コピーにするとファイル数ぶんレイテンシが直線的に積み上がる**（10ファイル同時アップ＝10回ぶんの Graph 往復が待ち時間に加算）。論点1の判断根拠。

#### Google Drive へのアップロード処理（142-158行）

```ts
// upload/route.ts:142-158
  try {
    const parentFolderId = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID;
    if (!parentFolderId) {
      return withCors(NextResponse.json({ error: "GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID が未設定です" }, { status: 500 }), origin);
    }

    // 求職者フォルダを取得or作成
    const candidateFolderId = await getOrCreateFolder(candidateId, parentFolderId);

    // アップロード
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { fileId, webViewLink } = await uploadFileToDrive(
      file.name,
      fileBuffer,
      candidateFolderId,
      file.type
    );
```

**152行の `fileBuffer` がキモ**。`const` でローカルに束縛され、以降 200行のレスポンス返却まで（さらに fire-and-forget のクロージャに渡せば `await` を跨いでも）生存する。

#### `CandidateFile` レコード作成（160-177行）

```ts
// upload/route.ts:160-177
    // DB保存
    const record = await prisma.candidateFile.create({
      data: {
        candidateId,
        category: category as CandidateFileCategory,
        folderId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        driveFileId: fileId,
        driveViewUrl: webViewLink,
        driveFolderId: candidateFolderId,
        memo: memo?.trim() || null,
        interviewId,
        uploadedByUserId: userId,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
```

#### 差し込み可能ポイント（192-203行）

```ts
// upload/route.ts:192-203
    if (record.category === "BOOKMARK") {
      try {
        await recalculateSubStatusIfAuto(candidateId);
      } catch (e) {
        console.error("[files.upload] recalculateSubStatusIfAuto failed:", e);
      }
    }

    return withCors(
      NextResponse.json({ file: record }, { status: 201 }),
      origin
    );
```

**結論: 「Drive へのアップロード成功後、レスポンス返却前」に処理を差し込める構造になっている。**
192-198行が既に「レコード作成後・レスポンス前に副作用を走らせ、失敗しても `console.error` だけで本流を止めない」という**まさに求められている形の前例**として存在する。ここの直後（198行と200行の間）に1ブロック足すだけで済む。

#### エラー時のロールバック

**ロールバックは無い**（204-210行）。

```ts
// upload/route.ts:204-210
  } catch (e) {
    console.error("File upload error:", e);
    return withCors(
      NextResponse.json({ error: "ファイルアップロードに失敗しました" }, { status: 500 }),
      origin
    );
  }
```

`try` は 142行から始まり、Drive アップロードと DB 保存の両方を包んでいる。**DB 保存が失敗しても Drive 上のファイルは削除されない**（孤児ファイルが残る）。逆に Drive 成功後の後続処理が throw すれば 500 が返るが Drive にはファイルが残る。
→ **OneDrive コピーをこの `try` の内側で素直に `await` すると、Graph の失敗が portal のアップロード失敗（500）に化ける。**「portal のアップロードが OneDrive の不調で失敗してはいけない」制約を満たすには、必ず独立した `try/catch` か fire-and-forget で隔離する必要がある。

### 1-2. `src/lib/google-drive.ts`

#### アップロード関数のシグネチャ（27-53行）

```ts
// google-drive.ts:27-53
export async function uploadFileToDrive(
  fileName: string,
  fileBuffer: Buffer,
  folderId?: string,
  mimeType: string = "application/pdf",
  makePublic: boolean = true
): Promise<{ fileId: string; webViewLink: string }> {
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  const targetFolderId = folderId || process.env.GOOGLE_DRIVE_MANUAL_FOLDER_ID;
  if (!targetFolderId) {
    throw new Error("アップロード先フォルダが指定されていません");
  }

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [targetFolderId],
    },
    media: {
      mimeType,
      body: Readable.from(fileBuffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
```

**ファイル本体は `Buffer` で受け取る**（引数 `fileBuffer: Buffer`）。関数内で `Readable.from(fileBuffer)` により Stream 化しているが、これは googleapis に渡すための一時的な変換で、**呼び出し側の `Buffer` は消費されない**（`Readable.from` は元の Buffer を参照するだけ）。

#### 結論: バイト列は手元に残るか

**残る。**呼び出し側（`upload/route.ts:152`）で作った `fileBuffer` は `uploadFileToDrive` 呼び出し後もそのまま使える。**Drive からの再取得は不要**。

ただし2点の留保:

1. **再試行経路では手元に無い。**夜間バッチが FAILED を拾い直すとき、リクエストはとっくに終わっているので Buffer は存在しない。この場合は既存の `downloadFileFromDrive(driveFileId)`（134-156行）で Drive から再取得する必要がある。ただしこの関数は **base64 文字列を返す実装**で、20MB のファイルなら base64 で約27MB の文字列がメモリに乗る。

```ts
// google-drive.ts:134-156
export async function downloadFileFromDrive(
  fileId: string
): Promise<{ base64: string; mimeType: string }> {
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  const metaResponse = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });
  const mimeType = metaResponse.data.mimeType || "application/octet-stream";

  const contentResponse = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );

  const buffer = Buffer.from(contentResponse.data as ArrayBuffer);
  const base64 = buffer.toString("base64");

  return { base64, mimeType };
}
```

2. **`driveFileId = null` の行は再取得すらできない。**サイト経由（`favorites`）・job-platform 由来の一部は Drive 実体を持たない（直近30日で95件）。これは恒久的にコピー不能＝スキップ扱いにするしかない。

### 1-3. `prisma/schema.prisma` の `CandidateFile`

#### enum（1440-1448行）

```prisma
enum CandidateFileCategory {
  ORIGINAL
  JOB_POSTING
  BS_DOCUMENT
  APPLICATION
  INTERVIEW_PREP
  MEETING
  BOOKMARK
}
```

#### 全フィールド（1450-1555行・コメント一部省略なし）

```prisma
model CandidateFile {
  id                String                @id @default(cuid())
  candidateId       String                @map("candidate_id")
  candidate         Candidate             @relation(fields: [candidateId], references: [id])
  folderId          String?               @map("folder_id")
  folder            BSDocumentFolder?     @relation(fields: [folderId], references: [id], onDelete: SetNull)
  interviewId       String?               @map("interview_id")
  interview         InterviewRecord?      @relation("InterviewMeetingFiles", fields: [interviewId], references: [id], onDelete: SetNull)
  advisorIngestedAt DateTime?             @map("advisor_ingested_at")
  category          CandidateFileCategory
  fileName          String                @map("file_name")
  fileSize          Int                   @map("file_size")
  mimeType          String                @map("mime_type")
  sourceType        String?               @map("source_type") // "PDF" / "job-platform"
  externalJobRef    String?               @map("external_job_ref") // job-platform 求人ID
  kyuujinJobId      Int?                  @map("kyuujin_job_id")
  responseStatus          String?   @map("response_status")
  responseStatusUpdatedAt DateTime? @map("response_status_updated_at")
  responseSubmittedAt     DateTime? @map("response_submitted_at")
  caMatchLabel            String?   @map("ca_match_label")
  introducedAt            DateTime? @map("introduced_at")
  excludedBy              String?   @map("excluded_by")
  excludedAt              DateTime? @map("excluded_at")
  responseSubmissionItems CandidateResponseSubmissionItem[]
  sourceMedia       String?               @map("source_media")
  jobTitle          String?               @map("job_title")
  jobCategory       String?               @map("job_category")
  platformSubmittedAt DateTime?           @map("platform_submitted_at")
  origin            String?               @map("origin") // null|"ca" / "candidate"
  candidateNote     String?               @map("candidate_note") @db.Text
  caComment         String?               @map("ca_comment") @db.Text
  displayOverrides  Json?                 @map("display_overrides")
  displayOrder      Int?                  @map("display_order")
  pickedUpAt        DateTime?             @map("picked_up_at")
  driveFileId       String?               @map("drive_file_id")
  driveViewUrl      String?               @map("drive_view_url")
  driveFolderId     String?               @map("drive_folder_id")
  memo              String?               @db.Text
  extractedText     String?               @map("extracted_text") @db.Text
  extractedAt       DateTime?             @map("extracted_at")
  parsedText    String?   @map("parsed_text") @db.Text
  parsedAt      DateTime? @map("parsed_at")
  parseFailedAt DateTime? @map("parse_failed_at")
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

  @@unique([candidateId, kyuujinJobId])
  @@index([candidateId, category, archivedAt])
  @@index([interviewId])
  @@index([folderId])
  @@index([uploadedByUserId, createdAt])
  @@index([uploadedByUserId, lastExportedAt])
  @@map("candidate_files")
}
```

**列数は 50 列。**すでに相当肥大している。論点2で「新規テーブル」を推す根拠のひとつ。

#### `BS_DOCUMENT` のフォルダ階層モデル（1593-1606行）

**`CandidateFile` の自己参照ではなく、専用テーブル `BSDocumentFolder` がある。**

```prisma
model BSDocumentFolder {
  id          String   @id @default(cuid())
  candidateId String   @map("candidate_id")
  name        String
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  candidate Candidate       @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  files     CandidateFile[]

  @@index([candidateId])
  @@map("bs_document_folders")
}
```

**1階層のみ**（`parentId` が無い＝ネストしない）。`CandidateFile.folderId` が NULL ならルート直下。

フォルダ指定は upload route で BS_DOCUMENT のみ許可されている（115-126行）:

```ts
// upload/route.ts:115-126
  // BS作成書類のみフォルダ指定を許可。それ以外のカテゴリでは folderId は無視（ルート直下扱い）
  let folderId: string | null = null;
  if (category === "BS_DOCUMENT" && folderIdRaw && folderIdRaw.trim()) {
    const folder = await prisma.bSDocumentFolder.findFirst({
      where: { id: folderIdRaw.trim(), candidateId },
      select: { id: true },
    });
    if (!folder) {
      return withCors(NextResponse.json({ error: "指定されたフォルダが見つかりません" }, { status: 400 }), origin);
    }
    folderId = folder.id;
  }
```

**【実測】BS_DOCUMENT のフォルダ利用状況**（全期間）:

| 項目 | 件数 |
|--|--|
| BS_DOCUMENT 総数 | 935 |
| うち `folder_id` あり（サブフォルダ配下） | 174（18.6%） |
| うちルート直下 | 761（81.4%） |

**フォルダ名は完全に自由記述**で、実データは統一されていない。上位サンプル（すべて n=1）:

```
パーソルBPD / 業務改善 / 営業向け / フレッシュフード / 人事 /
サムティプロパティマネジメント / ユニテック・ジャパン株式会社 / エムシーヘルスケア /
株式会社ウィルシード / ③現職のIT経験を生かした別職種（営業、コンサル系） ④全くの未開拓の領域（ITとは別業種の営業系） /
マーケティング営業 / 営業事務 / 職務経歴書 / ポピンズエデュケア: / 履歴書
```

**うち1件（`ポピンズエデュケア:`）は末尾に `:` を含み、OneDrive / Windows のフォルダ名禁則文字に該当する。**論点4の判断根拠。

### 1-4. `BOOKMARK` / `BS_DOCUMENT` が作られる経路の全数

`prisma.candidateFile.create` / `createMany` / `upsert` を `src/` 全体で grep した結果、**作成箇所は6か所のみ**。

| # | 経路 | カテゴリ | Drive 実体 | Buffer が手元にあるか | 直近30日の件数【実測】 |
|--|--|--|--|--|--|
| 1 | `files/upload/route.ts:161` | 全カテゴリ（CA手動アップ） | あり | **あり**（152行 `fileBuffer`） | BOOKMARK 422 / BS_DOCUMENT 187 |
| 2 | `external/bookmarks/from-job-platform/route.ts:228` | BOOKMARK | 後段の `generateAndStorePdf` で生成 | **あり**（34行 `pdfBuffer`） | 1,380 |
| 3 | `external/candidate-site/favorites/route.ts:267` | BOOKMARK | **無し**（`driveFileId: null` 固定） | 無し | 79（本人お気に入り） |
| 4 | `lib/mypage-response-sync.ts:488` | BOOKMARK | **無し**（`driveFileId: null` 固定） | 無し | （3に内包） |
| 5 | `tasks/[taskId]/attachments/save-to-candidate/route.ts:60` | ORIGINAL/BS_DOCUMENT/APPLICATION/INTERVIEW_PREP/MEETING | あり | **あり**（49行 `buffer`） | （BS_DOCUMENT 187 に内包） |
| 6 | `rpa/mynavi/pdf-upload/route.ts:395` | MEETING 固定 | あり | あり | 対象外 |

#### 経路2（job-platform 由来）— **BOOKMARK の 73%を占める最大経路**

```ts
// from-job-platform/route.ts:14-55（PDF生成 → Drive保管）
async function generateAndStorePdf(params: {
  fileId: string;
  candidateId: string;
  sid: string;
  fileName: string;
}): Promise<void> {
  const parentFolderId = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID;
  if (!parentFolderId) throw new Error("GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID 未設定");

  // 1) pdf-service からPDFバイナリ取得（タイムアウト付き）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_GEN_TIMEOUT_MS);
  let pdfBuffer: Buffer;
  try {
    const token = process.env.PDF_SERVICE_TOKEN;
    const res = await fetch(`${PDF_SERVICE_URL}/generate?sid=${encodeURIComponent(params.sid)}`, {
      signal: controller.signal,
      ...(token ? { headers: { "x-api-token": token } } : {}),
    });
    if (!res.ok) throw new Error(`pdf-service responded ${res.status}`);
    pdfBuffer = Buffer.from(await res.arrayBuffer());
    if (pdfBuffer.length === 0) throw new Error("pdf-service returned empty body");
  } finally {
    clearTimeout(timer);
  }

  // 2) 既存の保管プラミングで求職者フォルダ（candidateId 名）へアップロード（既存ブックマークと同一場所）
  const folderId = await getOrCreateFolder(params.candidateId, parentFolderId);
  const { fileId: driveFileId, webViewLink } = await uploadFileToDrive(params.fileName, pdfBuffer, folderId, "application/pdf");

  // 3) CandidateFile を更新（fileName/extractedText/sourceType 等は維持・PDF実体情報のみ追加）
  await prisma.candidateFile.update({
    where: { id: params.fileId },
    data: {
      driveFileId,
      driveViewUrl: webViewLink,
      driveFolderId: folderId,
      mimeType: "application/pdf",
      fileSize: pdfBuffer.length,
    },
  });
}
```

**★ 最重要の見落としポイント: BOOKMARK は upload route を通らない経路が主流。**
`upload/route.ts` にだけ差し込むと、**BOOKMARK のコピーは 422/1899 ＝ 22% しかカバーできない**。`generateAndStorePdf` の 42行（uploadFileToDrive 直後）にも同じ差し込みが必要。ここも `pdfBuffer` が手元にある。

なお `generateAndStorePdf` は呼び出し側（257-265行）で try/catch 隔離されており、**この関数が throw しても CandidateFile の保存は成功扱いのまま**という設計。同じ隔離の内側に入るので安全。

```ts
// from-job-platform/route.ts:255-265
      // D-3: PDF生成→Drive保管→URL埋め（driveFileId未設定の行のみ・冪等）。
      // 失敗しても保存(CandidateFile作成/更新)は成功扱いのまま（PDFは後で再生成可能）＝失敗隔離。
      if (needsPdf) {
        try {
          await generateAndStorePdf({ fileId, candidateId: candidate.id, sid: externalJobRef, fileName });
          pdfStored++;
        } catch (pdfErr) {
          console.error(`[external/bookmarks/from-job-platform] PDF gen/store failed (sid=${externalJobRef}):`, pdfErr instanceof Error ? pdfErr.message : String(pdfErr));
          pdfFailed++;
        }
      }
```

#### 経路5（タスク添付 → 求職者書類）

```ts
// save-to-candidate/route.ts:44-72
  for (const att of attachments) {
    try {
      // Download from Supabase public URL
      const res = await fetch(att.publicUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      // Upload to Google Drive
      const { fileId, webViewLink } = await uploadFileToDrive(
        att.fileName,
        buffer,
        candidateFolderId,
        att.mimeType
      );

      // Create CandidateFile record
      await prisma.candidateFile.create({
        data: {
          candidateId,
          category: category as "ORIGINAL" | "BS_DOCUMENT" | "APPLICATION" | "INTERVIEW_PREP" | "MEETING",
          fileName: att.fileName,
          fileSize: att.fileSize,
          mimeType: att.mimeType,
          driveFileId: fileId,
          driveViewUrl: webViewLink,
          driveFolderId: candidateFolderId,
          uploadedByUserId: user.id,
        },
      });
```

**`folderId` を渡していない**＝ここから来た BS_DOCUMENT は必ずルート直下。論点4でフラット配置を推す補強材料。

#### 一括アップロード・移動・復元など、upload route を通らない経路

- **一括アップロード**: 無い。UI が1件ずつ POST（前述）。
- **カテゴリ変更（移動）**: **無い。**`files/[fileId]/route.ts` の PATCH が受け付けるのは `caComment` と `aiAnalysisComment` のみ（101-213行）。`category` や `folderId` を書き換えるエンドポイントは存在しない。→ **「BOOKMARK でなかったファイルが後から BOOKMARK になる」ことは起きない。**判定は作成時1回で確定してよい。
- **アーカイブ / 復元 / 完全削除**: `archive` `restore` `permanent` の3ルート。いずれも `archivedAt` の付け外しと物理削除であり、新しい実体は作らない。**復元しても Drive 上のファイルは同じ**（`restore` は `archivedAt` を NULL に戻すだけ）。→ OneDrive 側は「削除しない」方針なので、復元時に再コピーは不要。
- **ファイル実体の差し替え**: `replace-docx` / `replace-xlsx` の2ルート。**`CandidateFile` は同一行のまま `driveFileId` だけが新しくなる。**

```ts
// files/[fileId]/replace-docx/route.ts:69-94
    // 1. 古い docx を Google Drive から削除（PDF実体が無い行はスキップ）
    if (existing.driveFileId) await deletePdfFromDrive(existing.driveFileId);

    // 2. 新しい docx をアップロード
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { fileId: newDriveId, webViewLink } = await uploadFileToDrive(
      existing.fileName,
      fileBuffer,
      folderId,
      DOCX_MIME,
    );

    // 3. DB レコード更新
    const updated = await prisma.candidateFile.update({
      where: { id: fileId },
      data: {
        fileSize: file.size,
        driveFileId: newDriveId,
        driveViewUrl: webViewLink,
        // T-164: ファイル実体が差し替わったため、抽出テキストの永続キャッシュを無効化（次回参照時に再解析）
        parsedText: null,
        parsedAt: null,
        parseFailedAt: null,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
```

→ **懸念点（後述10-6）**: 差し替え後の内容は OneDrive に反映されない。同名スキップ方針と真正面から衝突する。

- **`restore-jobs`**: `candidateFile.updateMany` のみ（225行・250行）。新規作成なし。

---

## Step 2: OneDrive の書き込み先パスの復元可否

### 2-1. デコード検証【実測・本番DB 1734件】

復元ロジック（検証に使ったもの）:

```js
const parsed = new URL(u);
const id = parsed.searchParams.get("id");          // URLSearchParams が %XX を自動デコード
const m = id.match(/^\/personal\/([^/]+)\/Documents\/(.*)$/);
const upn = m[1];                                   // masayuki_oono_bizstudio_co_jp
const drivePath = "/" + m[2];                       // /ビズスタジオ/6.求職者書類関連/...
```

#### 10件の実例（求職者番号順の先頭10件）

| # | 求職者番号 | 氏名 | 復元されたドライブ相対パス |
|--|--|--|--|
| 1 | 5000051 | 石井 美優 | `/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/5000051_石井美優` |
| 2 | 5000052 | 落合 香澄 | `/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/5000052_落合香澄` |
| 3 | 5000057 | 岡田 七海 | `/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/5000057_岡田七海` |
| 4 | 5000058 | 山本 すみれ | `/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/山本すみれ` ※番号なし |
| 5 | 5000066 | 池田 尚仁 | `/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/5000066_池田尚仁` |
| 6 | 5000068 | 石川 蓮翔 | `/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/5000068_石川蓮翔` |
| 7 | 5000069 | 矢野 雅人 | `/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/5000069_矢野雅人` |
| 8 | 5000070 | 前田 紅里 | `/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/5000070_前田紅里` |
| 9 | 5000074 | 道西 未来 | `/ビズスタジオ/6.求職者書類関連/1.大野/2025/202507/5000074_道西 未来` ※**半角スペース入り** |
| 10 | 5000075 | 川島 勇也 | `/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/川島勇也` ※番号なし |

生 URL の例（#1）:

```
https://bizstudio-my.sharepoint.com/my?id=%2Fpersonal%2Fmasayuki%5Foono%5Fbizstudio%5Fco%5Fjp%2FDocuments%2F%E3%83%93%E3%82%BA%E3%82%B9%E3%82%BF%E3%82%B8%E3%82%AA%2F6%2E%E6%B1%82%E8%81%B7%E8%80%85%E6%9B%B8%E9%A1%9E%E9%96%A2%E9%80%A3%2F1%2E%E5%A4%A7%E9%87%8E%2F2024%2F202312%2F5000051%5F%E7%9F%B3%E4%BA%95%E7%BE%8E%E5%84%AA
```

生 URL の例（#9・`%20` 入り）:

```
...%2F202507%2F5000074%5F%E9%81%93%E8%A5%BF%20%E6%9C%AA%E6%9D%A5
                                             ^^^^^ = 半角スペース
```

#### `%2E` / `%5F` / `%20` の復元確認

| エンコード | 文字 | 実データ中の出現 | 復元結果 |
|--|--|--|--|
| `%2E` | `.` | 3,468回（`6.求職者書類関連` `1.大野` など） | **正しく `.` に戻る** |
| `%5F` | `_` | 804回（`5000051_石井美優`） | **正しく `_` に戻る** |
| `%20` | 半角スペース | 1,264回（`5000074_道西 未来`） | **正しく ` ` に戻る** |

`URLSearchParams.get()` は `application/x-www-form-urlencoded` としてデコードするため `+` をスペースに変換するが、実データに生の `+` は0件なので影響なし（それでも実装では `decodeURIComponent(rawQuery)` の自前パースを推奨。理由は下記）。

#### 全1734件の検査結果

| 検査項目 | 結果 |
|--|--|
| デコード成功 | **1,734 / 1,734（失敗0件）** |
| UPN の種類 | **1種類のみ**: `masayuki_oono_bizstudio_co_jp`（= `masayuki_oono@bizstudio.co.jp`） |
| 同一パスが複数求職者に割り当て | **0件**（誤配の risk なし） |
| セグメント前後の空白 / 末尾ドット | **0件**（Graph が拒否するパターンなし） |
| 階層の深さ分布 | 4段=5件 / 5段=300件 / 6段=699件 / 7段=730件 |
| URL 自体が `2.求人` `3.BS作成書類` を指しているもの | **0件**（全部が求職者フォルダを指している＝サブフォルダ名を後付けすればよい） |

**担当CAフォルダ（第3セグメント）の分布**:

| フォルダ | 件数 |
|--|--|
| `1.大野` | 617 |
| `4.安藤` | 498 |
| `3.岡田` | 492 |
| `5.南條` | 84 |
| `6.奥村` | 38 |
| `2.小野` | 5 |

**パスに含まれる非英数字**:

| 文字 | 出現数 | 備考 |
|--|--|--|
| `.` | 3,468 | |
| ` `（半角スペース） | 1,264 | |
| `_` | 804 | |
| `～`（U+FF5E 全角チルダ） | 313 | **★ 正規化差異の懸念あり（10-8）** |
| `　`（U+3000 全角スペース） | 33 | |
| `・` | 30 | |
| `々` | 26 | |
| `(` `)` | 各2 | |
| `﨑`（U+FA11 異体字） | 1 | **★ NFC/NFD 正規化差異の懸念あり** |
| `※` | 1 | |

**階層の深さが4〜7段とばらついている点は重要。**`1.大野` 配下は `年/年月/氏名` の3段だが `4.安藤` 配下は `年月/氏名` の2段。→ **パスをパターンから組み立てる実装にしてはいけない。復元したフルパスをそのまま使うこと。**

### 2-2. パス保持方式の得失比較

| 観点 | A: URL から都度復元 | B: 専用カラムに保存 |
|--|--|--|
| 実現可能性 | **1734/1734 成功済み（実証済み）** | 同じ復元処理を1回走らせるだけなので同等 |
| スキーマ変更 | **不要** | `Candidate` に `onedriveDrivePath` を追加 + バックフィル |
| CA が URL を貼り替えたとき | **自動追従**（次回コピーから新パス） | **同期漏れが起きる**。`update/route.ts:113-129` の分岐に再計算を足す必要あり（漏れると古いフォルダに書き続ける = 事故） |
| 手動フォルダ移動（年またぎ等）への追従 | URL を貼り替えれば追従 | 同上 + カラム更新 |
| 実行コスト | 文字列処理のみ（μs オーダー） | ほぼ同じ |
| URL 形式が変わったとき | 復元が壊れる可能性 → ただし**復元失敗＝スキップ記録**にすれば事故らない（フェイルクローズ） | 既存カラムは無事だが新規登録が壊れる |
| 二重管理 | **なし** | あり（URL とパスの2つが真実を主張） |
| 監査（どこに書いたか） | ログ側に `targetPath` を記録すれば同等 | 同等 |

#### 推奨: **A（URL から都度復元）**

理由:
1. **実測で失敗0件。**復元不能パターンが存在しないことを1734件全数で確認済み。
2. **`Candidate.oneDriveFolderUrl` が唯一の真実**という T-158 の構図を崩さない。列を足すと「URL は更新したがパス列が古い」という不整合が必ず生まれる（`update/route.ts` は現状 URL しか見ていない）。
3. CA が OneDrive 側でフォルダを移動して URL を貼り直す運用が想定される以上、**自動追従は実質的な要件**。
4. 復元は純関数（`src/lib/onedrive/path.ts`）に切り出せばユニットテスト可能。**復元に失敗したら書かずにスキップ記録**（フェイルクローズ）にすれば、形式変化時も誤ったフォルダへの書き込みは起きない。

**ただし「実際に書いた先」は必ず `OneDriveSyncLog.targetPath` に残すこと。**後から「なぜここに入ったのか」を追える必要があるため。これは「保存方式B」ではなく「監査ログ」であり、真実の二重化にはならない。

---

## Step 3: Microsoft Graph API 接続の前提調査

### 3-1. 既存実装の有無

```
grep -ri "graph.microsoft\|AZURE_\|MSAL\|client_secret\|tenant" src/ --include="*.ts"
```

**Graph / Azure / MSAL のヒットは0件。**`client_secret` / `tenant` のヒットは以下3件のみで、いずれも**無関係**:

```
src/lib/googleCalendar.ts:7:    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
src/lib/lineworks.ts:15:  const clientSecret = process.env.LINEWORKS_CLIENT_SECRET;
src/lib/lineworks.ts:42:      client_secret: clientSecret,
```

`OneDrive` の文字列ヒットは以下のみで、**すべて「OneDrive を Graph API で触る」ものではない**:

| ファイル | 内容 | 流用可否 |
|--|--|--|
| `src/app/api/candidates/[candidateId]/update/route.ts:113-129` | T-158 の URL 保存バリデーション（`https://` のみ許可） | **流用可**（本件で触る必要はない） |
| `src/components/candidates/CandidateHeader.tsx:152-406` | URL を `window.open` で開くボタン | 流用不要 |
| `src/lib/rpa-error/system-prompt.ts` 多数 | **AI プロンプト内の文章**。RPA 端末のローカル OneDrive 同期フォルダの説明であって API 連携ではない | **流用不可** |
| `src/lib/scout/excel-import-config.ts` / `src/app/api/scout/import/daily-excel/route.ts` | CA が **手作業でダウンロードした** Excel を multipart で受け取るだけ | **流用不可** |

`.env.example` / `.env` にも Microsoft 系の変数は存在しない（`.env.example` 全文を確認済み）。

**結論: Microsoft 側の実装・設定・環境変数は完全にゼロ。全部これから作る。**

### 3-2. 今回必要になる設定一覧

#### 環境変数（Railway production / staging / GitHub Secrets）

| 変数名 | 意味 | 取得元 |
|--|--|--|
| `MS_GRAPH_TENANT_ID` | Entra ID テナントの ID（GUID） | Azure ポータル > アプリの概要「ディレクトリ (テナント) ID」 |
| `MS_GRAPH_CLIENT_ID` | 登録したアプリの ID（GUID） | 同「アプリケーション (クライアント) ID」 |
| `MS_GRAPH_CLIENT_SECRET` | クライアントシークレットの**値**（ID ではない） | 「証明書とシークレット」で発行。**発行直後しか表示されない** |
| `ONEDRIVE_OWNER_UPN` | 書き込み先 OneDrive の所有者。実測で全1734件が同一 → `masayuki_oono@bizstudio.co.jp` | 固定値 |
| `ONEDRIVE_SYNC_ENABLED` | キルスイッチ。`"true"` 以外は一切 Graph を叩かない | 運用で設定 |
| `ONEDRIVE_SYNC_START_AT` | 稼働開始時刻（ISO8601）。**これ以前に作成された `CandidateFile` は対象外**＝「過去分はコピーしない」を機械的に保証する | 本番投入時に設定 |

`INTERNAL_API_KEY` は既存（`.env.example` に定義済み・Railway と GitHub Secrets の両方に設定済みと `docs/survey_T-147_secure_file_transfer.md:155` に記録あり）。**再試行 cron 用に新規シークレット登録は不要。**

#### Azure 側で必要になるアプリ権限

| 権限名 | 種類 | 必要性 |
|--|--|--|
| `Files.ReadWrite.All` | **アプリケーションの許可**（Application permission） | **必須。**ユーザーが居ないサーバー処理なので「委任された許可」は使えない |

**管理者の同意（管理者による同意の付与）: 必要。**
アプリケーションの許可はすべて、テナントのグローバル管理者（または特権ロール管理者）が明示的に同意しないと有効にならない。同意していない状態で API を叩くと `403 accessDenied` になる。

**★ 重大な注意（懸念点10-2 参照）**: `Files.ReadWrite.All`（アプリケーション）は**テナント内の全ユーザーの OneDrive とすべての SharePoint サイトに読み書きできる**。特定の1ユーザーの OneDrive だけに絞る仕組みは Graph 側に存在しない（`Sites.Selected` は SharePoint サイト単位で、個人 OneDrive には効かない）。この権限の広さは承認前に必ず共有すること。

### 3-3. Azure ポータルでの設定手順書（日本語画面）

> 実行者: Microsoft 365 のグローバル管理者権限を持つ人
> 所要: 10〜15分

#### 手順1: アプリを登録する

1. ブラウザで **https://entra.microsoft.com/** を開く（旧「Azure Active Directory」。Azure ポータル https://portal.azure.com/ からでも可）
2. 管理者アカウントでサインインする
3. 左メニューの **「ID」** →  **「アプリケーション」** → **「アプリの登録」** をクリック
4. 画面上部の **「＋ 新規登録」** をクリック
5. 「アプリケーションの登録」画面で以下を入力する

   | 項目 | 入力値 |
   |--|--|
   | 名前 | `bizstudio-portal-onedrive-sync` |
   | サポートされているアカウントの種類 | **「この組織ディレクトリのみに含まれるアカウント (Bizstudio のみ - シングル テナント)」** を選択 |
   | リダイレクト URI | **空欄のまま**（サーバー間通信のみでブラウザのリダイレクトを使わないため） |

6. **「登録」** をクリック

#### 手順2: テナント ID とクライアント ID を控える

1. 登録直後に開く **「概要」** 画面で、以下2つの値をコピーして保管する

   | 画面上の表示 | 環境変数名 |
   |--|--|
   | **アプリケーション (クライアント) ID** | `MS_GRAPH_CLIENT_ID` |
   | **ディレクトリ (テナント) ID** | `MS_GRAPH_TENANT_ID` |

#### 手順3: クライアントシークレットを発行する

1. 左メニューの **「管理」** → **「証明書とシークレット」** をクリック
2. **「クライアント シークレット」** タブを選ぶ
3. **「＋ 新しいクライアント シークレット」** をクリック
4. 以下を入力する

   | 項目 | 入力値 |
   |--|--|
   | 説明 | `portal-onedrive-sync` |
   | 有効期限 | **「24 か月」**（最長）を選択 |

5. **「追加」** をクリック
6. 一覧に行が追加される。**「値」列**の文字列をコピーする → これが `MS_GRAPH_CLIENT_SECRET`

   > ★ **この画面を離れると「値」は二度と表示されない。**必ずこの場でコピーすること。
   > 「シークレット ID」列は**別物**。使うのは「値」の方。

7. **有効期限の日付をカレンダーに登録する。**期限切れになると同期が全停止する（10-10 参照）

#### 手順4: API のアクセス許可を付与する

1. 左メニューの **「管理」** → **「API のアクセス許可」** をクリック
2. **「＋ アクセス許可の追加」** をクリック
3. **「Microsoft Graph」** をクリック
4. **「アプリケーションの許可」** を選ぶ

   > ★ 隣の「委任されたアクセス許可」を選ばないこと。サーバー処理にはサインインしたユーザーが居ないため機能しない。

5. 検索ボックスに `Files.ReadWrite.All` と入力する
6. **「Files」** グループを展開し、**`Files.ReadWrite.All`** のチェックボックスをオンにする
7. 画面下の **「アクセス許可の追加」** をクリック

#### 手順5: 管理者の同意を与える（★これを忘れると動かない）

1. 「API のアクセス許可」画面に戻ると、`Files.ReadWrite.All` の **「状態」列に「Bizstudio に付与されていません」** と警告アイコンが出ている
2. 一覧の上にある **「Bizstudio に管理者の同意を与えます」** ボタンをクリック
3. 確認ダイアログで **「はい」** をクリック
4. **「状態」列が緑のチェック付きで「Bizstudio に付与されました」に変わったことを確認する**

   > このボタンがグレーアウトしている場合は、サインイン中のアカウントに管理者権限が無い。グローバル管理者に依頼する。

5. ついでに、既定で付いている `User.Read`（委任）は使わないので削除してよい（残しても害はない）

#### 手順6: 設定値を portal に登録する

1. Railway の `bizstudio-portal` プロジェクト（production）の Variables に以下を追加する

   ```
   MS_GRAPH_TENANT_ID=<手順2の ディレクトリ (テナント) ID>
   MS_GRAPH_CLIENT_ID=<手順2の アプリケーション (クライアント) ID>
   MS_GRAPH_CLIENT_SECRET=<手順3でコピーした「値」>
   ONEDRIVE_OWNER_UPN=masayuki_oono@bizstudio.co.jp
   ONEDRIVE_SYNC_ENABLED=false
   ```

   > `ONEDRIVE_SYNC_ENABLED` は最初 `false` で入れる。疎通確認が済んでから `true` に切り替える。
   > `ONEDRIVE_SYNC_START_AT` は `true` に切り替える直前の時刻を入れる（過去分を巻き込まないため）。

2. staging（`bizstudio-portal-staging`）にも同じ値を入れる場合は、**staging と production が同一 DB を共有している**点に注意（`ref_staging_prod_shared_db`）。staging から実行しても本番の OneDrive に書き込まれる。

#### 手順7: 疎通確認（Phase 2 で実施）

Phase 2 の実装後、`ONEDRIVE_SYNC_ENABLED=true` にする前に、1求職者ぶんだけ手動で dry-run（フォルダの存在確認まで・書き込みなし）を通し、`2.求人` `3.BS作成書類` が Graph から見えることを確認する。

### 3-4. ライブラリの候補と衝突

| 候補 | 依存の重さ | 判定 |
|--|--|--|
| `@microsoft/microsoft-graph-client` + `@azure/identity` | `@azure/identity` は `@azure/core-*` 系を10パッケージ以上引き込み、MSAL Node も入る。合計 30MB 超 | **不採用** |
| `@azure/msal-node` のみ + 素の fetch | MSAL Node 単体でも `@azure/msal-common` 等を引き込む | 不採用 |
| **ライブラリ無し。素の `fetch` で OAuth2 client_credentials + Graph REST** | 追加依存ゼロ | **推奨** |

#### 推奨: ライブラリを追加しない

理由:
1. **必要な HTTP 呼び出しは実質3本だけ**（トークン取得 / フォルダ存在確認 / アップロード）。SDK の抽象化に見合わない。
2. **既存に前例がある。**`src/lib/lineworks.ts:15-42` が同じ `client_credentials` グラントを素の fetch で実装している。同じ書き方に揃えられる。
3. `package.json` の既存依存（`googleapis` `@prisma/client` `next 16.1.6` 等）と直接衝突するパッケージは無いが、**Next.js 16 の bundler で `@azure/identity` の Node 専用 API が問題を起こすリスク**を避けられる。
4. `next build` の型チェックとバンドルサイズへの影響がゼロ。

実際に叩く Graph エンドポイント（4本）:

```
# 1. トークン取得
POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
  grant_type=client_credentials
  scope=https://graph.microsoft.com/.default

# 2. 書き込み先フォルダの存在確認（無ければ 404 → スキップ記録）
GET https://graph.microsoft.com/v1.0/users/{upn}/drive/root:{encodedPath}/2.求人

# 3. 4MB 以下のアップロード（conflictBehavior=fail で同名は 409 になる）
PUT https://graph.microsoft.com/v1.0/users/{upn}/drive/root:{encodedPath}/2.求人/{fileName}:/content?@microsoft.graph.conflictBehavior=fail

# 4. 4MB 超のアップロード（実測 max 2.03MB だが上限 20MB のため必須）
POST .../root:{path}/{fileName}:/createUploadSession
  { "item": { "@microsoft.graph.conflictBehavior": "fail" } }
  → 返る uploadUrl に PUT でチャンク送信
```

**`@microsoft.graph.conflictBehavior=fail` を使えば「同名確認」と「アップロード」を1往復にまとめられ、かつ確認〜書き込みの間の競合も原理的に起きない。**別途 GET で存在確認する設計より確実。409 が返ったら `SKIPPED_DUPLICATE` として記録する。

---

## Step 4: 設計案

### 論点1: コピー処理を差し込む位置

| 案 | 内容 | 評価 |
|--|--|--|
| A | upload route 内で `await` して同期実行 | **却下。**Graph の遅延（1〜3秒/件）がそのままアップロードの待ち時間になり、10ファイル選択時は10倍。かつ 142行の `try` の内側なので、Graph の失敗が 500 に化けて**制約に真正面から違反する** |
| B | upload route 内で独立 `try/catch` に包んで `await` | 500 化は防げるが、レイテンシ問題は残る |
| C | **レコード作成と同一トランザクションで `OneDriveSyncLog` を `PENDING` で作り、レスポンス後に fire-and-forget で処理。失敗は `PENDING`/`FAILED` のまま残り、cron が拾う** | **推奨** |
| D | 完全非同期（cron のみ。即時コピーしない） | 実装は最も単純だが、CA が「今アップしたのに OneDrive に無い」と混乱する。最大2時間待ちは体験として悪い |

#### 推奨: C

```ts
// upload/route.ts の 161行を差し替えるイメージ（+レコード作成後）
const [record] = await prisma.$transaction([
  prisma.candidateFile.create({ /* 既存のまま */ }),
  // ↑ の id が要るので実際は create → 同一 tx 内で log create の2段
]);

// ── レスポンス直前（198行と200行の間） ──
// OneDrive への写し（fire-and-forget）。失敗しても portal のアップロードは成功のまま。
// 対象外・失敗は OneDriveSyncLog に残り、夜間 cron が拾い直す。
if (record.category === "BOOKMARK" || record.category === "BS_DOCUMENT") {
  void syncFileToOneDrive({ candidateFileId: record.id, buffer: fileBuffer })
    .catch((e) => console.error("[onedrive-sync] unexpected:", e));
}
```

**C を推す理由:**

1. **制約を機械的に満たす。**`void` で `await` しないため、Graph が何秒かかろうが何を投げようが、`return withCors(...)` は先に返る。`.catch` を必ず付けることで unhandled rejection も潰す。
2. **Railway は `next start` の常駐プロセス**（サーバレスではない）。`docs/prompt_T-150_phase1_survey.md` と `resubmit-stale/route.ts:16` に「Railway（next start・非サーバレス）」と明記されている。**レスポンス後も非同期処理は生き残る。**Vercel のようにレスポンスと同時に凍結されない。
3. **fire-and-forget はこのリポジトリの確立された慣例。**`advisor/sessions/[sessionId]/messages/route.ts:465-475`、`bookmarks/extract-text/route.ts:136-145`、`daily-report/route.ts:282` など多数の前例がある。特に extract-text のコメント「fire-and-forget（await しない）＝アップ動線のレスポンスを一切遅らせない」は本件とまったく同じ意図。
4. **`PENDING` 行を「レコード作成と同一トランザクション」で作るのが肝。**こうすると「`OneDriveSyncLog` に行が無い＝そもそも対象外（稼働前の過去分・別カテゴリ）」が保証され、**cron は `OneDriveSyncLog` テーブルだけをスキャンすればよくなる**（`candidate_files` を LEFT JOIN で全走査しなくて済む）。プロセスが fire-and-forget の直前で落ちても `PENDING` が残るので取りこぼさない。
5. **Buffer の再取得が不要。**`fileBuffer` をクロージャに渡せば Drive への再ダウンロードが省ける。

**差し込む場所は3か所必要**（Step 1-4 の実測より）:

| # | ファイル | 差し込み位置 | カバーする件数/月 |
|--|--|--|--|
| 1 | `files/upload/route.ts` | 198行の直後（`recalculateSubStatusIfAuto` の下） | BOOKMARK 422 + BS_DOCUMENT 187 |
| 2 | `external/bookmarks/from-job-platform/route.ts` | `generateAndStorePdf` 内 54行の直後（`candidateFile.update` の後） | BOOKMARK 1,380 |
| 3 | `tasks/[taskId]/attachments/save-to-candidate/route.ts` | 72行の直後（ループ内・カテゴリが BS_DOCUMENT のときのみ） | 少数（BS_DOCUMENT 187 に内包） |

**#2 を落とすと BOOKMARK の 73% がコピーされない。**ここが最大の落とし穴。

`favorites` / `mypage-response-sync` は `driveFileId: null` 固定＝実体が無いので、`OneDriveSyncLog` を `SKIPPED_NO_BODY` で作る（あるいは行を作らない）。**行を作って理由を残す方を推奨** — 「マイページのお気に入りが OneDrive に無い」の問い合わせに即答できるため。

### 論点2: 失敗したファイルの記録方法

| 案 | 評価 |
|--|--|
| `CandidateFile` に列を足す | **却下。**必要な項目は最低6列（status / targetPath / itemId / attemptCount / lastAttemptedAt / errorMessage）。**`CandidateFile` は既に50列**あり、これ以上の肥大は避けたい。さらに「行が無い＝対象外」の判定ができず、cron が `candidate_files` 全体（10万行超）を毎回走査することになる |
| **新規テーブル `OneDriveSyncLog`** | **推奨** |

#### 推奨スキーマ

```prisma
// T-159: portal → OneDrive の一方向コピーの記録。1 CandidateFile につき1行。
//   行の存在自体が「同期対象として受け付けた」ことを意味する（行が無い = 稼働開始前 or 対象外カテゴリ）。
//   CandidateFile の作成と同一トランザクションで PENDING を作ること。fire-and-forget が起動前に
//   プロセスが落ちても行が残るため、cron が確実に拾える。
enum OneDriveSyncStatus {
  PENDING                 // 未処理（受付済み）
  COPIED                  // コピー成功
  SKIPPED_NO_FOLDER_URL   // Candidate.oneDriveFolderUrl 未登録
  SKIPPED_BAD_URL         // URL からパスを復元できなかった（フェイルクローズ）
  SKIPPED_NO_SUBFOLDER    // OneDrive 側に 2.求人 / 3.BS作成書類 が無い（★フォルダは作らない）
  SKIPPED_DUPLICATE       // 同名ファイルが既にある（上書きしない）
  SKIPPED_NO_BODY         // driveFileId = null（コピーすべき実体が無い）
  FAILED                  // Graph API エラー等。再試行対象
  GIVEN_UP                // 試行上限（5回）超過。人手の確認が要る
}

model OneDriveSyncLog {
  id              String             @id @default(cuid())
  candidateFileId String             @unique @map("candidate_file_id")
  candidateFile   CandidateFile      @relation(fields: [candidateFileId], references: [id], onDelete: Cascade)
  status          OneDriveSyncStatus @default(PENDING)
  // 実際に書き込んだ / 書き込もうとした OneDrive のドライブ相対パス（監査用）。
  //   例: /ビズスタジオ/6.求職者書類関連/1.大野/2025/202507/5000074_道西 未来/2.求人/求人票_◯◯.pdf
  //   真実は Candidate.oneDriveFolderUrl 側。ここは「何をしたか」の記録であって設定値ではない。
  targetPath      String?            @map("target_path")
  oneDriveItemId  String?            @map("onedrive_item_id")   // 成功時の driveItem.id
  attemptCount    Int                @default(0) @map("attempt_count")
  lastAttemptedAt DateTime?          @map("last_attempted_at")
  nextRetryAt     DateTime?          @map("next_retry_at")       // 指数バックオフ
  errorMessage    String?            @map("error_message") @db.Text
  createdAt       DateTime           @default(now()) @map("created_at")
  updatedAt       DateTime           @updatedAt @map("updated_at")

  @@index([status, nextRetryAt])   // cron の拾い直しスキャン用
  @@index([status, createdAt])     // CA向け一覧・件数集計用
  @@map("onedrive_sync_logs")
}
```

`CandidateFile` 側には `oneDriveSync OneDriveSyncLog?` のリレーション1行だけを足す（列は増えない）。

#### 記録すべき項目とスキップ理由の分類

| 分類 | いつ付くか | 再試行するか | CA が取るべき行動 |
|--|--|--|--|
| `PENDING` | 受付直後 | する | なし（自動） |
| `COPIED` | Graph が 201 を返した | — | なし |
| `SKIPPED_NO_FOLDER_URL` | `Candidate.oneDriveFolderUrl` が NULL/空 | **しない**（URL 登録時に手動で拾い直す運用） | 基本情報から OneDrive URL を登録 |
| `SKIPPED_BAD_URL` | URL の形式が想定外でパス復元不能 | しない | URL を貼り直す |
| `SKIPPED_NO_SUBFOLDER` | `2.求人` / `3.BS作成書類` が Graph で 404 | **しない**（確定仕様。フォルダは作らない） | **OneDrive 側でフォルダを手で作る** |
| `SKIPPED_DUPLICATE` | Graph が 409（`conflictBehavior=fail`） | しない | なし（意図どおり。CA の手入れを守った） |
| `SKIPPED_NO_BODY` | `driveFileId` が NULL | しない | なし（サイト経由の記録のみ行） |
| `FAILED` | 429 / 5xx / タイムアウト / ネットワーク | **する**（最大5回・指数バックオフ） | なし（自動） |
| `GIVEN_UP` | 5回失敗した | しない | 管理者に報告 |

`errorMessage` には Graph の `error.code` と `error.message` をそのまま入れる（`itemNotFound` `nameAlreadyExists` `activityLimitReached` 等）。**HTTP ステータスだけでは原因が判別できない**ため。

### 論点3: 失敗ぶんの再試行

#### 実行基盤の調査結果【実測】

**Railway の cron は使っていない。**リポジトリに `railway.json` / `railway.toml` は存在しない。

**既存の定期実行はすべて GitHub Actions cron + 内部API + `INTERNAL_API_KEY`。**稼働中の4本:

| ワークフロー | cron | 叩き先 |
|--|--|--|
| `.github/workflows/auto-expire-daily.yml` | `0 18 * * *`（JST 03:00） | `/api/internal/entries/auto-expire` |
| `.github/workflows/t131-resubmit-stale.yml` | `0 */2 * * *`（2時間毎） | `/api/internal/bookmarks/resubmit-stale` |
| `.github/workflows/t147-secure-transfer-cleanup.yml` | 日次 | `/api/internal/secure-transfer-cleanup` |
| `.github/workflows/t150-task-due-reminder.yml` | `0 22 * * *`（JST 07:00） | `/api/internal/tasks/due-reminder` |

認証は共通の1関数（`src/lib/internal-auth.ts` 全文）:

```ts
import { NextRequest } from "next/server";

export function validateInternalApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) return false;
  return apiKey === expectedKey;
}
```

#### 推奨: 既存パターンにそのまま乗せる

- 新規: `.github/workflows/t159-onedrive-sync-retry.yml`
- cron: `0 17 * * *`（UTC 17:00 = **JST 翌02:00**）。既存の `auto-expire-daily`（JST 03:00）と1時間ずらして、DB とホストの負荷が重ならないようにする
- 叩き先: `POST /api/internal/onedrive-sync/retry?dry_run=<bool>&confirm=<bool>&batch=<n>`
- `resubmit-stale` と同じ**二段ガード**（`dry_run=false` かつ `confirm=true` の両方が揃ったときだけ実書き込み）と `batch` 上限を踏襲する
- `workflow_dispatch` を付けて手動疎通できるようにする（`resubmit-stale` と同形）
- **`master` ブランチに置かないと `schedule` が動かない**（`t131-resubmit-stale.yml` のコメントに明記されている落とし穴）

拾う対象（SQL の意味）:

```
status = 'PENDING'
  OR (status = 'FAILED' AND attempt_count < 5 AND (next_retry_at IS NULL OR next_retry_at <= now()))
```

`created_at >= ONEDRIVE_SYNC_START_AT` の条件は不要（そもそも稼働開始前は `OneDriveSyncLog` の行が作られない）。ただし念のため二重防御として入れてもよい。

バッチ上限は既定 50 件／回。**Buffer が手元に無いので `downloadFileFromDrive` で Drive から再取得する**（1件あたり Drive DL + Graph UL で3〜5秒 → 50件で最大4分。`maxDuration = 300` の内側に収まる）。溢れた分は翌日。

### 論点4: BS作成書類のフォルダ階層をどう扱うか

| 案 | 内容 | 評価 |
|--|--|--|
| A | **`3.BS作成書類` 直下にフラットに置く**（`BSDocumentFolder` の階層は無視） | **推奨** |
| B | OneDrive 側にも同名サブフォルダを再現する | 却下 |
| C | フォルダ名をファイル名の接頭辞にする（`【営業事務】職務経歴書.docx`） | 次善 |

#### 推奨: A（フラット）

理由:

1. **「フォルダを作らない」という確定仕様と正面から衝突する。**B を採ると `3.BS作成書類/営業事務/` を portal が作ることになる。「求職者フォルダは原本フォルダのコピーから作られるので、存在しないのは運用側の例外」という本件の前提が、CA が portal 上で自由に作ったサブフォルダには成り立たない。
2. **実データでフォルダ利用は少数派。**935件中174件（18.6%）のみ。8割はもともとルート直下。
3. **フォルダ名が OneDrive で使えない。**実データに `ポピンズエデュケア:` （末尾 `:`）が存在する。さらに `③現職のIT経験を生かした別職種（営業、コンサル系） ④全くの未開拓の領域（ITとは別業種の営業系）` のような**フォルダ名として明らかに想定外の長文**もある（これは実質メモ欄として使われている）。サニタイズを入れると portal 側の表示名と OneDrive のフォルダ名がずれ、対応が追えなくなる。
4. **タスク添付経由（`save-to-candidate`）は `folderId` を渡さない**ので、そもそも階層情報を持たないファイルが混在する。
5. OneDrive 側の `3.BS作成書類` は CA が日常的に手で触る場所。portal が勝手にサブフォルダを増やすと運用が乱れる。

**C（接頭辞）は将来 CA から要望が出たら検討する余地がある**が、Phase 1 では見送る。理由は同名スキップの判定キーが変わってしまい、あとから A ⇄ C を切り替えると二重コピーが起きるため。**最初にフラットで確定させるのが安全。**

なお **BOOKMARK には階層の問題が無い**（`BSDocumentFolder` は BS_DOCUMENT 専用）。`2.求人` 直下にそのまま置けばよい。

### 論点5: CA が結果を確認する画面の要否

#### 推奨: **専用画面は作らない。既存の一覧行にバッジを出す（要）**

「必要か」への答えは **必要**。ただし新規画面ではなく、既存画面への最小追加とする。

理由: `SKIPPED_NO_SUBFOLDER`（`2.求人` が無い）と `SKIPPED_NO_FOLDER_URL` は**システムが自動回復できず、CA の手作業（OneDrive でフォルダを作る / URL を登録する）でしか解消しない**。気づく導線が無いと、「OneDrive に入っているはず」という誤った前提のまま件数だけが静かに積み上がる。これは T-131 の「投入滞留」と同じ失敗パターン。

**出し方（Phase 1 の範囲）:**

| 画面 | 追加内容 |
|--|--|
| `src/components/candidates/DocumentsTab.tsx`（BS作成書類タブ） | 各ファイル行の右端に小さいアイコン。`COPIED`=薄いグレーのチェック / `PENDING`=時計 / `SKIPPED_*`・`FAILED`=オレンジの警告。`title` 属性に日本語の理由（例:「OneDriveの『3.BS作成書類』フォルダが見つかりません」） |
| `src/components/candidates/HistoryTab.tsx`（紹介履歴＝ブックマーク一覧） | 同上 |
| `src/components/candidates/CandidateHeader.tsx` の OneDrive ボタン | その求職者に `SKIPPED_*`/`GIVEN_UP` が1件以上あればボタンに小さな警告ドットを付ける（既に `oneDriveFolderUrl` 未登録時の `disabled` + `title` 表示がある 400-406行に相乗り） |

`COPIED` を目立たせないのが重要。**正常系は視覚的にほぼ無音にして、異常だけが目に入る**ようにする。

**管理者向けの全社集計画面（「`2.求人` が無い求職者の一覧」等）は Phase 2 送り。**Phase 1 稼働後1〜2週間の実データで `SKIPPED_NO_SUBFOLDER` が何件出るかを見てから、必要性を判断する方が無駄がない。

### 論点6: 想定される実装規模

#### 新規作成

| ファイル | 内容 | 概算行数 |
|--|--|--|
| `src/lib/onedrive/graph-client.ts` | client_credentials トークン取得＋プロセス内キャッシュ（有効期限-5分）、`graphFetch()` ラッパ、429/5xx の指数バックオフ、`ONEDRIVE_SYNC_ENABLED` のキルスイッチ判定 | ~120 |
| `src/lib/onedrive/path.ts` | `oneDriveFolderUrl` → ドライブ相対パスの復元（純関数）、セグメント単位の `encodeURIComponent`、カテゴリ→サブフォルダ名（`2.求人` / `3.BS作成書類`）の対応 | ~60 |
| `src/lib/onedrive/sync.ts` | 本体。対象判定 → パス復元 → サブフォルダ存在確認 → アップロード（4MB 境界で simple PUT / createUploadSession を分岐）→ `OneDriveSyncLog` 更新。cron からも呼べるよう `buffer` を任意引数にし、未指定時は `downloadFileFromDrive` で再取得 | ~220 |
| `src/app/api/internal/onedrive-sync/retry/route.ts` | 再試行 API。`validateInternalApiKey` + 二段ガード + `batch` 上限（`resubmit-stale/route.ts` を雛形にする） | ~70 |
| `.github/workflows/t159-onedrive-sync-retry.yml` | JST 02:00 の cron + `workflow_dispatch`（`t131-resubmit-stale.yml` を雛形にする） | ~60 |
| `prisma/migrations/<ts>_onedrive_sync_log/migration.sql` | enum + テーブル + index 2本（**`migrate dev` は使わず `migrate diff` で生成 → 手書き timestamp → `migrate deploy`**。`ref_prisma_migrate_procedure` 参照） | ~25 |
| **小計** | | **~555** |

#### 変更

| ファイル | 内容 | 概算行数 |
|--|--|--|
| `prisma/schema.prisma` | `OneDriveSyncStatus` enum + `OneDriveSyncLog` model + `CandidateFile` にリレーション1行 | +45 |
| `src/app/api/candidates/[candidateId]/files/upload/route.ts` | 161行の create を `$transaction` 化（log の PENDING 同時作成）+ 198行の後に fire-and-forget 1ブロック | +12 |
| `src/app/api/external/bookmarks/from-job-platform/route.ts` | `generateAndStorePdf` 54行の後に log 作成 + fire-and-forget | +10 |
| `src/app/api/tasks/[taskId]/attachments/save-to-candidate/route.ts` | 72行の後に同上（BS_DOCUMENT のときのみ） | +10 |
| `src/app/api/external/candidate-site/favorites/route.ts` | `SKIPPED_NO_BODY` の log を作る（コピーはしない） | +6 |
| `src/app/api/candidates/[candidateId]/files/route.ts` | 一覧レスポンスに `oneDriveSync: { status, errorMessage }` を含める | +8 |
| `src/components/candidates/DocumentsTab.tsx` | ステータスバッジ表示 | +25 |
| `src/components/candidates/HistoryTab.tsx` | ステータスバッジ表示 | +25 |
| `.env.example` | 環境変数6本の追記 | +8 |
| **小計** | | **~149** |

**合計 約704行 / 14ファイル。**

うち Phase 2（CA向け表示）を切り離すなら、**Phase 1 は約646行 / 11ファイル**（UI 2ファイル + files/route.ts を除く）。

#### 段階分けの推奨

| フェーズ | 範囲 | デプロイ判断（`07-deploy-rules.md` 準拠） |
|--|--|--|
| Phase 2-a | Prisma スキーマ + マイグレーション + `src/lib/onedrive/*`（差し込みはまだしない） | **nullable な新規テーブルのみの追加 → master 直 push 可** |
| Phase 2-b | 差し込み3か所 + 再試行 API + cron。`ONEDRIVE_SYNC_ENABLED=false` で本番投入 → dry-run で疎通確認 → `true` に切替 | **既存ロジック（upload route）変更に該当 → staging 必須** |
| Phase 2-c | CA向けバッジ表示 | 純粋追加 → master 直 push 可 |

---

## Step 5: 調査中に気づいた懸念点・見落としがちな点

### 10-1. ★ BOOKMARK の 73% は upload route を通らない【実測】

直近30日の BOOKMARK 1,899件の内訳:

| source_type | origin | Drive実体 | 件数 |
|--|--|--|--|
| `job-platform` | ca | あり | **1,380** |
| `(null=PDF)` | ca | あり | 422 |
| `job-platform` | candidate | 無し | 77 |
| `job-platform` | ca | 無し | 13 |
| `(null=PDF)` | candidate | 無し | 5 |
| `job-platform` | candidate | あり | 2 |

**`upload/route.ts` にだけ差し込むと 422件（22%）しかコピーされない。**`generateAndStorePdf`（`from-job-platform/route.ts:42`）への差し込みが本命。これを見落とすと「なぜかブックマークがほとんど OneDrive に入らない」という形で顕在化する。

### 10-2. ★ `Files.ReadWrite.All`（アプリケーション）はテナント全体への書き込み権限

「大野氏の個人 OneDrive の、この求職者フォルダだけ」に絞る仕組みは Graph に**存在しない**。`Sites.Selected` は SharePoint サイト単位でしか効かず、個人 OneDrive（`/personal/...`）には適用できない。

つまり **portal の `MS_GRAPH_CLIENT_SECRET` が漏れると、テナント内の全社員の OneDrive と全 SharePoint サイトが読み書きされうる。**Azure の同意を求める前に、この権限の広さを必ず共有すること。

緩和策（Phase 2 で検討）:
- portal 側で書き込み先パスを `/ビズスタジオ/6.求職者書類関連/` 配下に**ハードコードで限定**する（アプリ内ガード）。実データは全件このプレフィックスに合致する。
- シークレットの有効期限を短く（12か月）して定期ローテーション
- 将来的には個人 OneDrive をやめて SharePoint の共有ライブラリへ移し、`Sites.Selected` に切り替える

### 10-3. ★ 保存先が特定個人（大野氏）の OneDrive である【実測: 1734/1734】

UPN は全件 `masayuki_oono_bizstudio_co_jp`。つまり **1,734人ぶんの求職者書類が、大野氏の個人ストレージ（Microsoft 365 の個人 OneDrive、標準 1TB）に入っている。**

- 退職・アカウント削除・ライセンス剥奪で**全データが道連れになる**（削除後30日で自動消滅）
- ストレージ上限に当たれば Graph が `quotaLimitReached` を返し、全同期が停止する
- 他の CA（安藤・岡田・南條・奥村・小野）のフォルダも大野氏の個人ドライブ配下にあるため、権限管理が共有ライブラリ前提になっていない

**本件の実装自体は成立するが、保存先の構造そのものが組織的リスク。**T-159 の範囲外だが、別途 SharePoint 共有ライブラリへの移行を検討事項として上げるべき。

### 10-4. ★ 同名スキップにより、同じ会社の求人が2件目以降コピーされない【実測: 312グループ】

BOOKMARK のファイル名は `求人票_{会社名}.pdf` または `求人票_{会社名}_{10桁ID}.pdf` の形式（`from-job-platform/route.ts:190`、`mypage-response-sync.ts:483`）。**同じ会社の別求人を紹介すると、数値ID を持たない経路では完全に同名になる。**

実測: 同一求職者 × 同一カテゴリ × 同名ファイルの重複グループが **312 グループ**存在する。

「同名は上書きせずスキップ」は確定仕様なので変更しないが、**CA から見ると「2件目の求人票が OneDrive に入っていない」という現象**になる。`SKIPPED_DUPLICATE` の理由表示を「同名のファイルが既にあります（上書きしません）」と明示し、混乱を避けること。

（Phase 2 の選択肢として、`求人票_◯◯ (2).pdf` のような連番リネームは可能だが、「CA が手で入れたものを潰さない」という当初の意図とはズレる。Phase 1 では素直にスキップでよい。）

### 10-5. `driveFileId = null` の行はコピー不能【実測: 直近30日で95件】

サイト経由（`favorites`）と旧マイページ同期（`mypage-response-sync`）は `driveFileId: null` 固定で PDF 実体を持たない。mime も `text/plain`。

- これらは**恒久的にコピー不能**（Drive から取ってくるものが無い）
- `SKIPPED_NO_BODY` として記録し、「求職者本人がお気に入りに入れた求人（PDF実体なし）」であることが分かるようにする
- 将来 `generateAndStorePdf` 相当が後から実体を付ける可能性はあるが、その場合は `driveFileId` が NULL から埋まる更新を検知する必要がある（Phase 1 では対象外でよい）

### 10-6. ★ `replace-docx` / `replace-xlsx` の差し替えが OneDrive に反映されない

`files/[fileId]/replace-docx/route.ts:69-94` は、同一 `CandidateFile` 行の `driveFileId` だけを新しいものに差し替える。**`fileName` は変わらない**（75行で `existing.fileName` を使い回している）。

したがって:
1. 初回アップ時に OneDrive へ `職務経歴書.docx` がコピーされる
2. CA が portal で内容を差し替える
3. 再コピーしようとしても**同名スキップに引っかかり、OneDrive は古い版のまま**

「上書きしない」は確定仕様なので Phase 1 ではこれで正しいが、**CA が「OneDrive の職務経歴書が古い」と混乱する典型パターン**。差し替え時は `SKIPPED_DUPLICATE` の記録を新しく残し、理由文言を「portalで内容が差し替えられましたが、OneDriveには同名ファイルがあるため上書きしていません」と分けて出すことを推奨。

### 10-7. 4MB 超えのアップロードは simple PUT では通らない【実測: 最大 2.03MB だが上限 20MB】

直近90日のファイルサイズ:

| カテゴリ | 件数 | 平均 | 最大 |
|--|--|--|--|
| BOOKMARK | 6,404 | 295 KB | 763 KB |
| BS_DOCUMENT | 687 | 134 KB | 2.03 MB |

実測では 4MB を超えていないが、**upload route の上限は 20MB**（`upload/route.ts:10`）。いつ 4MB 超のファイルが来てもおかしくない。

Graph の simple PUT（`:/content`）は 4MB（実質 250MB まで通る場合もあるが公式には 4MB）が境界。**`createUploadSession` によるチャンク送信の実装を最初から入れておくこと。**後から追加すると「なぜかたまに失敗する」の調査コストが高い。

### 10-8. ★ 全角チルダ `～` と異体字 `﨑` の Unicode 正規化差異【実測: 313件 / 1件】

パスに `～`（U+FF5E FULLWIDTH TILDE）が **313件**、`﨑`（U+FA11 CJK COMPATIBILITY IDEOGRAPH）が1件含まれる。

- Windows / SharePoint は環境により U+FF5E と U+301C（WAVE DASH）を取り違えることがある
- U+FA11 は NFC 正規化で U+FA11 のままだが、NFD/NFKC では U+FA11 → U+2F9xx 系や `崎` に変換されうる
- portal（Node.js / PostgreSQL）が保持している文字列と、SharePoint 上の実際のフォルダ名のバイト列が一致しない場合、**Graph が `itemNotFound`（404）を返す**

**この404は「フォルダが本当に無い」のか「正規化差異でヒットしない」のか区別がつかない**まま `SKIPPED_NO_SUBFOLDER` に落ちる。

対策:
- `ONEDRIVE_SYNC_ENABLED=true` にする前に、**`～` を含む求職者フォルダ1件で疎通確認を必ず行う**（手順7）
- 404 時に `String.normalize("NFC")` と `normalize("NFD")` の両方でリトライする実装を入れる（実装コスト 10行程度）
- `SKIPPED_NO_SUBFOLDER` の件数が異常に多い場合は正規化を疑う、と運用メモに残す

### 10-9. `next build` を起動中の `next dev` と並行させない

`ref_next_build_breaks_running_dev` のとおり、dev 稼働中に build すると全リクエストが 500（Jest worker）になる。Phase 2 の実装検証時に踏みやすい。

また `scripts/*.ts` に import/export の無いファイルを追加すると `next build` が型エラーで落ちる（`ref_scripts_ts_module_conflict`）。本件で手動実行スクリプトを追加する場合は末尾に `export {};` を付けること。

### 10-10. クライアントシークレットの有効期限切れで全停止する

Azure のクライアントシークレットは最長24か月。期限が切れると `AADSTS7000222`（invalid_client）でトークン取得が全滅し、**すべてのコピーが `FAILED` になる**。

- 発行時に有効期限をカレンダー登録する（手順3-7）
- 期限の1か月前に気づけるよう、`GIVEN_UP` が急増したら通知する仕組みを Phase 2 で検討
- 失効しても **portal のアップロード自体は成功し続ける**（fire-and-forget で隔離されているため）。つまり**静かに壊れる**。これが最も危険な失敗モード

### 10-11. staging と production は同一 DB を共有している

`ref_staging_prod_shared_db` のとおり、staging URL への POST も本番 DB（trolley）に書き込まれる。

**staging に `MS_GRAPH_CLIENT_SECRET` を入れて動作確認すると、本番の OneDrive に実ファイルが書き込まれる。**staging では `ONEDRIVE_SYNC_ENABLED=false` にしておくか、書き込み先を別の検証用フォルダに向ける環境変数（`ONEDRIVE_PATH_PREFIX_OVERRIDE` 等）を用意すること。

### 10-12. Graph のスロットリング（429）

1日あたり約56件のコピーは Graph の制限（ユーザーあたり毎分数百リクエスト）に対して余裕がある。ただし:

- 夜間 cron で溜まった `FAILED` を50件連続処理すると、短時間に集中する
- **`Retry-After` ヘッダを必ず尊重する**（Graph は 429 と共に秒数を返す）。無視して再試行するとバンの対象になる
- 指数バックオフの初期値は 2秒、最大 5回、上限 5分程度

### 10-13. `2.求人` / `3.BS作成書類` の実在確認ができていない

**Graph API への実接続を行っていないため（Azure 設定が未完のため禁止事項）、1,734の求職者フォルダ配下に `2.求人` `3.BS作成書類` が実際に存在するかは未確認。**

`Candidate.oneDriveFolderUrl` は求職者フォルダを指しており、`2.求人` を指すものは0件だった（Step 2 の全件検査）。**「原本フォルダのコピーで作られるので必ずある」という前提が実際に何%で成立するかは、Phase 2 の疎通確認で最初に測るべき数値。**ここが低いと `SKIPPED_NO_SUBFOLDER` が大量発生し、論点5の CA 向け表示の重要度が跳ね上がる。

サブフォルダ名の**厳密な表記**（`2.求人` か `2．求人` か `2. 求人` か）も未確認。全角ピリオドや後続スペースの有無で 404 になる。**Phase 2 の最初のタスクとして、Graph で1求職者フォルダの子アイテム一覧を取得し、実際の名前を確認すること。**

---

## 完了後の報告事項サマリ

| # | 項目 | 結論 |
|--|--|--|
| 2 | upload route に差し込める構造か | **差し込める。**198行（`recalculateSubStatusIfAuto` ブロック）の直後が最適。既存の同型前例あり。ただし142行の `try` の内側で素直に `await` すると Graph の失敗が 500 に化けるため、fire-and-forget か独立 try/catch が必須 |
| 3 | バイト列が手元に残るか | **残る。**`upload/route.ts:152` の `fileBuffer` がレスポンス返却まで生存。Drive 再取得不要。ただし **cron の再試行経路では手元に無く `downloadFileFromDrive` が必要** |
| 4 | パス復元の検証と推奨 | **1734/1734 成功・失敗0件。**`%2E`/`%5F`/`%20` すべて正常。UPN は1種類。**推奨は「URL から都度復元」**（列を足さない） |
| 5 | 既存 Microsoft 実装 | **ゼロ。**必要な環境変数6本 / 権限は `Files.ReadWrite.All`（アプリケーション）/ **管理者同意は必要** |
| 6 | Azure 設定手順書 | 本文 Step 3-3（手順1〜7） |
| 7 | 6論点の推奨 | ①レコード作成と同tx で PENDING → fire-and-forget（差し込み3か所） ②新規テーブル `OneDriveSyncLog`（9値の enum） ③GitHub Actions cron JST 02:00 + `/api/internal/onedrive-sync/retry` ④**フラット配置**（階層は再現しない） ⑤専用画面は作らず既存一覧にバッジ ⑥下記 |
| 8 | 想定実装規模 | **新規6ファイル ~555行 / 変更9ファイル ~149行 = 計 ~704行 / 15ファイル** |
| 10 | 最重要の懸念 | ①**BOOKMARK の73%が upload route を通らない**（`generateAndStorePdf` への差し込み必須） ②`Files.ReadWrite.All` はテナント全体権限 ③保存先が特定個人の OneDrive ④全角チルダ313件の正規化差異 ⑤`2.求人` の実在率が未確認 |
