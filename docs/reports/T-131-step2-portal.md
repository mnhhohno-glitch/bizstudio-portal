# T-131 step2（portal側）: 手動アップPDFの自動フルデータ化 — 実装完了レポート

**日付**: 2026-07-04 ／ **対象**: bizstudio-portal（master）
**前提API**: job-platform `POST /api/internal/ingest-pdf`（step1・docs/reports/T-131-step1-jobplatform.md が正）

CAが手動アップした求人票PDF（`sourceType=NULL` のブックマーク）を、テキスト抽出成功直後に
job-platform へ**非同期投入**し、非公開求人としてフルデータ化する。CAの操作は1つも増やさない。

---

## 1. スキーマ（Phase 1）

- `CandidateFile.platformSubmittedAt`（`DateTime?` / nullable）を追加。紐付けは既存 `externalJobRef`（未使用0件）を流用し job-platform の `sourceJobId` を格納。
- マイグレーション `prisma/migrations/20260704120000_t131_platform_submitted_at/`（`SET lock_timeout='5s'` → `ALTER TABLE candidate_files ADD COLUMN platform_submitted_at TIMESTAMP(3)`）。**本番DBへ適用済み**（`prisma migrate deploy`）。非破壊（ADD COLUMNのみ）。

---

## 2. アップ時の自動投入（Phase 2・fire-and-forget）

**挿入点**: `src/app/api/candidates/[candidateId]/bookmarks/extract-text/route.ts`
テキスト抽出成功で `extractedText` を保存した直後（バッチ内の各ファイル処理の末尾）。

```ts
// extractedText 保存 → extracted++ の直後
if (file.sourceType === null && !file.externalJobRef) {
  void ingestAndLink({ fileId: file.id, fileName: file.fileName, pdfBuffer }).catch((e) => {
    console.error(`[t131-ingest] 予期せぬエラー fileId=${file.id}:`, e);
  });
}
```

- **await しない**＝アップ動線のレスポンスを一切遅らせない（Railway常駐サーバなのでレスポンス後も浮いたPromiseは完走する）。
- 対象は PDF由来（`sourceType=NULL`）かつ未紐付け（`externalJobRef` 未設定）のみ。
- 失敗しても `[t131-ingest]` ログのみで既存フロー（kyuujinPDF出力・AI評価）は不変。

**投入クライアント**: `src/lib/job-platform-ingest.ts`
- `submitPdfToJobPlatform()`: multipart（`file`/`media`/`ref`）で `POST {JOB_PLATFORM_INGEST_URL}/api/internal/ingest-pdf`。
  - ヘッダ `X-Internal-Key: env INTERNAL_INGEST_API_KEY`（未設定は fail-closed）。
  - **タイムアウト120秒**（AbortController。処理実測41秒/件のため既定fetchでは切れる）。
  - `JOB_PLATFORM_INGEST_URL` 既定 `https://bizstudio-job-platform.vercel.app`。
- `ingestAndLink()`: 投入 → 成功で `externalJobRef=sourceJobId` ＋ `platformSubmittedAt=now`、失敗で `platformSubmittedAt=now` のみ（試行時刻を刻む）。

### 媒体判定ロジック（ファイル名ヒューリスティック）

```ts
detectMediaFromFilename(fileName) = /No\d{5,7}/i.test(fileName) ? "circus" : "own"
```
- circus の求人票PDFはファイル名に「No」+ 5〜7桁の求人番号を持つ（例: `株式会社エスプール_No319877.pdf`）。判定不能は `own`。
- **想定される誤判定**: (a) circus以外でファイル名に `No123456` 相当があれば circus と誤判定。(b) circus PDFでもファイル名が改変され No番号を失えば `own` に落ちる。いずれも job-platform 側は `media` を「登録媒体の記録」に使うだけで抽出内容・非公開性には影響しないため、実害は媒体ラベルの取り違えに限定。

### 二重投入対策（二重防御）

1. portal: `externalJobRef` 設定済みはスキップ（自動投入・拾い直しとも）。
2. job-platform: 同一媒体×同一PDF内容ハッシュ(sha256)は Gemini を呼ばず既存 `sourceJobId` を `status:"duplicate"` で返す。
→ 万一の再送でも二重登録にならない。

---

## 3. 滞留の拾い直し（Phase 3）

`scripts/t131-resubmit-stale.ts`（本番コンテナ上で `railway ssh` 実行）。

- **対象**: PDF由来（sourceType=NULL・BOOKMARK・archivedAt=NULL）＋抽出済（extractedText）＋Drive実体あり（driveFileId）＋未紐付け（externalJobRef=NULL）＋「作成 or 直近試行(platformSubmittedAt) から2時間以上経過」＋ `createdAt >= CUTOFF`。
- **CUTOFF**: 既定 `2026-07-04T00:00:00+09:00`（env `T131_STALE_CUTOFF` で上書き可）。**遡及4,204件は対象外**（本日以降のみ。遡及はstep4で別設計）。
- **動作**: 既定 DRY-RUN（一覧＋件数のみ・DB/HTTP非接触）。`--execute` で Drive からPDF取得→再投入（**1回上限50件**・各件ログ）。
- **定期実行**: portal に既存の定期実行機構は無く（`.claude/scheduled_tasks.lock` はローカル用途）、**手動/railway ssh 実行スクリプト**として完成。日次自動化はstep4で別途判断。

```
railway ssh → npx tsx scripts/t131-resubmit-stale.ts             # DRY-RUN
              npx tsx scripts/t131-resubmit-stale.ts --execute   # 本実行（上限50件）
```

---

## 4. 動作確認（テスト候補者 5999999 = 大野テストで実測）

| # | 確認 | 結果 |
|---|---|---|
| 1 | アップ動線のレスポンスを遅らせない | **担保**: `void ingestAndLink(...)`（await しない fire-and-forget）。既存の抽出保存フローに追加のawaitは無い（コード確認） |
| 2 | 約1分後に externalJobRef / platformSubmittedAt が入る | **OK**: `ingestAndLink` で `externalJobRef=circus-8vjt1r`・`platformSubmittedAt` 書き戻しを実測 |
| 3 | job-platform側で private 登録・公開検索件数±0 | **OK**: 登録 `circus-8vjt1r [visibility=private/active]`。公開検索74430＝jobs全件74431−private1。キーワード"BPO"公開検索に private 非出現 |
| 4 | 失敗系→未紐付け→拾い直しで救済 | **OK**: X-Internal-Key誤値→**HTTP 401**・`externalJobRef=null`・`platformSubmittedAt`刻む。拾い直し DRY-RUN が滞留1件を検知・一覧化（後退させた作成日時のテスト行で実証） |
| 5 | 既存動作の非退行（kyuujinPDF出力・AI評価） | **担保**: 変更は extract-text の抽出保存直後に fire-and-forget を1ブロック追加したのみ。`analyze-batch`（AI評価）・`send-to-job-tool`（kyuujinPDF出力）は未変更（コード確認） |
| 6 | テスト登録分の扱い | job-platform テスト求人 `circus-8vjt1r` は**削除済み**（job_id 4beb2854-…）。portal のテスト CandidateFile は全て**削除済み** |

### 媒体判定の実測
`株式会社エスプール_No319877.pdf → circus` / `求人票_ABC商事_20260413.pdf → own` / `No12345.pdf → circus`（全て期待どおり）。

---

## 5. job-platform 側の追随修正（step1 API の Vercel 実行不能を解消）

step1 の投入APIは**プロセス内（tsx）テストのみ**で、Vercel serverless 上では未検証だった。step2 で実送したところ **HTTP 500** が判明し、job-platform 側を3点修正した（別リポジトリ・push・Vercel Ready 済み）:

| 症状 | 原因 | 修正（job-platform コミット） |
|---|---|---|
| 500（Cannot find module pdf.worker.mjs） | Nextが pdf-parse をバンドルしワーカーパスを書換 | `serverExternalPackages:["pdf-parse"]`（`ca9f702`） |
| 500（同・トレース欠落） | nftがワーカーを取りこぼす | `outputFileTracingIncludes` でワーカー同梱（`6abafc4`） |
| **500（ReferenceError: DOMMatrix is not defined）** | Vercelでワーカー起動不可→fake worker(メインスレッド)が未定義の DOMMatrix 参照 | `DOMMatrix/Path2D/ImageData` を Node にポリフィル（`23d9dab`） |

→ 修正後、Vercel本番の `POST /api/internal/ingest-pdf` は **200（circus登録・約41秒 / dedup時 <1秒）**、誤キーは **401** を実測。step2 の全確認はこの修正済みエンドポイントに対して実施。

---

## 6. 変更ファイル

| ファイル | 種別 |
|---|---|
| `prisma/schema.prisma` | 変更（platformSubmittedAt 追加） |
| `prisma/migrations/20260704120000_t131_platform_submitted_at/migration.sql` | 新規 |
| `src/lib/job-platform-ingest.ts` | 新規（投入クライアント） |
| `src/app/api/candidates/[candidateId]/bookmarks/extract-text/route.ts` | 変更（fire-and-forget 追加） |
| `scripts/t131-resubmit-stale.ts` | 新規（滞留拾い直し） |

---

## 7. 環境変数（本番 Railway portal）

- `INTERNAL_INGEST_API_KEY`（job-platform Vercel と同一値）: 自動投入・拾い直しの認証に必須。**未設定だと fail-closed で投入されず滞留に積まれ、拾い直しで再試行される**（無言消失はしない）。
- `JOB_PLATFORM_INGEST_URL`（任意・既定 `https://bizstudio-job-platform.vercel.app`）。

---

## 8. Git / デプロイ

- コミット（portal / master）:
  - DB（独立）: **`c421b6e`**（`platform_submitted_at` 列追加）
  - 機能＋レポート: **`6cc0bf1`**
- push前に `python scripts/wait_railway_idle.py`（本番idle・exit 0）を実施。
- Railway 本番デプロイ完了: `bizstudio-portal-production.up.railway.app` が **HTTP 200（/login）/307（/）** で稼働、`origin/master` HEAD＝`6cc0bf1`。
  ビルドの `prisma migrate deploy` は当該マイグレーション適用済みのため no-op。
- 関連（job-platform / Vercel・step1 API の serverless 実行修正）: `ca9f702` / `6abafc4` / `23d9dab` を push・Vercel Ready・本番200実測（§5）。
