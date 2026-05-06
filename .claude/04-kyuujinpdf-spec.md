# 04. kyuujin-pdf-tool 仕様

求人マイページのバックエンド。Python 3.9 / FastAPI / SQLAlchemy / SQLite / Railway。

## リポジトリ情報

- リポジトリ: `mnhhohno-glitch/kyuujinPDF`
- ローカルパス: `C:\kyuujinnPDF`
- 本番: `web-production-95808.up.railway.app`
- staging: `web-staging-production-cd0e.up.railway.app`

## 主要テーブル

### projects
求人マイページ単位のプロジェクト

### processing_units
バッチ処理単位(送信のたびに新規作成される)

### jobs
求人レコード（`id` が portal 側 `externalJobId` に対応）

### job_feedbacks
求職者の回答(リアルタイム): status = apply/interested/pending/excluded/none

### share_tokens
マイページURL生成用トークン

## 主要エンドポイント (prefix `/api/external/mypage`)

| エンドポイント | 用途 |
|--|--|
| `PUT /{token}/feedback` | 求職者の回答 auto-save |
| `POST /{token}/submit` | 「送信」ボタン押下 |
| `PUT /jobs/feedback-status` | 仕分けステータス一括更新 |
| `PUT /jobs/restore` | EXCLUDED→UNANSWERED復活 |

## 認証

ほぼすべての external API は `x-api-secret` ヘッダによる認証。

## Python 3.9 制約

- `Optional[str]` を使う（`str | None` は使えない）
- `from typing import Optional, List, Dict` の import 必須

## 罠ポイント

- `processing_unit_id` で重複チェックがスコープ化されている
- `Memo.pdf_filename` は HITO-Linkモードでは NULL になることがある
- 本番DBへのローカルからのアクセスは不可(SQLite Railway永続化のみ)
