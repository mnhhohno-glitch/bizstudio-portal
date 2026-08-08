# T-156 Phase 1 調査レポート — お知らせへの資料添付機能

調査日: 2026-08-02 / 対象: bizstudio-portal（master worktree）
**実施範囲: 調査のみ。アプリコードは1行も変更していない。本番DBは count / findMany（SELECT）のみ。**

---

## ★最初に読むこと — 指示書の前提と異なる事実（5件）

### (1) 「詳しくはこちら → PDF表示」は**実装ゼロで今日から実現できる**

お知らせ本文は `ReactMarkdown` + `remarkGfm` でレンダリングされており、リンクはそのまま機能する
（`src/app/(app)/announcements/[id]/page.tsx` L64-108、`a` コンポーネントは `target="_blank"` 付き）。

一方、`/manuals`（マニュアル）には **PDFをドラッグ&ドロップ → Google Drive にアップロード → 詳細ページで iframe インライン表示** という機能が
**既に完成した状態で存在する**（本番に7件の Drive PDF が登録済み）。

→ 「マニュアルにPDFを登録 → そのURLをお知らせ本文に `[詳しくはこちら](https://...)` として貼る」だけで、要件の1〜4はすべて満たせる。
実装量ゼロ。**次のリリース周知は、T-156 の実装を待たずに運用開始できる**（後述 Phase 0）。

### (2) 「資料一覧」（`/documents`）は PDF アップロード機能を**持っていない** — 候補から外れる

`Document` モデルは `url: String`（必須・自由入力文字列）を iframe に流し込むだけの機能。
管理画面 `/admin/documents` にファイル選択欄は無く、URLを手でタイプする（プレースホルダは `例: /documents/interview-basics.html`）。
本番データは**1件のみ**、中身は外部サイト `https://bizstudio-interview.manus.space`（求職者向け面接対策ガイド）。

→ 指示書は「資料一覧」「マニュアル」を並べて案Bの受け皿候補としているが、**PDFの置き場所として成立するのはマニュアルのみ**。
資料一覧を使うには、そもそも PDF をどこかにアップロードして URL を得る手段が別途必要で、本末転倒。

### (3) `Announcement` に添付ファイルに使えるカラムは**存在しない** — 新規追加が必要（案Aを採る場合）

全カラムは後述の通り 9 本のみで、ファイル・URL・添付を保持できる余地はゼロ。

### (4) マニュアルの**作成はログイン済み全員が可能**（admin 限定ではない）

- `/api/manuals/create`: `getSessionUser()` の null チェックのみ。role 判定なし
- `/api/manuals/upload-pdf`: 同上
- 削除のみ admin 限定、編集は admin または作成者

一方お知らせは作成・更新・削除すべて `actor.role !== "admin"` で 403。
→ 指示書の「アップロードするのは管理者（大野将幸）のみ」という運用前提は、**案B（マニュアル経由）では担保されない**。
CA が誰でもリリース資料を作成・上書きできる状態になる。

### (5) Google Drive アップロードは**必ず「リンクを知る全員が閲覧可」権限を付与する**

`src/lib/google-drive.ts` L50-57 — `uploadFileToDrive` はアップロード直後に無条件で
`permissions.create({ role: "reader", type: "anyone" })` を実行する。分岐やオプションは無い。

→ アップロードされた操作ガイドPDFは、**URLさえ知っていれば portal に未ログインの外部の人間でも閲覧できる**。
既存のマニュアルPDF 7件・求職者の添付ファイル全件が既にこの状態。
「閲覧するのは社員全員」という指示書の権限前提と、実装の実態（実質パブリック）は一致していない。
社外秘の操作手順を置く場合は Phase 3（portal 経由配信への切替）を検討すること。

---

## 1. お知らせ機能の現状

### 1-1. `Announcement` モデルの全カラム

`prisma/schema.prisma` L692-705（テーブル名 `announcements`）

| カラム | 型 | 用途 |
|--|--|--|
| `id` | String @id @default(cuid()) | 主キー |
| `title` | String | タイトル。一覧・詳細のH1、検索対象 |
| `content` | String @db.Text | 本文。**Markdown**。一覧では100文字で切って表示、詳細で全文レンダリング。検索対象 |
| `category` | AnnouncementCategory | `IMPORTANT` / `FEATURE` / `FIX` / `MAINTENANCE` / `RELEASE` の5値。バッジ色は `src/lib/constants/announcement.ts` |
| `status` | AnnouncementStatus @default(DRAFT) | `PUBLISHED` / `DRAFT`。一般向けAPIは `PUBLISHED` のみ返す |
| `publishedAt` | DateTime? | 公開日時。DRAFT→PUBLISHED の遷移時に `new Date()` がセットされる。一覧の並び順キー（desc） |
| `authorUserId` | String | 投稿者。`User` への FK |
| `createdAt` | DateTime @default(now()) | 作成日時（UIには未使用） |
| `updatedAt` | DateTime @updatedAt | 更新日時（UIには未使用） |

**添付ファイルに使えるカラムは存在しない。**（★(3)）

### 1-2. 一覧画面 `/announcements` の構造 — **詳細ページは存在する**

`src/app/(app)/announcements/page.tsx`（クライアントコンポーネント）

- 一覧カード = カテゴリバッジ / 公開日 / タイトル / **本文を100文字で truncate**（L106-109） / 「続きを読む →」リンク
- 「続きを読む →」は `/announcements/{id}` へ遷移（L245-250）
- 一覧に本文が展開される形**ではない**。検索（キーワード）・カテゴリ絞込・期間絞込（1週/1月/3月）・10件ページネーション付き
- データ取得は `GET /api/announcements`

`src/app/(app)/announcements/[id]/page.tsx`（**サーバーコンポーネント**）

- `prisma.announcement.findUnique({ where: { id, status: "PUBLISHED" } })` を直接叩く（API 経由ではない）
- カテゴリバッジ → タイトル → `公開日時 ・ 投稿者: 名前` → `<hr>` → 本文 Markdown、という縦一列の構造
- **本文の下には何も無い**。添付セクションを足す場所として最も自然（L109 の `</div>` 直後）

→ **「詳しくはこちら」の置き場所は詳細ページ。**一覧に置く必要はない（一覧には📎バッジ程度で十分。後述 5章）。

補足: ダッシュボード（`/`）にも「お知らせ」タブがあり `GET /api/announcements/recent?limit=N` で直近3件を出す（`src/components/dashboard/DashboardTabs.tsx`）。

### 1-3. 管理画面 `/admin/announcements` の構造

`src/app/(app)/admin/announcements/page.tsx`（クライアントコンポーネント・339行）

- テーブル（タイトル / カテゴリ / ステータス / 公開日 / 編集・削除ボタン）
- **投稿・編集は同一のモーダル**（L225-307）。`formData` は3フィールドのみ:

```ts
type FormData = { title: string; content: string; category: AnnouncementCategoryKey };
```

- モーダル内のフィールド順: タイトル（input）→ カテゴリ（select）→ **本文（textarea rows=10, font-mono, ラベルは「本文（Markdown）」）**
- 本文ラベルの右に「✨ AIで整理する」ボタン（`POST /api/admin/announcements/ai-format`。content を Markdown 整形して差し替える）
- フッタは「キャンセル」「下書き保存」「公開する」
- **ファイル選択欄は存在しない**

API:

| ルート | メソッド | 認可 |
|--|--|--|
| `/api/admin/announcements` | GET | admin |
| `/api/admin/announcements/create` | POST | `actor.role !== "admin"` → 403。作成後 `AuditLog(ANNOUNCEMENT_CREATE)` |
| `/api/admin/announcements/[id]/update` | PATCH | 同上。`ANNOUNCEMENT_UPDATE` |
| `/api/admin/announcements/[id]/delete` | DELETE | 同上。`ANNOUNCEMENT_DELETE` |
| `/api/admin/announcements/ai-format` | POST | — |

### 1-4. 本文の Markdown レンダリング — リンク/ボタンは埋め込める

詳細ページ L63-109。`ReactMarkdown` + `remarkGfm`、カスタム `components` で h1-h3 / p / ul / ol / li / code / pre / **a** / blockquote / table / th / td を上書き。

```tsx
a: ({ href, children }) => (
  <a href={href} className="text-[#2563EB] hover:underline" target="_blank" rel="noopener noreferrer">
    {children}
  </a>
),
```

- **リンクは埋め込める。青字＋下線＋別タブで開く。**
- HTML の生タグは（`rehype-raw` 未使用のため）エスケープされる → `<button>` や `<iframe>` を本文に直書きすることはできない
- 「ボタン風」にしたい場合は Markdown リンクのままで、CSS を当てるなら `a` レンダラの改修が必要

**罠**: `a` は無条件で `target="_blank"` なので、ページ内アンカー（`[詳しくはこちら](#attachments)`）を書くと**新規タブで `/announcements/xxx#attachments` が開く**。同一ページ内スクロールにはならない。

### 1-5. 閲覧権限の制御

3層あるが、実質は「ログイン済みなら全員閲覧可」:

1. **middleware**（`src/middleware.ts`）: `/api/` 以外のページで `bs_session` Cookie の**存在のみ**をチェック。無ければ `/login` へリダイレクト。Cookie の中身の検証はしない
2. **API**: `GET /api/announcements`、`/api/announcements/[id]`、`/api/announcements/recent` はいずれも `getSessionUser()` が null なら 401。`getSessionUser` は Cookie の userId で User を引き `status === "active"` を確認する（`src/lib/auth.ts` L28-38）
3. **詳細ページ**: サーバーコンポーネントだが **`getSessionUser()` を呼んでいない**。middleware の Cookie 存在チェックだけを通過して prisma を直接叩く

→ role による出し分けは無い（社員全員が同じお知らせを見る）。書き込みのみ admin 限定。
サイドバー（`src/components/layout/Sidebar.tsx` L178）の「📢 お知らせ」は全員に表示、L187「📢 お知らせ管理」は `adminOnly` 配列。

---

## 2. 既存のファイルアップロード基盤 — 3系統

### 2-1. 一覧比較

| | ① CandidateFile（求職者の添付） | ② TaskAttachment（タスクの添付） | ③ Manual PDF（マニュアル） |
|--|--|--|--|
| **保存先の実体** | **Google Drive**（求職者ID名の子フォルダを自動作成） | **Supabase Storage**（`task-attachments` バケット） | **Google Drive**（`GOOGLE_DRIVE_MANUAL_FOLDER_ID` 直下） |
| アップロードAPI | `POST /api/candidates/[candidateId]/files/upload` | `POST /api/tasks/[taskId]/attachments` | `POST /api/manuals/upload-pdf` |
| 認証方式 | Cookie セッション **または** `Bearer`（AppSession。外部アプリ用） | Cookie セッション + 認可（作成者 / admin / 担当者のみ） | **Cookie セッションのみ**（ログイン済み全員） |
| サイズ上限 | **20MB** | **10MB** | **20MB** |
| 許可形式 | pdf/doc/docx/xls/xlsx/ppt/pptx/jpg/png/gif/webp/txt（MIME + 拡張子の二重チェック） | pdf/jpeg/png/gif/docx/xlsx/csv/txt | **application/pdf のみ** |
| DB保持キー | `driveFileId` / `driveViewUrl` / `driveFolderId` | `storagePath` / `publicUrl` | `driveFileId` / `driveViewUrl` |
| **求職者非依存で使えるか** | **不可**（`candidateId` が URL パスパラメータ・NOT NULL FK） | 不可（`taskId` が必須） | **可能**（親を持たない。返すのは `{driveFileId, driveViewUrl}` だけで、呼び出し側が自由に保存できる設計） |
| ダウンロードURLの発行 | `GET .../files/[fileId]/download` が Drive から取得して**ストリーミング**（署名付きURLではない） | Supabase の**公開URL**をそのまま DB に保存し、`<a href>` で直リンク | `driveViewUrl`（Drive の共有URL）を DB に保存 |
| **PDFインライン表示** | **不可（現状）**。download ルートが `Content-Disposition: attachment` 固定（L28）。ただし `driveViewUrl` は保持しているので Drive 側で開くことは可能 | **可能**。`<a href={publicUrl} target="_blank">` で別タブ→ブラウザ内蔵PDFビューアで表示（`TaskAttachments.tsx` L238） | **可能・実績あり**。`driveViewUrl.replace("/view","/preview")` を `<iframe>` に流し、**ページ内に埋め込み表示**している |

### 2-2. ③ マニュアルの実装詳細（＝流用対象）

**アップロードAPI** `src/app/api/manuals/upload-pdf/route.ts`（全45行）:

```ts
const user = await getSessionUser();          // ログイン必須
if (file.type !== "application/pdf") → 400
if (file.size > 20 * 1024 * 1024) → 400
const fileName = `manual_${Date.now()}.pdf`;   // ← 元ファイル名は捨てられる
const { fileId, webViewLink } = await uploadPdfToDrive(fileName, fileBuffer);
return { driveFileId: fileId, driveViewUrl: webViewLink };
```

- **DBを一切触らない。**アップロードして Drive の ID と URL を返すだけ。呼び出し側が好きなモデルに保存できる
- **元ファイル名が保存されない**（`manual_1754xxxxxxx.pdf` になる）。UI 側で `file.name` を別途保持して表示している

**インライン表示** `src/app/(app)/manuals/[id]/page.tsx` L168-176:

```tsx
{manual.contentType === "PDF" && manual.driveViewUrl && (
  <iframe
    src={manual.driveViewUrl.replace("/view", "/preview")}
    className="w-full border border-[#E5E7EB] rounded-[8px]"
    style={{ height: "calc(100vh - 300px)" }}
    allow="autoplay"
  />
)}
```

同ファイル L286-301 には**「添付資料（PDF）」というセクションが既にある**（contentType が PDF 以外のときに補助的にPDFを出す）。
T-156 で欲しい UI とほぼ同一で、そのまま流用できる。

**アップロードUI** `src/app/(app)/manuals/new/page.tsx` L283-347 / L415-476:
ドラッグ&ドロップ + クリック選択、`accept="application/pdf"`、アップロード中の表示、選択済みファイルのファイル名/サイズ表示と「変更」「削除」ボタン。**そのままコピーして使える完成品。**

**削除の前例** `src/app/api/manuals/[id]/delete/route.ts`: DB削除の前に `deletePdfFromDrive(existing.driveFileId)` を呼ぶ（Drive の孤児を作らない）。T-156 でも踏襲すべき。

### 2-3. Google Drive 共通処理 `src/lib/google-drive.ts`

- 認証: `process.env.GOOGLE_SERVICE_ACCOUNT_KEY`（サービスアカウントJSONを丸ごと1本の文字列）を `JSON.parse` → `GoogleAuth`。scope は `.../auth/drive`
- `uploadFileToDrive(fileName, buffer, folderId?, mimeType?)` — folderId 省略時は `GOOGLE_DRIVE_MANUAL_FOLDER_ID` にフォールバック
- **アップロード直後に必ず `permissions.create({ role: "reader", type: "anyone" })` を実行**（★(5)）
- `downloadFileFromDrive(fileId)` → `{ base64, mimeType }`。portal 経由配信に切り替える場合はこれを使う
- `deletePdfFromDrive(fileId)` — 例外を握り潰す実装

本番 env は3つとも設定済み（実測）: `GOOGLE_SERVICE_ACCOUNT_KEY` ✓ / `GOOGLE_DRIVE_MANUAL_FOLDER_ID` ✓ / `SUPABASE_URL` ✓

### 2-4. 流用可否の結論

**`POST /api/manuals/upload-pdf` + `uploadFileToDrive` がそのまま流用できる。**

理由: (a) 求職者・タスクなど親エンティティに依存しない唯一の系統、(b) PDF専用・20MB でお知らせ資料の要件に合致、
(c) DBを触らないので呼び出し側のモデルを選ばない、(d) インライン表示の実績がある。

ただし「マニュアル用フォルダにお知らせの資料が混ざる」ことになるため、Phase 1 では
`GOOGLE_DRIVE_ANNOUNCEMENT_FOLDER_ID` を新設して `uploadFileToDrive(name, buf, process.env.GOOGLE_DRIVE_ANNOUNCEMENT_FOLDER_ID)` を呼ぶ
専用ルート（`/api/admin/announcements/upload-pdf`、admin 限定）を作るのが望ましい。
env 追加を避けたい場合はマニュアルフォルダ共用でも動作上の問題はない。

---

## 3. 「資料一覧」「マニュアル」との関係

サイドバー該当項目（`src/components/layout/Sidebar.tsx`）:

| メニュー | href | 表示対象 |
|--|--|--|
| 📢 お知らせ | `/announcements` | 全員 |
| 📄 資料一覧 | `/documents` | 全員 |
| 📖 マニュアル | `/manuals` | 全員 |
| 📢 お知らせ管理 | `/admin/announcements` | admin のみ |
| 📄 資料管理 | `/admin/documents` | admin のみ |

（マニュアルには admin 専用の管理メニューが無い＝一般ページから誰でも作成する設計）

### 3-1. 資料一覧（`/documents`）— **不成立**

- `Document` モデル: `title` / `description` / `category`（自由入力文字列）/ `url`（必須）/ `status` / `authorUserId`
- 詳細ページは `<iframe src={document.url}>` で外部ページを丸ごと表示 + 「🔗URLをコピー」「📥PDF出力」（＝iframe の `contentWindow.print()`）
- **アップロード機能なし。**管理画面は URL 手入力のみ
- 本番データ 1件（`「面接の本質」対策ガイド` / カテゴリ `面接対策` / `https://bizstudio-interview.manus.space`）＝**求職者向けの外部教材**という位置づけ

→ お知らせの添付PDFの置き場所としては**成立しない**（★(2)）。

### 3-2. マニュアル（`/manuals`）— **成立する。案Bの唯一の受け皿**

- 本番12件、うち contentType=PDF が7件、Drive 連携7件（`pdfData` の data URI 運用は0件＝完全に Drive 方式へ移行済み）
- 実例: 「マイナビスカウト集計」「マイナビメッセージ対応」「doda Mapsリストチェック」＝**CA向けの操作手順書がすでに主コンテンツ**
- カテゴリは `INTERNAL` / `CANDIDATE` / `CLIENT` の3値 + サブカテゴリ

**成立するが、以下の副作用がある:**

1. マニュアル一覧が「リリース周知の付録PDF」で膨らむ。恒久的な手順書と、特定リリース回の説明資料が同じ棚に混ざる
2. リリース資料を置く適切なカテゴリが無い（`INTERNAL` に押し込むことになる）
3. **作成がログイン済み全員に開放されている**ため、管理主体が admin に閉じない（★(4)）
4. お知らせ⇔資料の対応関係がDB上に残らない（本文中のURL文字列だけが紐付け）。お知らせを消しても資料が残り、資料を消してもお知らせのリンクは切れたまま
5. 運用が2画面3ステップ（マニュアル作成 → 詳細URLをコピー → お知らせ本文に貼る）。毎回のリリースで発生する

→ **暫定運用（Phase 0）としては最適だが、恒久運用としては案Aに劣る。**

---

## 4. 実装方式の比較

### 案A: `AnnouncementAttachment` テーブルを新設 + 既存アップロード基盤を流用（**推奨**）

```prisma
model AnnouncementAttachment {
  id             String       @id @default(cuid())
  announcementId String       @map("announcement_id")
  announcement   Announcement @relation(fields: [announcementId], references: [id], onDelete: Cascade)
  fileName       String       @map("file_name")      // 表示用の元ファイル名
  fileSize       Int          @map("file_size")
  driveFileId    String       @map("drive_file_id")
  driveViewUrl   String       @map("drive_view_url")
  sortOrder      Int          @default(0) @map("sort_order")
  createdAt      DateTime     @default(now()) @map("created_at")

  @@index([announcementId])
  @@map("announcement_attachments")
}
```

- `Announcement` 側は `attachments AnnouncementAttachment[]` のリレーション1行を足すだけ（**既存カラムの変更なし**）
- アップロードは `/api/admin/announcements/upload-pdf`（`uploadFileToDrive` を呼ぶ・admin 限定）
- `TaskAttachment` と同じ「1:N + Drive/Storage の ID を保持」という既存の設計パターンに完全に沿う

### 案B: マニュアルにPDFを置き、お知らせ本文からURLでリンク（実装ゼロ）

3章の通り成立するが、副作用5点。

### 案C: `Announcement` に nullable カラム2本（`attachmentUrl` / `attachmentTitle`）だけ追加

新テーブル不要で最小。ただし**「1件のお知らせにつき1〜数件」という要件を満たせない**（1件しか持てない）。
将来 JSON 配列に変えるなどの手戻りが発生する。

### 比較表

| 軸 | 案A（専用テーブル） | 案B（マニュアル + 本文リンク） | 案C（カラム2本） |
|--|--|--|--|
| **実装量** | 中（migration 1本 / API 2本 / 詳細ページ +30行 / 管理モーダル +60行）。アップロード処理とUIは既存のコピーで済む | **ゼロ** | 小（migration 1本 / API は既存 update に2フィールド追加 / UI 小） |
| **運用の手間**（毎リリース） | **1画面完結**。お知らせ作成モーダルでPDFをD&D → 公開。**1ステップ** | 3ステップ・2画面（マニュアル作成 → URLコピー → 本文に貼付） | 1画面完結だが1件のみ |
| **見た目の自然さ** | ◎ 本文下に「📎 添付資料」＋インライン表示。マニュアル詳細と統一 | △ 本文中に外部リンク。押すとマニュアル画面へ飛び、文脈が切れる | ○ 案Aと同等（1件時） |
| **権限管理** | ◎ admin 限定を維持（お知らせと同一の認可） | ✕ 資料の作成・編集がログイン済み全員に開放される | ◎ 案Aと同等 |
| **将来の拡張性** | ◎ 複数件・並び順・PDF以外（画像/動画URL）へ自然に拡張可能 | △ 本文の文字列頼み。DB上に関連が残らない | ✕ 複数件対応で手戻り |
| **お知らせ削除時の整合** | ◎ `onDelete: Cascade` + Drive削除で完結 | ✕ 資料が孤児化。リンク切れも検出できない | ○ |

### 推奨: **案A（本命）+ 案B（Phase 0 の暫定運用）**

理由:

1. **運用が毎回発生する要件**（「今後のリリース周知では毎回この形式を使う」）なので、1画面完結の価値が繰り返し効く。案Bの2画面3ステップは毎回のコストになる
2. 要件が「1〜数件」である以上、1:N テーブルは避けられない。案Cは要件を満たさない
3. 案Aの実装コストは見た目より小さい。**アップロードAPI・D&D UI・インライン表示 iframe・Drive削除処理はすべてマニュアル機能に完成品が存在し、コピーで済む**。新規に書くのは migration 1本と結線だけ
4. 権限が指示書の前提（admin のみアップロード）と一致するのは案Aのみ
5. ただし案Aの完成を待つ必要はない。**案Bは今日から使える**ので、直近のリリース周知には案Bを充て、並行して案Aを実装するのが最短

---

## 5. UI の設計案

### 5-1. お知らせ詳細ページ `/announcements/[id]` — 導線の本体

本文 Markdown の直後（現行 L109 の `</div>` の後）に挿入:

```
────────────────────────────  ← <hr className="my-6 border-[#E5E7EB]" />
📎 添付資料
┌────────────────────────────────────────┐
│  操作ガイド_面談前フォーム.pdf   1.2 MB   [別タブで開く ↗] │
├────────────────────────────────────────┤
│                                        │
│   （Drive /preview の iframe・高さ 600px） │
│                                        │
└────────────────────────────────────────┘
```

- 見出し `<h2 className="text-[16px] font-semibold text-[#374151] mb-3">📎 添付資料</h2>` — マニュアル詳細 L291 と同一
- **添付が無いお知らせでは何も出さない**: `{attachments.length > 0 && (...)}` で囲む。マニュアル詳細 L287 の `manual.contentType !== "PDF" && manual.driveViewUrl` と同じ条件パターン
- 複数件のときは iframe を縦に並べる（2件以上ならファイル名リストのみ表示し、1件目だけ埋め込む案も可。まずは全件埋め込みで十分）
- **サーバーコンポーネントのままで実装できる**（prisma に `include: { attachments: { orderBy: { sortOrder: "asc" } } }` を足すだけ）

### 5-2. お知らせ一覧 `/announcements` — バッジのみ

カード内、本文 truncate の直下・「続きを読む →」の左に:

```tsx
{a.attachmentCount > 0 && (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] text-[12px]">
    📎 資料 {a.attachmentCount}件
  </span>
)}
```

- 0件なら非表示
- `GET /api/announcements` に `include: { _count: { select: { attachments: true } } }` を足す（現在は `include: { author }` のみ）
- **一覧に「詳しくはこちら」ボタンは置かない。**既存の「続きを読む →」と役割が重複し、押し分けの迷いを生む

### 5-3. 「詳しくはこちら」の実現方法

添付セクションが本文の直下に自動で出るため、**本文に導線を書く必要はない**。
それでも本文中に一言添えたい場合は、Markdown で `本文末尾に「👇 詳しい操作手順は下の添付資料をご覧ください」` のような**プレーンテキスト**を書く。

**アンカーリンク（`[詳しくはこちら](#attachments)`）は使わないこと。** 1-4 の通り `a` レンダラが `target="_blank"` を強制するため、
同一ページが新規タブで開いてしまう（罠）。

### 5-4. 管理画面のファイル選択欄

作成/編集モーダル（`src/app/(app)/admin/announcements/page.tsx` L233-280）の
**本文 textarea の直下、フッタの上**に「添付資料（PDF・任意）」セクションを追加。

- UI は `src/app/(app)/manuals/new/page.tsx` L415-476 のD&Dブロックをほぼそのまま移植（`accept="application/pdf"`・最大20MB・アップロード中表示・選択済みファイルのファイル名/サイズ + 削除ボタン）
- モーダルは `max-w-[600px] max-h-[90vh] overflow-y-auto` なので、縦に足しても破綻しない
- **アップロードのタイミング**: マニュアルと同じく「ファイル選択の即時に Drive へアップロードし、`{driveFileId, driveViewUrl}` を state に保持 → 保存ボタンで create/update に同梱」方式を踏襲する。
  - 副作用: 途中でキャンセルすると Drive に孤児ファイルが残る。マニュアルも同じ挙動で運用上許容されている
- 編集モーダルを開いたときは既存添付を一覧表示し、個別に削除できるようにする
- **「✨AIで整理する」との干渉なし**（`ai-format` は `content` しか触らない）

### 5-5. PDFを開いたときの挙動 — 推奨は「詳細ページ内インライン + 別タブリンク併設」

| 選択肢 | 評価 |
|--|--|
| **A. 詳細ページ内に iframe で埋め込み（推奨）** | マニュアル詳細と完全に同じ見た目・同じ操作感になり、CAの学習コストがゼロ。ページ遷移も不要。Drive のビューアなのでズーム・ページ送り・印刷・DLが全部使える |
| **B. 別タブで開く** | 確実に動く。ただし「押したらPDFが表示される」体験としては1クッション増える。**Aの保険として併設する**（後述の罠2の回避策） |
| C. モーダルで表示 | 非推奨。Drive iframe はモーダル内で縦が潰れて読みづらい。portal 内に PDF モーダルの前例が無く、新規実装になる |
| D. ダウンロードのみ | 非推奨。要件（押したら表示される）を満たさない |

**推奨 = A + B の併用。**iframe の右上（ファイル名の行）に「別タブで開く ↗」を置き、iframe が表示されない環境でも到達できるようにする。

---

## 6. 既存データへの影響

実測（本番DB・SELECT のみ）:

| 項目 | 件数 |
|--|--|
| **お知らせ 全件** | **38** |
| うち PUBLISHED | 38 |
| うち DRAFT | **0** |
| 本文の平均文字数 | 449 |
| 本文の最大文字数 | 1,740 |
| **本文にURLを含むもの** | **0件**（リンクを使った実績がまだ無い） |
| マニュアル 全件 | 12 |
| うち contentType=PDF | 7 |
| うち driveFileId あり | 7 |
| うち pdfData（data URI）あり | 0 |
| 資料（Document）全件 | 1（すべて PUBLISHED） |
| TaskAttachment 全件 | 923 |

**影響評価:**

- **案A（新テーブル）を採る場合、既存38件のレコードは一切変更されない。** `Announcement` 側に増えるのは Prisma のリレーション行のみで、SQL 上のカラム変更はゼロ。マイグレーションは `CREATE TABLE` + `CREATE INDEX` + FK のみ
- 詳細ページ・一覧APIの読み取りも、添付0件なら空配列/`_count: 0` が返るだけで表示は現状と同一
- 案C（カラム追加）を採る場合も **nullable で問題ない**。既存38件は NULL となり、5-1 の `attachmentUrl && (...)` 条件で導線が出ない
- 本文にリンクを含むお知らせが現在0件のため、**案B に切り替えても既存表示のデグレは起きない**（`a` レンダラは実質未使用の状態）
- 直近のお知らせは最大1,644文字（Google フォーム自動生成の告知）と長文化の傾向があり、「本文=要点 / 詳細=添付PDF」という方針転換の動機とも一致する

---

## 7. リスク・罠

### 7-1. 実装前に知っておくべき事実

1. **Drive アップロードは無条件で `anyone` に reader 権限を付ける**（★(5)、`google-drive.ts` L50-57）。
   URL が漏れれば portal 未ログインの第三者が閲覧できる。社内向け操作ガイドであれば実害は小さいが、
   「社員のみ閲覧」を厳密に保証したいなら Phase 3（portal 経由ストリーミング）が必要
2. **`/api/manuals/upload-pdf` は元ファイル名を捨てる**（`manual_${Date.now()}.pdf` に置換）。
   お知らせ用ルートを作るときは、`fileName` を DB 側に別途保存する設計にすること（案Aのスキーマは対応済み）
3. **お知らせ詳細ページはサーバーコンポーネントで `getSessionUser()` を呼んでいない。** middleware の Cookie 存在チェックのみで通過する。
   添付機能を足しても認可は現状据え置きになる（新たなデグレではないが、機密資料を置くなら詳細ページにも `getSessionUser()` を足すべき）
4. **`/api/manuals/create` と `/api/manuals/upload-pdf` は admin 限定ではない。**案Bを恒久運用にする場合、この点の可否を先に判断すること
5. アップロードは「即時 Drive 送信 → 保存時にDB」方式のため、**保存せずモーダルを閉じると Drive に孤児が残る**。マニュアルも同じ挙動
6. `Announcement` 削除時に Drive ファイルを消す処理は当然まだ無い。案Aでは `onDelete: Cascade` でDB行は消えるが、
   **Drive のファイルは残る**。`/api/manuals/[id]/delete` の `deletePdfFromDrive` 呼び出しを踏襲すること

### 7-2. 既存機能へのデグレ懸念

| 触る箇所 | 懸念 | 対策 |
|--|--|--|
| `GET /api/announcements` | `_count` 追加でレスポンス形が変わる。ダッシュボードの `/recent` も同じ `Announcement` を読む | `_count` は加算のみで既存フィールドは不変。`/recent` は別ルートなので無改修で動く |
| 一覧ページの型定義 | `attachmentCount` を optional にしないと型エラー | `attachmentCount?: number` とし、`(a.attachmentCount ?? 0) > 0` で判定 |
| 詳細ページ | サーバーコンポーネントで `include` を増やすだけ。既存レンダリングには非干渉 | — |
| 管理モーダル | `formData` に添付 state を足す。既存の title/content/category は不変 | 「AIで整理する」は content のみ操作するので干渉なし |
| Drive API のクォータ | マニュアル用フォルダを共用すると、1フォルダ内のファイル数が増える | 実用上問題になる規模ではない（現在7件）。専用フォルダを切るのが望ましい |

### 7-3. Google Drive の認証・権限まわり

- **`.env` の複数行 PRIVATE_KEY 問題（既知）**: `GOOGLE_SERVICE_ACCOUNT_KEY` はサービスアカウントJSONを**丸ごと1本の文字列**として保持し、`JSON.parse` する設計（`google-drive.ts` L5-10）。JSON内部の `private_key` は `\n` エスケープ済みの文字列であるべきで、実際の改行が混入すると `JSON.parse` が落ちる。
  - **本番は設定済みで正常動作中**（実測: `GOOGLE_SERVICE_ACCOUNT_KEY` あり / `GOOGLE_DRIVE_MANUAL_FOLDER_ID` あり）。**T-156 で env をいじる必要はない**（マニュアルフォルダ共用の場合）
  - 専用フォルダを切る場合のみ `GOOGLE_DRIVE_ANNOUNCEMENT_FOLDER_ID` を Railway に追加する。この変数は単純なフォルダIDなので改行問題は無関係
  - ローカル開発では `.env` を master worktree のみが持つ（既知）。sagyou-2 / staging worktree では Drive アップロードのローカル検証ができない
- **サービスアカウントとフォルダの共有設定**: 新しいフォルダを切る場合、そのフォルダをサービスアカウントのメールアドレスに編集者として共有しないと `files.create` が 404 を返す。既存のマニュアルフォルダは設定済み
- **`supportsAllDrives: true` が全呼び出しに付いている** — 共有ドライブ上のフォルダでも動作する
- **`/preview` iframe の表示ブロック**: Drive のプレビューは、閲覧者のブラウザが別組織の Google アカウントにログインしている場合などに稀に表示を拒否することがある。`anyone` reader が付いているので原理的には見えるはずだが、**「別タブで開く」リンクを必ず併設して回避策を用意する**（5-5 の推奨B）

---

## 8. 実装フェーズの分割案

| Phase | 内容 | 変更ファイル | 想定作業量 | 依存 |
|--|--|--|--|--|
| **Phase 0**（実装ゼロ・即日） | 次のリリース周知を「マニュアルにPDF登録 → お知らせ本文に `[詳しくはこちら](URL)` を貼る」で運用開始。案Aの完成を待たない | なし（運用のみ） | **0**（PDF作成時間のみ） | なし |
| **Phase 1**（本命・最小構成） | `AnnouncementAttachment` テーブル追加 / `POST /api/admin/announcements/upload-pdf`（admin限定）/ create・update API の添付受け取り / 詳細ページに「📎 添付資料」セクション（iframe + 別タブリンク）/ 管理モーダルにD&D欄 | migration 1本、`schema.prisma`、新規APIルート1、`admin/announcements/create`・`[id]/update`、`announcements/[id]/page.tsx`、`admin/announcements/page.tsx` | **0.5〜1日** | Phase 0 と並行可 |
| **Phase 2**（磨き込み・任意） | 一覧カードの 📎 件数バッジ（`_count` 追加）/ 複数添付の並び替え・個別削除 / お知らせ削除時に `deletePdfFromDrive` を呼ぶ / 専用 Drive フォルダ（`GOOGLE_DRIVE_ANNOUNCEMENT_FOLDER_ID`）へ分離 | `api/announcements/route.ts`、`announcements/page.tsx`、`admin/announcements/[id]/delete`、Railway env 1本 | **0.5日** | Phase 1 |
| **Phase 3**（セキュリティ・任意） | Drive の `anyone` reader をやめ、`GET /api/announcements/[id]/attachments/[attachmentId]` で `downloadFileFromDrive` → `Content-Disposition: inline` のストリーミング配信に切替。iframe の src をそのAPIに向ける | `google-drive.ts`（権限付与の分岐追加）、新規配信ルート1、詳細ページ | **0.5日** | Phase 1。社外秘資料を扱う判断が出た場合のみ |

**デプロイ判断**（`07-deploy-rules.md` 準拠）:
- Phase 1 は「純粋追加機能 + 新規テーブル」で既存ロジックの変更を含まないが、**DBマイグレーションを伴うため staging 経由を推奨**
- Phase 2 の一覧API改修（`_count` 追加）は既存レスポンスの変更にあたるため staging 必須
- Phase 3 は `google-drive.ts` という共有ライブラリの既存ロジック変更（求職者ファイル・マニュアルにも影響）のため **staging 必須**

---

## 9. 使用した読み取り専用スクリプト

いずれも `railway ssh --service bizstudio-portal` 経由のワンライナー（master worktree から実行）。
**SELECT / count のみ。書き込みは一切行っていない。**

Prisma 7 系のため、`PrismaClient` は `PrismaPg` アダプタ必須（アダプタ無しだと `new PrismaClient()` が例外を投げる）。
また Git Bash 経由では `$disconnect` の `$` がシェルに食われるため、`process.exit(0)` で終了させている。

### スクリプト1 — 件数集計

```bash
MSYS_NO_PATHCONV=1 railway ssh --service bizstudio-portal "node -e \"\
const{PrismaClient}=require('@prisma/client');\
const{PrismaPg}=require('@prisma/adapter-pg');\
const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});\
(async()=>{const o={};\
o.ann_total=await p.announcement.count();\
o.ann_published=await p.announcement.count({where:{status:'PUBLISHED'}});\
o.ann_draft=await p.announcement.count({where:{status:'DRAFT'}});\
o.manual_total=await p.manual.count();\
o.manual_pdf=await p.manual.count({where:{contentType:'PDF'}});\
o.manual_drive=await p.manual.count({where:{driveFileId:{not:null}}});\
o.manual_pdfdata=await p.manual.count({where:{pdfData:{not:null}}});\
o.doc_total=await p.document.count();\
o.doc_published=await p.document.count({where:{status:'PUBLISHED'}});\
o.taskatt_total=await p.taskAttachment.count();\
console.log('RESULT'+JSON.stringify(o));process.exit(0);})()\""
```

結果: `{"ann_total":38,"ann_published":38,"ann_draft":0,"manual_total":12,"manual_pdf":7,"manual_drive":7,"manual_pdfdata":0,"doc_total":1,"doc_published":1,"taskatt_total":923}`

### スクリプト2 — 本文の長さ・リンク有無・資料の実データ・env の存在確認

```bash
MSYS_NO_PATHCONV=1 railway ssh --service bizstudio-portal "node -e \"\
const{PrismaClient}=require('@prisma/client');\
const{PrismaPg}=require('@prisma/adapter-pg');\
const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});\
(async()=>{const o={};\
const a=await p.announcement.findMany({select:{title:true,content:true,category:true,publishedAt:true},orderBy:{publishedAt:'desc'},take:5});\
o.recent=a.map(x=>({t:x.title,cat:x.category,len:x.content.length,hasLink:/\]\(|https?:/.test(x.content),head:x.content.slice(0,80)}));\
const all=await p.announcement.findMany({select:{content:true}});\
o.len_max=Math.max(...all.map(x=>x.content.length));\
o.len_avg=Math.round(all.reduce((s,x)=>s+x.content.length,0)/all.length);\
o.with_link=all.filter(x=>/https?:\/\//.test(x.content)).length;\
o.docs=await p.document.findMany({select:{title:true,category:true,url:true}});\
o.manual_sample=await p.manual.findMany({where:{driveFileId:{not:null}},select:{title:true,contentType:true,driveViewUrl:true},take:3});\
o.driveFolderEnv=!!process.env.GOOGLE_DRIVE_MANUAL_FOLDER_ID;\
o.gsaEnv=!!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;\
o.supabaseEnv=!!process.env.SUPABASE_URL;\
console.log('RESULT'+JSON.stringify(o,null,1));process.exit(0);})()\""
```

結果（抜粋）: `len_max: 1740` / `len_avg: 449` / `with_link: 0` / `docs: [{title:"「面接の本質」対策ガイド", category:"面接対策", url:"https://bizstudio-interview.manus.space"}]` /
`driveFolderEnv: true` / `gsaEnv: true` / `supabaseEnv: true`

### 参照した主なファイル（読み取りのみ）

- `prisma/schema.prisma` — `Announcement` L692-705 / `Manual` L720-740 / `Document` L648-661 / `TaskAttachment` L891-907 / `CandidateFile` L1415-
- `src/app/(app)/announcements/page.tsx` / `[id]/page.tsx`
- `src/app/(app)/admin/announcements/page.tsx`
- `src/app/api/announcements/route.ts` / `[id]/route.ts` / `recent/route.ts`
- `src/app/api/admin/announcements/create/route.ts` / `[id]/update/route.ts` / `[id]/delete/route.ts`
- `src/app/(app)/manuals/page.tsx` / `[id]/page.tsx` / `new/page.tsx`
- `src/app/api/manuals/upload-pdf/route.ts` / `create/route.ts` / `[id]/delete/route.ts`
- `src/app/(app)/documents/page.tsx` / `[id]/page.tsx` / `[id]/DocumentPdfButton.tsx`、`src/app/(app)/admin/documents/page.tsx`
- `src/app/api/tasks/[taskId]/attachments/route.ts` / `[attachmentId]/route.ts`、`src/components/tasks/TaskAttachments.tsx`
- `src/app/api/candidates/[candidateId]/files/upload/route.ts` / `[fileId]/download/route.ts`
- `src/lib/google-drive.ts` / `src/lib/supabase.ts` / `src/lib/auth.ts` / `src/middleware.ts` / `src/components/layout/Sidebar.tsx`
