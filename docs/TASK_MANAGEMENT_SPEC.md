# タスク管理機能 — 要件・仕様書

## 1. 機能概要

### 目的
キャリアアドバイザー（CA）の業務タスクを一元管理し、求職者支援に必要な作業（書類作成、エントリー対応、面談調整等）の進捗を可視化する。LINE WORKS通知と連携し、タスクの作成・完了をリアルタイムで共有する。

### 主要ユースケース
- 求職者に紐づくタスクの作成・管理（履歴書作成、推薦状作成、エントリー対応等）
- カテゴリテンプレートによる定型タスクの効率的な作成
- 複数担当者への割り当てと個別/一括完了管理
- 外部アプリ（scout-scheduler）からの日程調整タスク自動作成
- ファイル添付（Supabase Storage）とコメントによるコラボレーション

### ユーザーロール
| ロール | 権限 |
|---|---|
| 一般ユーザー | タスクの閲覧・作成・自分が担当/作成したタスクの編集・完了 |
| 管理者(admin) | 全タスクの編集・削除 |

---

## 2. データモデル

### 2-1. Task（タスク）
テーブル名: `tasks`

| フィールド | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| id | String | ○ | cuid() | 主キー |
| title | String | ○ | — | タスクタイトル |
| description | String? | — | null | 説明（Text型） |
| categoryId | String? | — | null | カテゴリFK |
| candidateId | String? | — | null | 求職者FK |
| status | TaskStatus | ○ | NOT_STARTED | ステータス |
| priority | TaskPriority? | — | null | 優先度 |
| dueDate | DateTime? | — | null | 期限 |
| createdByUserId | String | ○ | — | 作成者FK |
| completionType | String | ○ | "any" | "any"=誰か1人完了で完了 / "all"=全員完了で完了 |
| notificationPending | Boolean | ○ | false | 複製タスクの通知フラグ |
| createdAt | DateTime | ○ | now() | 作成日時 |
| updatedAt | DateTime | ○ | auto | 更新日時 |

**リレーション:**
- `category` → TaskCategory（多対1）
- `candidate` → Candidate（多対1）
- `createdByUser` → User（多対1）
- `assignees` → TaskAssignee[]（1対多、Cascade削除）
- `assigneeStatuses` → TaskAssigneeStatus[]（1対多）
- `fieldValues` → TaskFieldValue[]（1対多、Cascade削除）
- `attachments` → TaskAttachment[]（1対多、Cascade削除）
- `comments` → TaskComment[]（1対多、Cascade削除）

### 2-2. ステータス定義（TaskStatus）
| 値 | 表示名 | 色 |
|---|---|---|
| NOT_STARTED | 未着手 | bg-gray-100 text-gray-600 |
| IN_PROGRESS | 対応中 | bg-blue-100 text-blue-700 |
| COMPLETED | 完了 | bg-green-100 text-green-700 |

### 2-3. 優先度定義（TaskPriority）
| 値 | 表示名 | 色 |
|---|---|---|
| HIGH | 高 | bg-red-100 text-red-700 |
| MEDIUM | 中 | bg-yellow-100 text-yellow-700 |
| LOW | 低 | bg-gray-100 text-gray-600 |

### 2-4. TaskCategoryGroup（カテゴリグループ）
テーブル名: `task_category_groups`

| フィールド | 型 | 説明 |
|---|---|---|
| id | String | 主キー |
| name | String (unique) | グループ名 |
| sortOrder | Int | 表示順 |

### 2-5. TaskCategory（カテゴリ）
テーブル名: `task_categories`

| フィールド | 型 | 説明 |
|---|---|---|
| id | String | 主キー |
| name | String | カテゴリ名 |
| description | String? | 説明 |
| sortOrder | Int | 表示順 |
| isActive | Boolean | 有効フラグ |
| groupId | String? | グループFK |

### 2-6. TaskTemplateField（テンプレートフィールド）
テーブル名: `task_template_fields`

| フィールド | 型 | 説明 |
|---|---|---|
| id | String | 主キー |
| categoryId | String | カテゴリFK（Cascade削除） |
| label | String | 表示ラベル |
| fieldType | TaskFieldType | TEXT/TEXTAREA/SELECT/MULTI_SELECT/DATE/CHECKBOX/RADIO |
| isRequired | Boolean | 必須フラグ |
| placeholder | String? | プレースホルダー |
| description | String? | ヘルプテキスト |
| sortOrder | Int | 表示順 |

### 2-7. TaskAttachment（添付ファイル）
テーブル名: `task_attachments`

| フィールド | 型 | 説明 |
|---|---|---|
| id | String | 主キー |
| taskId | String | タスクFK（Cascade削除） |
| fileName | String | ファイル名 |
| fileSize | Int | サイズ(bytes) |
| mimeType | String | MIMEタイプ |
| storagePath | String | Supabaseパス `{taskId}/{uuid}.{ext}` |
| publicUrl | String | 公開ダウンロードURL |
| uploadedByUserId | String | アップロード者FK |

ストレージ: Supabase Storage `task-attachments` バケット。最大10MB。

### 2-8. TaskComment（コメント）
テーブル名: `task_comments`

| フィールド | 型 | 説明 |
|---|---|---|
| id | String | 主キー |
| taskId | String | タスクFK（Cascade削除） |
| userId | String | 投稿者FK |
| content | String | 内容（1〜2000文字） |

### 2-9. TaskAssignee / TaskAssigneeStatus
- `TaskAssignee`: タスク↔Employee の中間テーブル（unique: taskId+employeeId）
- `TaskAssigneeStatus`: completionType="all"時の個別完了状態（unique: taskId+userId）

---

## 3. 画面構成

### 3-1. タスク一覧画面
- **URL**: `/tasks`
- **ビューモード**: 自分のタスク(mine) / 依頼したタスク(requested) / 全件(all)
- **フィルタ**: ステータス、カテゴリグループ、カテゴリ、優先度、求職者名、担当者
- **ソート**: 作成日、期限、タイトル、ステータス、優先度、カテゴリ名、カテゴリグループ
- **ページネーション**: 20件/ページ
- **一括操作**: チェックボックス選択 → 一括完了 / 一括削除
- **表示項目**: ステータス、タイトル、カテゴリ、求職者、担当者、優先度、期限、作成日

### 3-2. タスク作成画面
- **URL**: `/tasks/new`
- **URLパラメータ**: `?candidateId={id}` — 求職者を事前選択可能
- **6ステップウィザード**:

| Step | 名称 | 内容 |
|---|---|---|
| 0 | 求職者選択 | 求職者に紐づけるか選択。紐づける場合は検索で選択 |
| 1 | カテゴリ選択 | グループ別アコーディオンでカテゴリ選択 |
| 2 | テンプレート入力 | カテゴリのテンプレートフィールドを入力 |
| 3 | 担当者選択 | 社員を検索・チェックボックスで複数選択 |
| 4 | 追加情報 | タイトル(自動生成)、説明、期限、優先度、添付ファイル |
| 5 | 確認・作成 | 全入力内容を確認して送信 |

**タイトル自動生成**: `{カテゴリ名} - {求職者名}`（求職者なしの場合はカテゴリ名のみ）
**優先度デフォルト**: MEDIUM
**完了タイプデフォルト**: "any"
**作成後の遷移**: `/tasks/{newTaskId}`

**求職者ファイル選択**: Step 4で候補者選択済みの場合、「📁 求職者ファイルから選択」ボタンが表示され、Google Driveのファイルをタスクに添付可能。

### 3-3. タスク詳細画面
- **URL**: `/tasks/{taskId}`
- **表示項目**: ステータス、優先度、タイトル、基本情報（求職者、カテゴリ、担当者、期限、作成者）、テンプレートフィールド値、説明、添付ファイル、コメント
- **操作**: 編集、複製、完了/未完了切替、削除
- **添付ファイル**: チェックボックス選択 → 一括DL / 求職者フォルダへ保存
- **コメント**: テキスト入力+送信（LINE WORKS通知連動）

### 3-4. タスク編集
- **方法**: 詳細画面の「編集」ボタン → 編集フォーム
- **編集可能**: タイトル、説明、ステータス、優先度、期限、担当者、テンプレートフィールド値
- **権限**: 作成者 または admin

---

## 4. APIエンドポイント

### タスクCRUD
| メソッド | URL | 説明 | 権限 |
|---|---|---|---|
| GET | /api/tasks | 一覧取得 | 認証済みユーザー |
| POST | /api/tasks | 新規作成 | 認証済みユーザー |
| GET | /api/tasks/{id} | 詳細取得 | 認証済みユーザー |
| PUT | /api/tasks/{id} | 更新 | 作成者 or admin |
| DELETE | /api/tasks/{id} | 削除 | 作成者 or admin |
| PATCH | /api/tasks/{id}/status | ステータス変更 | 作成者 or admin or 担当者 |
| POST | /api/tasks/{id}/clone | 複製 | 認証済みユーザー |

### コメント
| メソッド | URL | 説明 |
|---|---|---|
| GET | /api/tasks/{id}/comments | コメント一覧 |
| POST | /api/tasks/{id}/comments | コメント投稿（1〜2000文字） |

### 添付ファイル
| メソッド | URL | 説明 |
|---|---|---|
| GET | /api/tasks/{id}/attachments | 一覧取得 |
| POST | /api/tasks/{id}/attachments | アップロード（10MB上限） |
| DELETE | /api/tasks/{id}/attachments/{attachmentId} | 削除 |
| POST | /api/tasks/{id}/attachments/bulk-download | 一括DL（ZIP） |
| POST | /api/tasks/{id}/attachments/save-to-candidate | 求職者フォルダへコピー |

### ファイル連携
| メソッド | URL | 説明 |
|---|---|---|
| POST | /api/candidates/{id}/files/attach-to-task | 求職者ファイルをタスクに添付 |

### 外部API
| メソッド | URL | 認証 | 説明 |
|---|---|---|---|
| POST | /api/external/create-schedule-task | x-api-secret | 日程調整タスク自動作成 |

**POST /api/tasks リクエストボディ:**
```json
{
  "title": "string (必須)",
  "description": "string|null",
  "categoryId": "string|null",
  "candidateId": "string|null",
  "status": "NOT_STARTED (デフォルト)",
  "priority": "MEDIUM (デフォルト)",
  "dueDate": "datetime|null",
  "assigneeIds": ["string"] (必須、1件以上),
  "fieldValues": [{ "fieldId": "string", "value": "string" }],
  "completionType": "any (デフォルト)"
}
```

---

## 5. タスクカテゴリ・テンプレート

| # | カテゴリ名 | 主要フィールド |
|---|---|---|
| 1 | 履歴書作成 | 志望動機（大/中/小分類 — カスケード選択UI） |
| 2 | 職務経歴書作成 | 応募職種（カスケード選択）、作成ポイント、営業実績、自己PR |
| 3 | 推薦状作成 | 在籍状況、入社時期、年収情報、人物像（18項目マルチ選択）、転職理由（16項目マルチ選択） |
| 4 | エントリー対応 | エントリー日、件数、コメント |
| 5 | その他 | タスク内容 |
| 6 | 日程調整 | 希望日時、面談形式、備考 |

※ 他にも面接対策依頼、内定承諾報告、入社報告、FM登録依頼等のカテゴリが存在（seed.tsから）。

---

## 6. 通知連携（LINE WORKS）

### 通知タイミング
| イベント | 通知先 | 形式 |
|---|---|---|
| タスク作成 | 担当者全員 | 📋 + タスク情報 + リンク |
| タスク完了 | 他の担当者 + 作成者（完了者を除く） | ✅ + 完了情報 + リンク |
| コメント投稿 | 他の担当者 + 作成者（投稿者を除く） | 💬 + コメント抜粋 + リンク |

### 通知設定
- Bot ID: `LINEWORKS_TASK_BOT_ID`
- Channel ID: `LINEWORKS_TASK_CHANNEL_ID`
- メンション: ユーザーの `lineworksId` があれば@メンション付き、なければ名前表示

---

## 7. 求職者との関連

### 紐付け方法
- `Task.candidateId` で Candidate と多対1リレーション
- タスク作成ウィザードのStep 0で求職者を検索・選択

### 求職者詳細ページからの導線
- 求職者詳細 → 「タスク」タブ → この求職者に紐づくタスク一覧
- 「+ タスクを作成」ボタン → `/tasks/new?candidateId={id}` に遷移（求職者自動選択）
- 完了タスクの表示/非表示トグル

---

## 8. URLパラメータ・ディープリンク

### タスク作成画面
| パラメータ | 説明 | 例 |
|---|---|---|
| candidateId | 求職者を事前選択 | `/tasks/new?candidateId=xxx` |

※ カテゴリの事前指定は現時点では未実装。candidateIdのみ対応。

### タスク詳細
- `/tasks/{taskId}` — タスク詳細ページへの直接リンク
- LINE WORKS通知のリンクでも使用

---

## 9. 完了タイプのロジック

### completionType = "any"（デフォルト）
- 担当者の誰か1人が完了にすればタスク全体が完了
- ステータスが直接 COMPLETED に遷移

### completionType = "all"
- TaskAssigneeStatus テーブルで個別の完了状態を管理
- 各担当者が自分の完了を記録
- 全員が完了した時点でタスク全体が COMPLETED に遷移
- 一部のみ完了の場合は IN_PROGRESS

---

*このドキュメントは2026年3月31日時点のコードから自動生成されました。*
