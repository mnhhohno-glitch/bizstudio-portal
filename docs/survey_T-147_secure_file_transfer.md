# T-147 セキュアファイル送信機能 — Phase 1 調査報告

対象: bizstudio-portal（master worktree, 2026-08-02 時点）
結論: **必要な基盤はほぼ全部そろっている。新規に導入が必要なのは「テーブル」「送信元画面」「期限切れ削除cron」だけ。**
ただし前提のうち **2点が実際とズレている**ので先に読むこと（§0）。

---

## 0. 事前共有の前提とのズレ（重要）

| プロンプトの前提 | 実際 |
|---|---|
| ファイル保管は Supabase Storage（面談添付 `InterviewAttachment` で稼働中） | `InterviewAttachment` + Supabase の経路は **T-067 Phase5 で DEPRECATED**。`src/app/api/interviews/[id]/attachments/route.ts:1-6` に「source of truth は CandidateFile / Google Drive に統合済み」と明記。現在 Supabase を能動的に使っているのは **タスク添付（`task-attachments` バケット）だけ**で、しかもそれは `getPublicUrl()` = **公開バケット**運用（`src/app/api/tasks/[taskId]/attachments/route.ts:111`）。そのまま流用すると「URLを知る全員がDL可能」になり要件を満たさない |
| portal にメール送信実装は無い（要調査） | **既にある**。Resend を素の `fetch` で叩いている（`src/lib/candidate-site-notifications.ts:199-253`）。パッケージ追加も不要 |

さらに **既に「パスワード付き共有URL」機能が本番稼働している**（`FileShareLink` / `/share/[token]`）。T-147 はこれの一般化にあたるので、§7 の「拡張 or 新規」判断が最初の分岐点になる。

---

## 1. メール送信（調査項目1）

### 現状
- 実装箇所: `src/lib/candidate-site-notifications.ts`
  - `RESEND_API_URL = "https://api.resend.com/emails"` を `fetch` で直接POST（SDK不使用・`package.json` に resend/nodemailer 等なし）
  - `from: "BizStudio <noreply@bizstudio.co.jp>"` — **bizstudio.co.jp のドメイン認証済みという前提は裏付けられた**
  - 認証: `Authorization: Bearer ${process.env.RESEND_API_KEY}`
  - タイムアウト 10秒（`AbortController`）、失敗しても本処理を落とさない fail-open 設計
- 呼び出し元: `src/app/api/external/candidate-site/response-submission/route.ts`（求職者のまとめ送信確認メール）

### 必要な作業
- **依存パッケージ追加: 不要**（`fetch` の既存パターンをそのまま流用すればよい。`resend` SDK を入れてもよいが既存と二重実装になる）
- **環境変数**: `RESEND_API_KEY`
  - ローカル `.env` にも `.env.example` にも**無い**。コードは未設定なら `console.warn` してスキップする実装なので、**本番 Railway に設定済みかどうかはコードからは確定できない**。Phase 2 着手前に Railway 変数を実機確認すること（未設定だとメールが「静かに送られない」）
  - `.env.example` への追記も併せて行う（現状 Supabase / Resend / LINE WORKS 系が軒並み未記載）

### 配信状態の取得（調査項目・技術注意点4）
- 現行コードは `res.status === 200|201` を見るだけで、**Resend が返す `id`（メッセージID）を保存していない**。
- 配信状態を送信者が確認できるようにするには次のどちらか:
  - **(A) Webhook 方式（推奨）**: Resend ダッシュボードで `email.delivered` / `email.bounced` / `email.complained` を portal のエンドポイントへ飛ばす。`/api/webhooks/resend`（middlewareの `/api/` 素通しに乗るので署名検証を自前で実装）。リアルタイムで一覧に反映できる。
  - **(B) ポーリング方式**: 送信時に返る `id` を DB に持ち、`GET https://api.resend.com/emails/{id}` を一覧表示時に叩く。実装は軽いが N+1 と レート制限が気になる。
- いずれにせよ **送信レコードに `resendMessageId` と `deliveryStatus` を持たせるのが前提**（§7 のテーブル案に含めた）。

---

## 2. Supabase Storage の既存実装（調査項目2）

### クライアント
`src/lib/supabase.ts`（全23行）
```ts
createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
```
- **サービスロールキー**でのサーバー専用クライアント。遅延初期化 + Proxy で `supabase` 名前付きエクスポートも提供。
- 環境変数: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（本番設定済みの記録あり: `T-062_phase1A_investigation_report.md:533-538`）

### バケットと使われ方

| バケット | 使用箇所 | 公開/非公開 | 状態 |
|---|---|---|---|
| `interview-attachments` | `api/interviews/[id]/attachments/**` | 非公開（署名付きURL） | **DEPRECATED**（Drive へ移行済み・ロールバック用に残置） |
| `task-attachments` | `api/tasks/[taskId]/attachments/**`, `api/candidates/[candidateId]/files/attach-to-task` | **公開**（`getPublicUrl`） | 稼働中 |

### 保存の流れ（`api/interviews/[id]/attachments/route.ts` POST）
1. `getSessionUser()` で認証
2. `req.formData()` → `File` 取得
3. サイズ検証（20MB上限）・MIME ホワイトリスト検証
4. `storagePath = interviews/${id}/${randomUUID()}.${ext}`（**元ファイル名は使わず衝突不能なUUID名**、表示名はDBに保持）
5. `supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert:false })`
6. Prisma に行を作成（`filePath` に storagePath）

### 署名付きURLの発行（`api/interviews/[id]/attachments/[attachmentId]/route.ts:41`）
```ts
supabase.storage.from(BUCKET).createSignedUrl(attachment.filePath, 300)  // 300秒
```
→ **プロンプトが要求している「照合成功時に短命の署名付きURLを発行」はこの1行でそのまま実現できる**。
現行はJSONで返しているが、T-147 では `NextResponse.redirect(signedUrl)` にすればファイル本体は Railway を通らない。

### T-147 での方針（推奨）
- **新規に非公開バケット `secure-transfers` を作る**（`task-attachments` の公開バケットは流用しない）
- パス規約: `transfers/${transferId}/${fileUuid}.${ext}` — 元ファイル名はパスに入れない（日本語ファイル名 + Supabase のキー制約回避も兼ねる）
- Google Drive を使わない理由: `downloadFileFromDrive()` は**ファイル全体を base64 でメモリに載せてから返す**（`src/lib/google-drive.ts:134-156`）ため Railway 転送量・メモリの両方で不利。Drive には期限付き署名URLの概念も無い（公開 or サービスアカウント経由の二択）。

---

## 3. ブラウザ → Supabase 直アップロード（調査項目3）

### 結論: **使える。ただし現リポジトリに実装例は無い（新規実装）。**

- `@supabase/supabase-js` **v2.99.1** が入っており、`storage.from(bucket).createSignedUploadUrl(path)` が利用可能。
- 流れ:
  1. ブラウザ → portal API（`POST /api/secure-transfers/[id]/upload-url`、`getSessionUser()` で認証）にファイル名・サイズを送る
  2. サーバーがサービスロールで `createSignedUploadUrl(storagePath)` を発行して `{ signedUrl, token, path }` を返す
  3. ブラウザが `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)` で**直接**PUT（anonキーもサービスロールキーもブラウザに露出しない）
  4. 完了後 ブラウザ → portal API に `{ path, size, mimeType }` を通知して DB 行を作成（**サーバー側で `storage.from().list()` 等で実在とサイズを検証してから確定する**こと。クライアント申告のサイズを信用しない）
- **Next.js のボディサイズ制限について**: `next.config.ts` には制限設定なし。ルートハンドラ（`req.formData()`）には Next の 1MB 制限は掛からない（あれは Server Actions の `bodySizeLimit`）。実際の壁は Railway のリクエストタイムアウトとコンテナメモリ（`Buffer.from(await file.arrayBuffer())` で全量メモリ展開する既存実装は大容量に弱い）。
- **推奨**: 第1弾は既存踏襲でサーバー経由（上限20MB）とし、直アップロードは「実装するなら最初から」。後付けは UI を作り直すことになるので、**大きい契約書PDFを想定するなら Phase 2 で直アップロード方式を採る**判断を先に決めておくのが安い。

---

## 4. 認証不要ページと middleware（調査項目4）

`src/middleware.ts`:
```ts
// 最優先で素通しする公開プレフィックス
if (pathname.startsWith("/g/") || pathname.startsWith("/api/guides/") ||
    pathname.startsWith("/j/") || pathname.startsWith("/api/jimu/") ||
    pathname.startsWith("/share/") || pathname.startsWith("/api/share/")) return NextResponse.next();

// 公開パス（★ /api/ が丸ごと含まれる）
if (pathname.startsWith("/login") || ... || pathname.startsWith("/api/")) return NextResponse.next();
```

**押さえるべき2点:**
1. **`/share/` と `/api/share/` は既に除外済み** — 同じ prefix を使うなら middleware 変更は不要。別 prefix（例 `/secure/`）にするなら第1ブロックに追加する。
2. **`/api/` は全部 middleware をスルーする** = API の認証はルート側で自前実装が必須。T-156 のコードにも `// middleware は /api/ を素通しするため、admin 判定はこのルートで行う（漏れ禁止）` と明記されている（`api/announcements/[id]/attachments/route.ts:15`）。T-147 の管理系API（作成・一覧・無効化）は必ず `getSessionUser()` を先頭に置くこと。

補足: 認証不要ページは `src/app/(app)/` 配下に置かない。既存の `src/app/share/layout.tsx` のように `(app)` の外に独立レイアウトで作る（`(app)` レイアウトはサイドバー等のログイン前提UIを持つ）。

---

## 5. 暗号化ユーティリティ（調査項目5）

`src/lib/encryption.ts`（全53行）

| 関数 | 内容 | T-147 での用途 |
|---|---|---|
| `encrypt(plain)` / `decrypt(b64)` | AES-256-GCM。鍵 = `sha256(process.env.MANUS_KEY_ENCRYPTION_SECRET)`、IV12B + 暗号文 + authTag16B を base64 連結 | **使わない**（パスワードは復号可能にしてはいけない） |
| `hashToken(token)` | `sha256` hex | DL用トークンをDBに平文で持たない場合に使える |
| `generateToken(prefix)` | `crypto.randomBytes(48).toString("base64url")` にプレフィックス | **推測不可能なURLトークン生成にそのまま使える**（48バイト = 384bit、十分） |

**パスワードのハッシュは bcryptjs を使う**（`bcryptjs@3.0.3` 導入済み）。既存 `share-link` が `hash(pw, 10)` / `compare(pw, hash)` で実装済みなので同じ粒度で揃える。要件「元の文字列をDBに平文で持たない」はこれで満たす。

注意: 発行直後の**平文パスワードは、メール送信のためにその場のメモリでだけ使い、レスポンスにも監査ログにも残さない**。再表示は不可（＝再発行する）という仕様にするのが素直。

環境変数 `MANUS_KEY_ENCRYPTION_SECRET` / `PORTAL_SSO_SECRET` も `.env.example` 未記載。

---

## 6. 定期実行の仕組み（調査項目6）

### 結論: **Railway の scheduled job / vercel.json は無い。GitHub Actions の `schedule` が唯一の定期実行基盤。**

`.github/workflows/` に3本:

| ファイル | スケジュール | 叩き先 |
|---|---|---|
| `auto-expire-daily.yml` | JST 03:00 | staging URL |
| `t131-resubmit-stale.yml` | 2時間おき | `/api/internal/bookmarks/resubmit-stale` |
| `t150-task-due-reminder.yml` | JST 07:00（`cron: "0 22 * * *"` UTC） | `/api/internal/tasks/due-reminder`（production） |

共通パターン:
- `curl -X POST <prod URL>/api/internal/... -H "x-api-key: ${{ secrets.INTERNAL_API_KEY }}"`
- サーバー側は `validateInternalApiKey(request)`（`src/lib/internal-auth.ts` — `x-api-key` と `process.env.INTERNAL_API_KEY` の一致だけ）
- `?dry_run=true` を既定にし、schedule 実行時のみ `false`。DB書き換え/外部投入を伴うものは `confirm=true` の二段ガード
- ワークフローは **master（default branch）に置かないと schedule が動かない**
- **`INTERNAL_API_KEY` は本番 Railway・GitHub Secrets とも設定済み**（`docs/reports/T-131-permanent-fix-A.md:36` に確認記録）→ **T-147 の cron に新規シークレット登録は不要**

### T-147 での実装
`POST /api/internal/secure-transfers/expire`（JST 深夜1回）で
1. `expiresAt < now()` かつ 未削除 のレコードを抽出
2. Supabase `storage.from(BUCKET).remove(paths)` で実ファイル削除
3. `isActive=false` / `filesDeletedAt=now()` を立てる（**行自体は消さない** — 「誰にいつ送ったか」の記録は残す要件のため）
4. `dry_run` 既定 true、`confirm` 二段ガードあり（ファイル削除は取り返しがつかないため resubmit-stale と同格に扱う）

**期限切れ判定の日付罠について（技術注意点2）:**
`expiresAt` を `DateTime`（時刻付きインスタント）で持つ限り、`new Date() > link.expiresAt` の比較は**タイムゾーン非依存で安全**（既存 `api/share/[token]/verify/route.ts:27` と同じ）。`toISOString().slice(0,10)` の罠が出るのは「日付だけを文字列比較する」設計にした場合。
JSTが効くのは次の2箇所だけなので、そこで `src/lib/dailyReport/jstDate.ts` のヘルパ（`todayJstDateString` / `jstDateEnd` / `toJstDateString`）を使う:
- **期限の計算**: 「7日後」を JST のその日の 23:59:59 に丸める場合 → `jstDateEnd(...)`
- **画面・メール本文への表示**: `toJstDateString(expiresAt)`

---

## 7. 既存 `FileShareLink` との関係 ＋ テーブル構成案（調査項目7）

### 7-1. 既存機能の実測

**すでに「パスワード付き共有URL」が本番にある。** T-147 はその一般化。

| 要素 | 実装 |
|---|---|
| モデル | `FileShareLink`（`prisma/schema.prisma:553-567`）: `token(unique)` / `candidateId(必須FK)` / `fileIds(カンマ区切り文字列)` / `passwordHash` / `expiresAt` / `isActive` / `downloadCount` / `createdBy` |
| 発行API | `POST /api/candidates/[candidateId]/share-link` — 対象は `CandidateFile` の `category=BS_DOCUMENT` のみ。**パスワード＝求職者の生年月日8桁**（自動生成ではない）。期限 **14日固定**。メール送信なし |
| 画面 | `/share/[token]`（`src/app/share/[token]/page.tsx`）— 「生年月日を入力してください」固定文言 |
| 照合API | `POST /api/share/[token]/verify` — bcrypt `compare` → `jsonwebtoken` で2時間有効のJWTを Cookie `share_<token>` に発行 |
| DL API | `GET /api/share/[token]/download/[fileId]` / `download-all`（ZIP・`archiver`）— **Google Drive から base64 で落として portal サーバー経由で配信**。`downloadCount` を increment するだけ |
| UI導線 | `src/components/candidates/DocumentsTab.tsx:578` |

**要件とのギャップ**: 求職者必須 / パスワード自動生成でない / メール送信なし / **DL履歴が件数カウントのみ（日時・IPなし）** / 無効化UIなし / 送信一覧画面なし / 期限切れファイルの自動削除なし。

### 7-2. 拡張 vs 新規 — **新規テーブルを推奨**

理由:
- `candidateId` が必須FK。T-147 は「クライアント企業へ契約書を送る」＝求職者に紐づかない送信が主。nullable 化は既存本番データ・既存導線への破壊的変更になる
- `fileIds` がカンマ区切り文字列。ファイル単位の属性（保存パス・サイズ・削除済みフラグ）を持てない
- 保管先が Drive 前提。T-147 は Supabase 非公開バケット
- 既存 `/share/` の画面文言が「生年月日を入力」に固定されており、UI も分岐だらけになる

→ **既存 `FileShareLink` は一切触らず**、新規3テーブル + 新規 prefix `/secure/` で作る。

### 7-3. テーブル構成案

```prisma
// T-147: セキュアファイル送信（社外向け・ZIPパスワード運用の置き換え）
model SecureTransfer {
  id             String   @id @default(cuid())
  token          String   @unique                        // URLに載る推測不能トークン（generateToken 相当・48B base64url）
  title          String?                                 // 件名・用途メモ（送信一覧の識別用）
  passwordHash   String   @map("password_hash")          // bcrypt。平文は保存しない
  expiresAt      DateTime @map("expires_at")             // インスタントで保持（日付文字列にしない＝罠#17回避）
  isActive       Boolean  @default(true) @map("is_active") // 送信者による即時無効化フラグ
  revokedAt      DateTime? @map("revoked_at")
  revokedByUserId String?  @map("revoked_by_user_id")

  // 宛先・メール
  recipientEmail   String   @map("recipient_email")
  recipientName    String?  @map("recipient_name")
  emailSentAt      DateTime? @map("email_sent_at")
  resendMessageId  String?  @map("resend_message_id")    // Resend の id。配信状態の照会キー
  deliveryStatus   String?  @map("delivery_status")      // sent / delivered / bounced / complained（webhook or ポーリングで更新）
  deliveryUpdatedAt DateTime? @map("delivery_updated_at")

  // ファイル実体の掃除
  filesDeletedAt DateTime? @map("files_deleted_at")      // 期限切れcronが実ファイルを消した時刻。行自体は残す

  // 任意の求職者紐付け（第1弾は未使用でも良い。将来の求職者詳細からの導線用）
  candidateId    String?   @map("candidate_id")
  candidate      Candidate? @relation(fields: [candidateId], references: [id])

  createdByUserId String   @map("created_by_user_id")
  createdByUser   User     @relation("SecureTransfersCreated", fields: [createdByUserId], references: [id])
  createdAt       DateTime @default(now()) @map("created_at")

  files      SecureTransferFile[]
  downloads  SecureTransferDownload[]

  @@index([createdByUserId, createdAt])
  @@index([expiresAt, filesDeletedAt])   // 期限切れ掃除cronのスキャン用
  @@map("secure_transfers")
}

model SecureTransferFile {
  id          String   @id @default(cuid())
  transferId  String   @map("transfer_id")
  transfer    SecureTransfer @relation(fields: [transferId], references: [id], onDelete: Cascade)
  fileName    String   @map("file_name")     // 表示用の元ファイル名（日本語可）
  storagePath String   @map("storage_path")  // Supabase: transfers/<transferId>/<uuid>.<ext>
  fileSize    Int      @map("file_size")
  mimeType    String   @map("mime_type")
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at")

  downloads   SecureTransferDownload[]

  @@index([transferId])
  @@map("secure_transfer_files")
}

model SecureTransferDownload {
  id         String   @id @default(cuid())
  transferId String   @map("transfer_id")
  transfer   SecureTransfer @relation(fields: [transferId], references: [id], onDelete: Cascade)
  fileId     String?  @map("file_id")          // null = 一括DL
  file       SecureTransferFile? @relation(fields: [fileId], references: [id], onDelete: SetNull)
  action     String                            // "VERIFY_OK" / "VERIFY_FAIL" / "DOWNLOAD"
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent") @db.Text
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([transferId, createdAt])
  @@map("secure_transfer_downloads")
}
```

設計上の意図:
- **`SecureTransferDownload` にパスワード照合の失敗（`VERIFY_FAIL`）も記録する** — 誤送信・総当たりの検知に効く。件数カウントだけの既存実装では事故対策（目的2）にならない
- `filesDeletedAt` により「実体は消えたが記録は残る」を表現。送信一覧は `isActive` / `expiresAt` / `filesDeletedAt` の3つで状態表示（有効 / 期限切れ / 無効化済み / 削除済み）
- `candidateId` は nullable で最初から持つ（後付けマイグレーションを避ける。§ 未確定判断の回答がどちらでも困らない）

### 7-4. IPアドレスの取得
リポジトリ内に `x-forwarded-for` を読む既存実装は**無い**（新規）。Railway はプロキシ配下なので
`request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip")` で取る。

---

## 8. 参考: 既存 `/api/share/` に見つかった懸念（T-147 スコープ外・別途要判断）

`src/app/api/share/[token]/verify/route.ts:6` および `download/[fileId]/route.ts:6`:
```ts
const SHARE_SECRET = process.env.PORTAL_SSO_SECRET || "bizstudio-sso-shared-secret-key";
```
**シークレットのハードコード・フォールバックがある。** 本番で `PORTAL_SSO_SECRET` が未設定だと、この既知文字列でアクセスJWTを偽造でき、パスワード照合を迂回して `fileIds` を自由に指定できる（別途 `token` の存在と `fileId` の知得は必要）。
T-147 では**フォールバック無し・未設定なら起動時/実行時エラー**の方針にする。既存側の是正は別チケット扱いを推奨（Phase 2 で本番の `PORTAL_SSO_SECRET` 設定有無だけは確認したい）。

---

## 9. Phase 2 に必要な事前確認（着手前）

1. **`RESEND_API_KEY` が本番 Railway に設定されているか**（未設定でも例外が出ず静かにスキップされる実装のため、実機確認が必要）
2. **Supabase に非公開バケット `secure-transfers` を作成**（ダッシュボード作業。Public を OFF にすること）
3. **配信状態の取得方式**: Webhook（推奨）/ ポーリング / 第1弾は見送り のどれにするか
4. **大容量対応**: サーバー経由 20MB 上限で始めるか、最初から ブラウザ→Supabase 直アップロードで作るか
5. **未確定の業務判断（プロンプト記載）**: 送信の起点を「独立画面のみ」にするか「求職者詳細からの導線も作る」か
   → テーブル案は `candidateId` を nullable で先に持たせてあるので、**どちらに決まっても Phase 2 のマイグレーションはやり直しにならない**

## 10. 変更が必要になるファイル（Phase 2 見込み）

| 種別 | パス |
|---|---|
| 新規 | `prisma/migrations/<ts>_t147_secure_transfers/migration.sql` + `schema.prisma` 追記 |
| 新規 | `src/lib/secure-transfer.ts`（トークン/パスワード生成・期限計算・状態判定） |
| 新規 | `src/lib/mailer.ts`（Resend 送信の共通化。`candidate-site-notifications.ts` の直書きを再利用可能な形に切り出す） |
| 新規 | `src/app/api/secure-transfers/route.ts`（作成・一覧）, `[id]/route.ts`（無効化）, `[id]/upload-url/route.ts` |
| 新規 | `src/app/api/secure/[token]/verify/route.ts`, `download/[fileId]/route.ts`（署名付きURLへ 302） |
| 新規 | `src/app/secure/[token]/page.tsx` + `layout.tsx`（`(app)` の外） |
| 新規 | `src/app/(app)/secure-transfers/page.tsx`（送信一覧） |
| 新規 | `src/app/api/internal/secure-transfers/expire/route.ts` + `.github/workflows/t147-secure-transfer-expire.yml` |
| 変更 | `src/middleware.ts`（第1ブロックに `/secure/` `/api/secure/` を追加） |
| 変更 | `.env.example`（`RESEND_API_KEY` / `SUPABASE_*` / `INTERNAL_API_KEY` 等の追記） |

**変更禁止ファイルには一切触れない**（`src/constants/candidate-flags.ts` / `specs/` / `scripts/gas/` / `loadSpec.ts` / `geminiClient.ts` / `entry-flag-rules.ts`）。
