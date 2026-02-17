# Bizstudio Portal 要件定義書

## 1. プロジェクト概要

### 1.1 システム名
**Bizstudio Portal（ビズスタジオ ポータル）**

### 1.2 目的
人材紹介会社向けの社内ポータルシステム。求人解析結果の閲覧、AIジョブ（解析処理）の履歴管理、社内システムへのリンク集、ユーザー管理、監査ログ機能を提供する。

### 1.3 技術スタック
| 項目 | 技術 |
|------|------|
| フレームワーク | Next.js 16.1.6 (App Router) |
| 言語 | TypeScript |
| スタイリング | Tailwind CSS 4 |
| データベース | PostgreSQL (Railway) |
| ORM | Prisma 7.3.0 |
| 認証 | JWT (Cookie) |
| ホスティング | Railway |

---

## 2. ユーザーロールと権限

### 2.1 ロール定義
| ロール | 説明 |
|--------|------|
| `admin` | 管理者。全機能にアクセス可能 |
| `member` | 一般社員。管理機能以外にアクセス可能 |

### 2.2 ユーザーステータス
| ステータス | 説明 |
|------------|------|
| `active` | 有効。ログイン可能 |
| `disabled` | 無効。ログイン不可 |

---

## 3. 画面一覧と機能

### 3.1 認証系

#### `/login` - ログイン画面
- メールアドレス・パスワードでログイン
- ログイン成功時：JWTをCookieに保存、`/` へリダイレクト
- ログイン失敗時：エラーメッセージ表示
- 監査ログ記録：成功/失敗

#### `/invite/[token]` - 招待受諾・パスワード設定画面
- 招待トークンの検証
- 初回パスワード設定
- 設定完了後：ログイン画面へリダイレクト

---

### 3.2 一般ユーザー向け画面

#### `/` - ダッシュボード（トップページ）
- ログイン後の初期画面
- 統計情報、お知らせ、タスク、クイックリンクを表示（現在はダミー）

#### `/jobs` - 求人解析結果一覧
- AI解析された求人データの一覧表示
- テーブル形式：連番、会社名、求人タイトル、求人DB、更新日時
- 行クリックで詳細ページへ遷移
- **絞り込み機能**：`/jobs?jobId=xxx` でAIジョブIDによる絞り込み
- 絞り込み中は「絞り込み中」バッジと「解除」ボタン表示
- 「全件Excel出力」ボタン（絞り込み時は「絞り込み結果をExcel出力」）

#### `/jobs/[id]` - 求人詳細画面
- 求人情報をコードブロック形式で表示
- 「コピー」ボタン：クリップボードにコピー
- 「Excel出力」ボタン：単一求人をExcelダウンロード

#### `/ai-jobs` - AIジョブ（解析履歴）一覧
- 解析処理の履歴一覧
- テーブル形式：実行日時、求職者名、担当CA、求人DB、対象エリア、求人数、ステータス
- ステータスバッジ：完了（緑）、処理中（青）、失敗（赤）
- 「新規ジョブ（ダミー作成）」ボタン：ローカルステートにダミー追加
- 行クリックで詳細ページへ遷移

#### `/ai-jobs/[id]` - AIジョブ詳細画面
- パンくずリスト：「← 解析履歴に戻る」
- サマリーカード5枚：求職者名、求人DB、対象エリア、求人数、最終更新＋ステータス
- 「このジョブの求人一覧を見る」ボタン → `/jobs?jobId={id}` に遷移
- 「全件Excel出力（準備中）」ボタン：非活性

#### `/systems` - データ管理（システムリンク一覧）
- 有効なシステムリンクをカード形式で表示
- クリックで外部システムへ遷移

---

### 3.3 管理者向け画面（adminのみ）

#### `/admin/users` - ユーザー管理
- 招待発行フォーム：メールアドレス入力 → 招待リンク生成
- ユーザー一覧テーブル：名前、メール、ロール、ステータス、操作
- 有効/無効の切り替えボタン

#### `/admin/systems` - システム管理
- システムリンクのCRUD
- 新規作成フォーム：名前、説明、URL
- 一覧テーブル：名前、説明、URL、ステータス、並び順、操作
- 有効/無効の切り替え、並び順の変更

#### `/admin/audit` - 監査ログ
- 操作ログの一覧表示
- テーブル形式：日時、操作者、アクション、対象種別、対象ID、詳細

---

## 4. API一覧

### 4.1 認証API
| エンドポイント | メソッド | 説明 |
|----------------|----------|------|
| `/api/auth/login` | POST | ログイン |
| `/api/auth/logout` | POST | ログアウト |
| `/api/auth/consume-invite` | POST | 招待トークン消費・パスワード設定 |

### 4.2 管理API（adminのみ）
| エンドポイント | メソッド | 説明 |
|----------------|----------|------|
| `/api/admin/users` | GET | ユーザー一覧取得 |
| `/api/admin/users/[id]/status` | PATCH | ユーザーステータス変更 |
| `/api/admin/invites` | POST | 招待作成 |
| `/api/admin/systems` | GET | システム一覧取得（管理用） |
| `/api/admin/systems/create` | POST | システム作成 |
| `/api/admin/systems/[id]/update` | PATCH | システム更新 |
| `/api/admin/audit` | GET | 監査ログ取得 |

### 4.3 一般API
| エンドポイント | メソッド | 説明 |
|----------------|----------|------|
| `/api/systems` | GET | 有効なシステム一覧取得 |
| `/api/jobs/export` | POST | 求人データExcel出力 |

---

## 5. データベーススキーマ

### 5.1 users（ユーザー）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | String (CUID) | 主キー |
| name | String | 名前 |
| email | String | メールアドレス（一意） |
| password_hash | String | パスワードハッシュ |
| role | Enum(admin/member) | ロール |
| status | Enum(active/disabled) | ステータス |
| created_at | DateTime | 作成日時 |
| updated_at | DateTime | 更新日時 |

### 5.2 invites（招待）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | String (CUID) | 主キー |
| email | String | 招待先メールアドレス |
| token_hash | String | トークンハッシュ |
| expires_at | DateTime | 有効期限 |
| used_at | DateTime? | 使用日時 |
| created_by_user_id | String | 招待作成者ID |
| created_at | DateTime | 作成日時 |

### 5.3 systems（システムリンク）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | String (CUID) | 主キー |
| name | String | システム名 |
| description | String | 説明 |
| url | String | URL |
| status | Enum(active/disabled) | ステータス |
| sort_order | Int | 並び順 |
| created_at | DateTime | 作成日時 |
| updated_at | DateTime | 更新日時 |

### 5.4 audit_logs（監査ログ）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | String (CUID) | 主キー |
| actor_user_id | String | 操作者ID |
| action | String | アクション名 |
| target_type | Enum(AUTH/USER/SYSTEM) | 対象種別 |
| target_id | String? | 対象ID |
| metadata | Json? | 追加情報 |
| created_at | DateTime | 作成日時 |

---

## 6. UIデザイン仕様

### 6.1 カラーパレット
| 用途 | カラーコード |
|------|-------------|
| 背景 | `#F5F7FA` |
| カード背景 | `#FFFFFF` |
| 枠線 | `#E5E7EB` |
| テキスト | `#374151` |
| プライマリ | `#2563EB` |
| アクティブ背景 | `#EEF2FF` |
| サイドバー | `#1E3A8A` |
| 成功（完了） | `#16A34A` |
| 処理中 | `#2563EB` |
| エラー（失敗） | `#DC2626` |

### 6.2 タイポグラフィ
| 要素 | サイズ | ウェイト |
|------|--------|----------|
| ページタイトル | 20px | semibold |
| 本文 | 14px | normal |
| ラベル/注釈 | 12px | normal |
| フォント | Noto Sans JP, Inter |

### 6.3 レイアウト構成
```
┌─────────────────────────────────────────┐
│ TopBar (h-16, 白背景, 下線1px)           │
│ [会社名]                    [ユーザー名] [ログアウト] │
├──────────┬──────────────────────────────┤
│ Sidebar  │ Main Content                 │
│ (w-60)   │ (bg-[#F5F7FA], p-6)          │
│ 紺背景    │ max-w-6xl mx-auto           │
│          │                              │
│ メニュー   │ [白いCard内にコンテンツ]       │
│          │                              │
└──────────┴──────────────────────────────┘
```

### 6.4 コンポーネント
- **Card**: `rounded-[8px]`, `border border-[#E5E7EB]`, `bg-white`, `shadow-[0_1px_2px_rgba(0,0,0,0.06)]`
- **CardHeader**: `flex items-center justify-between`, `border-b`, `px-4 py-3`
- **CardBody**: `p-4`
- **Table**: `min-w-full border-collapse text-[14px]`
- **ボタン（プライマリ）**: `bg-[#2563EB] text-white rounded-md px-4 py-2`
- **ボタン（セカンダリ）**: `border border-[#E5E7EB] bg-white text-[#374151]`

---

## 7. 現在の実装状況

### 7.1 実装済み（DB連携あり）
- [x] ユーザー認証（ログイン/ログアウト）
- [x] 招待制ユーザー登録
- [x] ユーザー管理（一覧/有効無効切替）
- [x] システムリンク管理（CRUD）
- [x] 監査ログ記録・閲覧

### 7.2 実装済み（ダミーデータのみ）
- [x] 求人解析結果一覧・詳細（`/jobs`）
- [x] AIジョブ履歴一覧・詳細（`/ai-jobs`）
- [x] Excel出力機能
- [x] jobIdによる絞り込み機能

### 7.3 未実装（将来対応）
- [ ] 求人データのDB永続化
- [ ] AIジョブのDB永続化
- [ ] 外部解析システムとのAPI連携
- [ ] PDFアップロード・AI解析処理
- [ ] ダッシュボードの実データ表示
- [ ] レポート機能
- [ ] 設定画面
- [ ] ヘルプ画面

---

## 8. 環境変数

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `DATABASE_URL` | PostgreSQL接続文字列 | `postgresql://user:pass@host:port/db` |
| `JWT_SECRET` | JWT署名用シークレット | `your-secret-key` |

---

## 9. デプロイ情報

| 項目 | 値 |
|------|-----|
| ホスティング | Railway |
| リポジトリ | GitHub (`mnhhohno-glitch/bizstudio-portal`) |
| デプロイ方式 | GitHub連携による自動デプロイ |
| ビルドコマンド | `prisma generate && next build` |
| 起動コマンド | `npm run start` |

---

## 10. 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-02-17 | 初版作成 |
