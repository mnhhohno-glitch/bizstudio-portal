# Phase 3 実施レポート

実施日: 2026-04-19
ブランチ: staging
前段調査: docs/migration/existing-interview-tables-investigation.md (3e0ce38)

## 1. 実施内容サマリー

既存の InterviewRecord / InterviewDetail / InterviewRating を活かし、不足分のみ追加：

- InterviewRecord に新規フィールド7つ追加（状態管理、AI解析メタ、自動保存メタ）
- InterviewMemo テーブル新規作成（面談内の複数メモ）
- InterviewAttachment テーブル新規作成（添付ファイル + AI解析結果）
- CandidateMemo テーブル新規作成（求職者総合メモ）

CandidateProfile は**作成しない**：
- InterviewDetail が既に96フィールドで希望条件・スキル等をカバー
- 最新面談の InterviewDetail を「現在の希望条件」として使う方針
- 面談履歴も同時に取得できる（スナップショット設計）

## 2. 追加されたフィールド・テーブル

### InterviewRecord への追加フィールド（7つ）

| フィールド | 型 | デフォルト | 用途 |
|---|---|---|---|
| status | String | "draft" | draft/complete/archived |
| isLatest | Boolean | true | 最新面談フラグ |
| aiAnalysisResult | Json? | null | AI解析結果キャッシュ |
| aiAnalysisAt | DateTime? | null | AI解析最終実行日時 |
| lastSavedAt | DateTime? | null | 自動保存タイムスタンプ |
| lastEditedBy | String? | null | 最終編集者ID |
| autosaveToken | String? | null | 自動保存競合検出トークン |

追加インデックス: `@@index([isLatest])`

### InterviewMemo（新規テーブル）

| フィールド | 型 | 用途 |
|---|---|---|
| id | String (cuid) | PK |
| interviewRecordId | String | FK → InterviewRecord |
| title | String | メモタイトル |
| flag | String | 初回面談/既存面談/面接対策/内定面談/その他 |
| date | DateTime | メモ日付 |
| time | String? | 時刻 |
| content | Text | メモ内容 |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

### InterviewAttachment（新規テーブル）

| フィールド | 型 | 用途 |
|---|---|---|
| id | String (cuid) | PK |
| interviewRecordId | String | FK → InterviewRecord |
| fileName | String | ファイル名 |
| fileType | String | Nottaログ/録音/マイナビPDF/履歴書/職務経歴書/共有資料/その他 |
| filePath | String | Supabase Storage パス |
| fileSize | Int | ファイルサイズ |
| mimeType | String? | MIMEタイプ |
| analysisStatus | String | pending/analyzing/done/error |
| analysisResult | Json? | AI解析結果 |
| analysisError | String? | エラーメッセージ |
| analyzedAt | DateTime? | 解析実行日時 |
| memo | String? | メモ |
| uploadedAt | DateTime | アップロード日時 |
| uploadedBy | String? | アップロード者ID |

### CandidateMemo（新規テーブル）

| フィールド | 型 | 用途 |
|---|---|---|
| id | String (cuid) | PK |
| candidateId | String | FK → Candidate |
| title | String | メモタイトル |
| content | Text | メモ内容 |
| createdBy | String? | 作成者ID |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

### Candidate へのリレーション追加

- `candidateMemos CandidateMemo[]`

## 3. マイグレーションファイル

ファイル: `prisma/migrations/20260419000000_add_interview_memos_attachments_and_candidate_memos/migration.sql`
行数: 82行

SQL内容:
- `ALTER TABLE "interview_records"` — 7カラム追加
- `CREATE TABLE "interview_memos"` — 新規テーブル
- `CREATE TABLE "interview_attachments"` — 新規テーブル
- `CREATE TABLE "candidate_memos"` — 新規テーブル
- インデックス5つ追加
- 外部キー制約3つ追加（全て ON DELETE CASCADE）

### shadow database 問題の回避

`prisma migrate dev --create-only` は既存マイグレーション（`20260410000000_add_job_db_url`）のshadow database適用エラーで失敗。`prisma migrate diff --from-config-datasource --to-schema` で差分SQLを生成し、手動でマイグレーションディレクトリを作成して解決。

## 4. マイグレーション適用状況

- staging DB: **適用済み**（`prisma migrate deploy` で即時適用。42マイグレーション全て適用済み）
- production DB: **未適用**（別タスク）

Railway build スクリプト（`prisma generate && prisma migrate deploy && next build`）に `prisma migrate deploy` が含まれているため、staging push 時にも自動で再確認される。

## 5. ビルド結果

- `npm run build`: **成功**
- コンパイル時間: 18.4秒
- 全135ページ生成完了（+1: `/api/ai/schema-check`）
- `/api/ai/schema-check` ルート生成確認: OK

## 6. 動作検証結果

### ローカル `/api/ai/schema-check` 結果

```json
{
  "ok": true,
  "phase": "Phase 3: Interview memos/attachments + CandidateMemo tables added",
  "timestamp": "2026-04-19T13:58:30.123Z",
  "checks": {
    "interviewRecordCount": 0,
    "interviewDetailCount": 0,
    "interviewRatingCount": 0,
    "interviewMemoCount": 0,
    "interviewAttachmentCount": 0,
    "candidateMemoCount": 0,
    "newInterviewRecordFieldsAccessible": true,
    "sampleRecord": null,
    "sampleRelationshipCheck": "ok"
  }
}
```

全チェック項目OK:
- 全テーブル件数 0（期待通り）
- 新規フィールドアクセス可能: true
- Candidate → InterviewRecord → memos/attachments リレーション: ok

## 7. 既存スキーマへの影響

- InterviewRecord: 既存フィールド変更なし（7フィールド追加 + 1インデックス追加のみ）
- InterviewDetail: **変更なし**
- InterviewRating: **変更なし**
- 既存API (`/api/interviews/*`): **変更なし**（Phase 4 で対応予定）
- 既存UI (`/interviews/new`, `/interviews/[id]`): **変更なし**（Phase 4 以降で対応予定）

## 8. 将幸さんへの依頼事項

### 1. staging デプロイ確認

マイグレーションは既に staging DB に直接適用済みです。Railway の次回デプロイでスキーマ同期が確認されます。

デプロイ完了後、以下にアクセスして動作確認：

```
https://bizstudio-portal-staging-production.up.railway.app/api/ai/schema-check
```

期待される結果:
- `ok: true`
- 全カウント `0`
- `newInterviewRecordFieldsAccessible: true`
- `sampleRelationshipCheck: "ok"`

### 2. 本番DB適用は別タスク

Phase 4 以降の実装完了後に実施予定。

## 9. 次のフェーズ

### Phase 4a: AI解析API 統合
- 既存 `/api/interviews/analyze` を Phase 2 の gemini-client.ts に置き換え
- プロンプトYAMLを使うように内部リファクタリング
- フラグマスタ（flags.ts）に基づく解析品質向上

### Phase 4b: 新APIエンドポイント追加
- 自動保存API: `POST /api/interviews/:id/autosave`
- 添付管理API: `POST /api/interviews/:id/attachments`
- 添付解析API: `POST /api/interviews/:id/attachments/:attachmentId/analyze`
- メモ管理API: `/api/interviews/:id/memos`

### Phase 5: 統合ページUI実装
- 候補者詳細ページと面談履歴の統合
- 既存 `/interviews/new` と `/interviews/[id]` は統合ページに集約
