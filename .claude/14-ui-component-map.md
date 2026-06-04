# 14. UI コンポーネント構造マップ

頻出修正対象の UI コンポーネントの内部構造マップ。実装着手前にここで構造を把握し、毎回の Cursor 経由構造調査を削減する。

## InterviewForm.tsx

### 基本情報
- パス: `src/components/candidates/InterviewForm.tsx`
- 行数: 1700+ 行（頻出修正対象）
- 用途: 面談履歴の入力フォーム
- 親: `InterviewHistoryTab` → `CandidateDetailPage`

### 全体レイアウト

画面全体は 100% 幅。内部で `grid grid-cols-2`（line 1045 周辺）で**左右50/50分割**。

```
CandidateDetailPage (100% width, no max-width)
  └─ InterviewHistoryTab (100% width)
       └─ InterviewForm (100% width)
            ├─ ヘッダー（保存・キャンセル・PDF表示等のボタン）
            └─ div.grid.grid-cols-2 (line 1045 周辺)
                 ├─ LEFT COLUMN (50%)
                 │    ├─ 面談基本情報（面談日、時刻、求職者ID、氏名、フリガナ、生年月日 等）
                 │    ├─ 転職活動状況（他AG状況、転職時期、活動期間、他社応募、最終学歴）
                 │    └─ 職務経歴（社毎の繰り返しブロック、「+ 職歴を追加」ボタン）
                 │
                 └─ RIGHT COLUMN (50%)
                      └─ タブ切替: rightTab === ?
                           ├─ "initial": 登録時条件 + メモセクション
                           ├─ "desired": 希望条件
                           ├─ "rank": ランク評価
                           ├─ "action": アクション
                           └─ "attachments": 添付（ファイル数バッジあり）
```

### メモセクション（line ~1290-1333）

`rightTab === "initial"` のときのみ表示。

```
メモ（見出し）
└─ メモアイテム配列（縦積み）
    └─ 各アイテム
        ├─ ヘッダー行（line ~1296）: flex items-center gap-1.5 flex-wrap
        │   ├─ 削除ボタン（BtnMini）
        │   ├─ タイトル input（flex: "1 1 180px", minWidth: 120）
        │   ├─ フラグセレクト（width: 110）"初回面談" / "その他" 等
        │   ├─ 日付 input type="date"（width: 116、line ~1309 で日付抽出）
        │   ├─ 時刻 TimeInput（width: 78）
        │   └─ 全体表示ボタン（line ~1318、T-032 Phase 2 追加）
        └─ 本文 textarea
            ├─ width: 100%
            └─ rows={8}（T-032 Phase 3 で 4 → 8 に拡張）
└─ 「+ 新規メモ登録」ボタン
└─ 全体表示モーダル（line ~1652、T-032 Phase 2 追加、conditional rendering）
    └─ max-w-4xl, max-h-[90vh]
    └─ 本文 textarea のみ編集可能（rows={20}）
    └─ リアルタイム保存（onChange で handleUpdateMemo 呼び出し）
```

### 主要ドロップダウンの行番号マップ

T-051 で整理した面談入力フォームのドロップダウン定義位置。選択肢配列はインライン定義（外部定数なし）。

| ラベル | 行 | state field | DB column | タブ |
|--|--|--|--|--|
| 活動期間 | L1286 | `d.activityPeriod` | `activity_period` | LEFT/転職活動状況 |
| 希望休日 | L1569 | `d.desiredDayOff` | `desired_day_off` | desired（希望条件）|
| 希望残業 | L1570 | `d.desiredOvertimeMax` | `desired_overtime_max` | desired（希望条件）|
| 連絡手段 | L1700 | `d.contactMethod` | `contact_method` | action（アクション）|
| 送付予定 | L1704 | `d.jobReferralFlag` | `job_referral_flag` | action（アクション）|

選択肢を変更する際は、`src/constants/candidate-flags.ts`(AI解析側)との不一致による罠（罠 #5 / `08-bug-patterns.md` A-1）に注意。AI側の同期は candidate-intake 側で別途行う。

### 添付タブ（line ~1604-1612）

`rightTab === "attachments"` のときのみ表示。面談ログ・録音・履歴書 PDF 等の D&D + ファイル選択アップロード UI。

#### 構造

```
ドロップ領域 div（onDrop / onDragOver 付き）
├─ アイコン（📎）
├─ 「Notta ログ / 録音 / 履歴書 PDF 等をドラッグ＆ドロップ」テキスト
├─ 「ファイルを選択」ボタン
│   └─ <input type="file" multiple>（hidden、ボタンクリックで起動）
└─ 対応形式注記（.txt / .pdf / .docx / .xlsx / .mp3 / .m4a / .png / .jpg、最大 20MB）

添付ファイル一覧（既にアップ済みのファイル）
├─ 「ログを解析して各カラムへ自動入力」ボタン
└─ ファイル行（削除ボタン + ファイル名 + DL ボタン + サイズ）の繰り返し
```

#### 添付タブ handler

| handler | シグネチャ | 用途 | 行 |
|--|--|--|--|
| `handleUpload(file)` | File 1引数 | 単一ファイル POST（FormData ベース） | L656-674 |
| `handleUploadMultiple(files)` | File[] 1引数 | 逐次 await ループで `handleUpload` 呼び出し（T-041 で追加） | L674-678 |
| `onDrop(e)` | DragEvent インライン | `Array.from(e.dataTransfer.files)` を `handleUploadMultiple` へ | L1606 |
| `onChange(e)` | ChangeEvent インライン | `Array.from(e.target.files ?? [])` を `handleUploadMultiple` へ | L1611 |

#### 重要な実装パターン（T-041 の修正で確立）

複数ファイル D&D / 選択を扱う場合、以下3点を**セットで実装する**:

1. `<input type="file" multiple>` 属性を必ず付ける
2. `onDrop` / `onChange` 両方で `Array.from(...)` してループ処理
3. アップロード自体は API 単一ファイル前提のままでよく、フロント側ループで個別 POST する逐次パターン

`files[0]` だけ拾う実装は典型的な D&D バグの温床。新規 UI 実装時のテンプレとしてこのパターンを採用すること（罠ポイント #31 参照）。

#### 関連ファイル

- API: `src/app/api/interviews/[id]/attachments` 配下（単一ファイル POST、複数対応はフロント側ループで実現）
- T-041 修正: master commit cde6530、staging merge 済み

### 面談基本情報グリッド（line ~1053）

6列グリッド（`repeat(6, minmax(0, 1fr))`）。各行は col-span-2 セルで構成。

```
Row 1: 面談日(col-span-2) | 時刻(col-span-2) | 時間/手法(col-span-2)
Row 2: 求職者ID(col-span-2) | 氏名(col-span-2) | 年齢/性別(col-span-2)
Row 3: フリガナ(col-span-2) | 生年月日(col-span-2) | 住所(col-span-2)
Row 4: TEL(col-span-2) | E-Mail(col-span-2) | LINE(col-span-2)
Row 5: 担当CA(col-span-2) | 担当(col-span-2) | ランク/最新(col-span-2)
Row 6: 回数/状態(col-span-2) | 結果(col-span-2) | フラグ(col-span-2)
```

### 主要 handler シグネチャ

| handler | シグネチャ | 用途 |
|--|--|--|
| `handleAddMemo()` | 引数なし | 新規メモ作成（line 713 周辺） |
| `handleUpdateMemo(memoId, field, value)` | **3引数** | メモ部分更新（line 736 周辺）⚠️ オブジェクト渡しではない |
| `handleDeleteMemo(memoId)` | memoId 1引数 | メモ削除 |

### 主要 state

| state | 型 | 用途 |
|--|--|--|
| `memos` | `MemoRecord[]` | メモ配列 |
| `expandedMemoId` | `string \| null` | 全体表示モーダルの対象メモID（T-032 Phase 2 追加） |
| `rightTab` | `string` | 右カラムのタブ切替 |
| `form` | object | 面談基本情報フォームデータ |
| `workHistories` | `WorkHistoryRecord[]` | 職務経歴配列 |
| `attachments` | `AttachmentRecord[]` | 添付ファイル配列 |

### 関連ファイル

- API: `src/app/api/interviews/[id]/memos/route.ts`（GET / POST）
- API: `src/app/api/interviews/[id]/memos/[memoId]/route.ts`（PATCH / DELETE）
- 共通スタイル: `BtnMini`、CSS変数 `--im-bg`, `--im-bdr`, `--im-fg`, `--im-fg2`, `--im-fg3` 等
- モデル: `prisma/schema.prisma` の `InterviewMemo`（詳細は `03-portal-spec.md` 参照）

---

## InterviewHistoryTab.tsx

### 基本情報
- パス: `src/components/candidates/InterviewHistoryTab.tsx`
- 行数: ~260 行
- 用途: 面談履歴タブ全体（面談一覧バー + 選択面談のフォーム表示）
- 親: `CandidateDetailPage.tsx`（`activeView === "interview"` のとき表示）

### Props

```typescript
type Props = {
  candidateId: string;
  currentUser: SessionUser | null;  // { id, name, email, role }
};
```

### 全体レイアウト

```
InterviewHistoryTab
  ├─ Toaster (sonner)
  ├─ 面談一覧バー（白背景、border、p-3 mb-3）
  │   ├─ 「面談:」ラベル
  │   ├─ 面談ボタン群（先頭5件 = visibleInterviews）
  │   │   └─ 各ボタン: StatusDot + "{N}回目" + 日付（M/D）
  │   ├─ 「すべて(N)」ドロップダウン（6件以上ある場合のみ表示）
  │   │   └─ 展開時: 全面談リスト（StatusDot + 回数 + 日付 + 担当者名）
  │   ├─ 「+ 新規面談」ボタン ⚠️ 罠あり（後述）
  │   └─ 選択中面談の情報（ml-auto: 面談種別 | 担当者名）
  └─ 面談フォーム領域
      ├─ selectedInterview あり → <InterviewForm />
      └─ selectedInterview なし → 空状態（「+ 新規面談を作成」ボタン）
```

### StatusDot コンポーネント

| status | lastSavedAt | 表示 | title |
|--|--|--|--|
| `"complete"` | any | 🟢 緑 | 完了 |
| other | truthy | 🟡 黄 | 下書き(保存あり) |
| other | null | 🔴 赤 | 未入力 |

### 「＋新規面談」ボタンの draft 作成パス

`handleCreateInterview()` → POST `/api/interviews` でドラフト InterviewRecord を作成。

⚠️ **罠ポイント #17 サブパターン（ソート順崩れ）該当箇所**:
- L114: `interviewDate` は `now.toLocaleDateString("sv-SE")` で送信（T-042 follow-up で修正済み、commit ab108b9）
- 修正前は `now.toISOString()` でフルタイムスタンプが DB に入り、面談管理一覧のソートが崩壊していた
- 他フィールド（startTime, endTime）は `HH:MM` 文字列で送信（問題なし）

#### POST body 構造

```typescript
{
  candidateId,
  interviewDate: now.toLocaleDateString("sv-SE"),   // "YYYY-MM-DD" ⚠️ toISOString() 禁止
  startTime: timeStr,                                // "HH:MM"
  endTime: timeStr,                                  // "HH:MM"
  interviewTool: "電話",
  interviewerUserId: currentEmployeeId,              // Employee.id（User.id ではない）
  interviewType: interviews.length === 0 ? "初回面談" : "フォロー面談",
  status: "draft",
}
```

#### 前提条件チェック

1. `currentUser` が null → toast エラー「再ログインしてください」
2. `currentEmployeeId` が null → toast エラー「社員情報がアカウントに紐づいていません」
3. `currentEmployeeId` は useEffect 内で `/api/employees` → `userId` マッチで取得

### 主要 state

| state | 型 | 用途 |
|--|--|--|
| `interviews` | `InterviewRecord[]` | 面談一覧（interviewCount 昇順ソート） |
| `selectedId` | `string \| null` | 選択中の面談 ID |
| `creating` | `boolean` | 新規面談作成中フラグ |
| `dropdownOpen` | `boolean` | 「すべて」ドロップダウン開閉 |
| `currentEmployeeId` | `string \| null` | ログインユーザーに紐づく Employee.id |

### InterviewRecord 型（ローカル定義）

```typescript
type InterviewRecord = {
  id: string;
  interviewDate: string;
  interviewCount: number;
  status: string;
  isLatest: boolean;
  lastSavedAt: string | null;
  startTime: string | null;
  endTime: string | null;
  interviewTool: string | null;
  interviewType: string | null;
  interviewer: { name: string } | null;
  rating: { overallRank: string | null; grandTotal: number | null } | null;
  _count: { memos: number; attachments: number };
};
```

### 関連ファイル

- API (一覧): `src/app/api/candidates/[candidateId]/interviews/route.ts`
- API (作成): `src/app/api/interviews/route.ts` POST
- 子: `<InterviewForm>` (`src/components/candidates/InterviewForm.tsx`)
- 親: `CandidateDetailPage.tsx`

---

## HistoryTab.tsx

### 基本情報
- パス: `src/components/candidates/HistoryTab.tsx`
- 行数: 2700+ 行（頻出修正対象）
- 用途: 紹介履歴タブ全体（ブックマーク / 求人紹介 / エントリー / 紹介保留の 4 サブタブ）
- 親: `CandidateDetailPage.tsx` → `activeTab === "history"`

### 全体レイアウト

```
HistoryTab
  ├─ タブバー: bookmark / jobs / entries / archived
  ├─ bookmark タブ → BookmarkSection（行 408〜、インライン関数コンポーネント）
  │   ├─ ファイルアップロード D&D 領域
  │   ├─ ツールバー（検索 / 日付フィルタ / ソート / AI 分析 / 送信ボタン）
  │   ├─ ヘッダー行（チェック / ファイル名 / 希望 / 通過 / 総合 / 担当 / 日時）
  │   ├─ ファイル一覧（filteredFiles.map、行 ~1005）
  │   │   └─ 各行: チェック + ファイル名 + 3 軸バッジ + 担当 + 日時 + DL/ 保留ボタン
  │   ├─ 紹介保留セクション（アコーディオン、行 ~1400）
  │   ├─ 送信モーダル（求人出力ツール送信、行 ~1085）
  │   ├─ PDF プレビューポップアップ（行 ~1253）
  │   ├─ AI 分析コメントモーダル（行 ~1289、T-055 で 3 軸セレクト追加）
  │   │   ├─ ヘッダー: aiMatchRating バッジ + ファイル名
  │   │   ├─ 3 軸セレクト UI（希望 / 通過 / 総合、A/B/C/D ドロップダウン）
  │   │   ├─ 本文: 表示モード / 編集モード（textarea）
  │   │   └─ フッター: 編集 / コピー / 保存 / キャンセル
  │   └─ アーカイブモーダル（行 ~288、別関数 ArchiveModal）
  ├─ jobs タブ → 求人紹介一覧（kyuujinPDF 連携）
  ├─ entries タブ → エントリー一覧
  └─ archived タブ → ArchivedBookmarkSection（紹介保留、L1471〜1782）
```

### 評価データフロー（★重要★）

```
AI 分析実行 (analyze-batch)
  └→ DB 保存: aiMatchRating(総合 A/B/C/D) + aiAnalysisComment(テキスト全文、3 軸マーカー含む)

一覧バッジ表示
  ├─ 希望: parse3AxisRatings(aiAnalysisComment).wish    (テキストパース)
  ├─ 通過: parse3AxisRatings(aiAnalysisComment).pass    (テキストパース)
  └─ 総合: parse3AxisRatings(aiAnalysisComment).overall || aiMatchRating  (フォールバック)

モーダル編集→保存 (T-055 修正後)
  └→ PATCH /files/[fileId]
      ├─ aiAnalysisComment 更新（テキスト本文）
      └─ aiMatchRating 同時更新（テキストから "■ 総合: X" を正規表現抽出）
```

### 主要 state（BookmarkSection 内）

| state | 型 | 用途 |
|--|--|--|
| `files` | `BookmarkFile[]` | ブックマーク一覧 |
| `selectedIds` | `Set<string>` | チェック済みファイル ID |
| `selectedAnalysis` | `{ fileId, fileName, rating, comment } \| null` | AI 分析モーダルの対象 |
| `editingComment` | `boolean` | テキスト編集モード |
| `editedCommentText` | `string` | 編集中テキスト |
| `wishRating` / `passRating` / `overallRating` | `string` | 3 軸セレクト state（T-055 追加） |
| `savingComment` | `boolean` | 保存中フラグ |
| `previewFile` | `BookmarkFile \| null` | PDF プレビュー対象 |
| `sortField` | `"name" \| "rating" \| "wish" \| "pass" \| "overall" \| "uploader" \| "date" \| null` | ソートカラム |

### 主要 handler

| handler | シグネチャ | 用途 | 行 |
|--|--|--|--|
| `openAnalysis(e)` | `(e: React.MouseEvent) => void` | バッジクリック → モーダル open + セレクト初期値設定 | L1046 |
| `updateRatingMarker(axis, value)` | `(axis: "wish" \| "pass" \| "overall", value: string) => void` | セレクト変更 → テキスト内マーカー書換 + state 更新（T-055 追加） | 新規 |
| 保存ボタン onClick | inline | PATCH API → local state 更新（aiAnalysisComment + aiMatchRating） | L1334 |
| `fetchBookmarkRatings()` | 引数なし | 求人紹介タブ用に 3 軸評価 Map 構築 | L1775 |
| `parse3AxisRatings(comment)` | `(comment: string \| null) => { wish, pass, overall } \| null` | テキストから 3 軸パース（表示専用） | L365 |

### 関連 API

- 一覧取得: `src/app/api/candidates/[candidateId]/files/route.ts`
- 個別 PATCH: `src/app/api/candidates/[candidateId]/files/[fileId]/route.ts`（T-055 で aiMatchRating 同期追加）
- AI 分析: `src/app/api/candidates/[candidateId]/bookmarks/analyze-batch/route.ts`
- マイページ送信: `src/app/api/candidates/[candidateId]/bookmarks/send-to-job-tool/route.ts`

### 関連ユーティリティ

- `parse3AxisRatings(comment)`: HistoryTab.tsx L365、表示専用
- `comment-split.ts` の `RATING_LINE_RE`: マイページ送信時に評価行を除去

### ArchivedBookmarkSection（紹介保留）

#### 位置
- 行範囲: L1471〜1782
- 同ファイル内のインライン関数コンポーネント

#### データモデル（CandidateFile）

紹介保留は CandidateFile レコードに対する**論理的なステータス**で、以下の 4 フィールドで管理:

| フィールド | 型 | 意味 |
|--|--|--|
| `archivedAt` | Date \| null | null でないとき紹介保留中 |
| `archivedReason` | string \| null | 保留理由（例: 「希望条件不一致」）|
| `archivedNote` | string \| null | 自由記述メモ |
| `archivedById` | string \| null | 保留操作した CA の ID |

復元時は上記 4 フィールドをすべて null クリアする。

#### 関連 API

| 操作 | エンドポイント | 副作用 |
|--|--|--|
| 復元 | `POST /api/candidates/[candidateId]/files/[fileId]/restore` | archive 解除 + AuditLog(`BOOKMARK_RESTORE`) + supportSubStatus 再計算 |
| 完全削除 | `DELETE /api/candidates/[candidateId]/files/[fileId]/permanent` | Drive 削除（`deletePdfFromDrive`）+ DB レコード削除 + AuditLog(`BOOKMARK_PERMANENT_DELETE`) + supportSubStatus 再計算 |

#### 一括操作（2026/5/15 追加）

- 一括復元・一括削除: `Promise.allSettled` で既存個別 API をループ呼び出し
- チェックボックス + 全選択（indeterminate 対応）+ 確認モーダル（削除時）
- 同ファイル BookmarkSection L606–619 の一括化先例に倣ったパターン

#### 関連ファイル

- API:
  - `src/app/api/candidates/[candidateId]/files/[fileId]/restore/route.ts`
  - `src/app/api/candidates/[candidateId]/files/[fileId]/permanent/route.ts`
- Drive 削除ユーティリティ: `deletePdfFromDrive`（`src/lib/google-drive.ts`）
- モデル: `prisma/schema.prisma` の `CandidateFile`
- 関連罠: AuditLog（罠 #15）、supportSubStatus 自動再計算（罠 #11）、Drive 二重保存（罠 #13）

### 修正履歴

- 2026/5/15: ArchivedBookmarkSection に一括復元・一括削除機能追加（master 3f1c9d5 / staging 3af1c8b）

---

## DocumentsTab.tsx

### 基本情報
- パス: `src/components/candidates/DocumentsTab.tsx`
- 行数: 1226 行
- 用途: 求職者詳細「書類」タブ（5サブタブでファイル管理。原本 ORIGINAL / BS作成書類 BS_DOCUMENT / 応募企業 APPLICATION / 面接対策 INTERVIEW_PREP / 面談 MEETING）
- 親: `CandidateDetailPage.tsx`（`activeTab === "documents"`）

### 全体レイアウト

```
DocumentsTab (1226 行)
  ├─ ルートコンテナ div.relative（タブ全体 D&D 受付、L730-748、dragCounter ref）
  ├─ サブタブバー（L749-766）: ORIGINAL / BS_DOCUMENT / APPLICATION / INTERVIEW_PREP / MEETING
  │    state: activeSubTab（初期 "ORIGINAL"）
  ├─ テンプレートセクション（L768-803、原本タブのみ）
  ├─ カテゴリヘッダー（L806-862）
  │    ├─ タイトル（📁 原本 / BS作成書類 / ...）
  │    ├─ ボタン群（タブ別）:
  │    │    BS_DOCUMENT: [一括URL発行][+ フォルダ作成]
  │    │    MEETING: [📝 面談登録 ↗]（candidate-intake /register へ遷移）
  │    │    共通: [+ アップロード]
  │    └─ 説明文（DESCRIPTIONS[activeSubTab]）
  ├─ ファイル一覧領域（L873-1056）
  │    ├─ ローディング / 空状態
  │    ├─ 全選択 + ソート（ファイル名/形式/日時）+ 一括操作（DL/URL発行/タスク添付/削除）
  │    ├─ BS_DOCUMENT: フォルダ階層表示
  │    └─ その他: フラット表示（renderFileCard）
  ├─ 面談履歴一覧（L1059-1062、MEETING タブのみ）→ <InterviewHistory candidateId />（L1174-1230）
  ├─ モーダル群（L1064-1170）: FileUploadModal / 共有URL結果 / タスク添付
  └─ タブ全体ドロップ オーバーレイ（L1172-1178、isTabDragging 時）
```

### 主要 handler シグネチャ

| handler | 行 | シグネチャ | 用途 |
|--|--|--|--|
| `handleAreaDrop` | L348 | `(fileList: FileList, folderId?: string) => void` | D&D アップロード。`activeSubTab` を category として送信 |
| `handleDelete` | L181 | `(fileId: string) => void` | `DELETE /api/candidates/[candidateId]/files/[fileId]` → Drive+DB 削除 |
| `handleUploadSuccess` | L195 | `() => void` | ファイル・カウント・フォルダ再取得 |
| `handleOpenIntake` | L337 | `() => void` | candidate-intake `/register` を新タブで開く（MEETING のみ） |
| `fetchFiles` | L123 | `async () => void` | `GET /api/candidates/[candidateId]/files?category=${activeSubTab}` |

### 主要 state

| state | 型 | 行 | 用途 |
|--|--|--|--|
| `activeSubTab` | `string` | L74 | サブタブ切替（"ORIGINAL" 等の enum 値） |
| `files` | `CandidateFile[]` | L75 | 現タブのファイル一覧 |
| `counts` | `Record<string, number>` | L76 | 各サブタブのファイル数 |
| `isTabDragging` | `boolean` | L113 | タブ全体 D&D 状態（dragCounter ref で管理） |
| `dragCounter` | `useRef(0)` | L112 | D&D enter/leave カウンタ |
| `showUploadModal` | `boolean` | L78 | FileUploadModal 表示 |
| `selectedFileIds` | `Set<string>` | L92 | 一括操作用選択 |
| `dragOverFolderId` | `string \| null` | L109 | BS作成書類フォルダ別 D&D ハイライト |

### 関連ファイル

| ファイル | 役割 |
|--|--|
| `src/app/api/candidates/[candidateId]/files/route.ts` | 一覧取得（GET） |
| `src/app/api/candidates/[candidateId]/files/upload/route.ts` | アップロード（POST → Google Drive） |
| `src/app/api/candidates/[candidateId]/files/[fileId]/route.ts` | 個別取得/更新/削除 |
| `src/app/api/candidates/[candidateId]/files/counts/route.ts` | サブタブ別件数 |
| `src/components/candidates/FileUploadModal.tsx` | アップロードモーダル |
| `prisma/schema.prisma` `CandidateFile` + `CandidateFileCategory` enum | モデル |

### T-067 補足（面談添付統合との関係）

- MEETING サブタブが面談ログ・資料の source of truth（T-067）
- 面談入力画面 InterviewForm.tsx の「添付」タブも同じ `CandidateFile`(MEETING) を参照（両画面が常に一致）
- 面談AI解析（analyze-with-intake）も MEETING カテゴリのファイルを読む

---

## EntryBoard.tsx

### 基本情報
- パス: `src/components/entries/EntryBoard.tsx`
- 行数: 1083 行
- 用途: エントリー管理画面（全フラグタブ + フィルタ + テーブル + モーダル群 + Google 同期ダイアログ）
- 親: `/app/(app)/entries/page.tsx`

### 全体レイアウト

```
EntryBoard (1083 行)
  ├─ ヘッダー（L738-755）: "エントリー管理" + [新規登録] + [CSV]
  ├─ タブバー（L757-777）: 求人紹介 / エントリー / 書類選考 / 面接 / 内定 / 入社済 / 全件
  ├─ フィルタバー（L779-856）: 求職者名 / 担当CA / 企業名 / 無効も表示 / アーカイブも表示 / URL未入力のみ
  ├─ 一括操作バー（L858-907、selectedIds.size > 0 時）:
  │     一括フラグ変更 / 選考終了案内 / 選考終了(フラグのみ) / タスク作成 / アーカイブ / 選択解除
  ├─ <EntryTable />（L915-936）: テーブル本体（面接日時のインライン編集あり）
  ├─ ページネーション（L938-959）
  ├─ モーダル群（L961-1065）:
  │     URL編集 / EntryDetailModal / EntryCreateModal / BulkFlagChangeModal
  │     / EndNoticeModal / BulkEndFlagModal / EntryEditModal / EntryRouteSwitchModal
  └─ TaskSyncConfirmDialog（L1068-1080）: Google 同期確認ダイアログ
```

### 面接 Google 同期セクション（T-066 Phase 4/5）

面接日時の保存/変更/消去/選考終了フラグ変更時に、Google カレンダー予定と Google ToDo タスクを同時に作成・更新・削除する。

#### トリガー検知と API 呼び出しの流れ

```
面接日時変更
  ├─ インライン onBlur（EntryTable 内） → handleFieldUpdate (L398)
  │     → INTERVIEW_DATE_TIME_FIELDS に含まれるか判定 (L415)
  │     → computeTaskSync(before, after) (L417)
  │     → TaskSyncConfirmDialog を open
  │
  ├─ モーダル一括保存（EntryDetailModal 内） → handleSave (L86)
  │     → onRequestTaskSync(entryId, before, after) props 経由 (L107)
  │     → EntryBoard.openTaskDialogForEntry (L351)
  │     → computeTaskSync → TaskSyncConfirmDialog を open
  │
  └─ 選考終了フラグ変更
        → handleFlagUpdate (L377)
        → maybeOpenCompleteForEndFlag (L362)
        → gtaskId が残っている slot を complete ダイアログへ

ダイアログ確認
  → handleTaskConfirm (L429)
  → for (slot of slots): POST /api/entries/[entryId]/sync-task { slot, action }
  → 結果に応じてトースト表示（成功/partial/エラー/scope不足/API未有効）
```

#### トリガー別の操作対応表

| トリガー | dialog action | カレンダー予定 | ToDo タスク |
|--|--|--|--|
| 日付+時間が新規に揃った | create | `createCalendarEvent` → `gcalId` 保存 | `createTask` → `gtaskId` 保存 |
| 既存日時を変更 | update | `gcalId` あれば `updateCalendarEvent`、無ければ `createCalendarEvent`（フォールバック） | `updateTask` |
| 日時を空にした | complete | `deleteCalendarEvent` → `gcalId` を null | `completeTask` → `gtaskId` を null |
| 選考終了系フラグへ変更 | complete | `deleteCalendarEvent` → `gcalId` を null | `completeTask` → `gtaskId` を null |

⚠️ **非対称ポイント**: dialog action は3種（create/update/complete）だが、カレンダー予定には「完了」概念が無いため、タスクの complete はカレンダー側では **delete** に対応する。次に同期系を触る人が「complete なのに予定を削除しているのは何故か」で混乱しやすい箇所。

#### カレンダー予定の仕様

- 予定タイトル: `[一次面接] {求職者氏名} / {企業名}`（二次/最終はラベル差し替え）
- 開始 = 面接時刻、終了 = 開始 + 60分（24時超は 23:59 頭打ち。日跨ぎさせない）
- タイムゾーン: `Asia/Tokyo`
- 同期対象: 一次面接 / 二次面接 / 最終面接（面接対策は対象外）

#### フェイルソフト

予定とタスクは**独立処理**。片方失敗してもロールバックしない。

- 両方成功 → `{ success: true, taskId, eventId }`
- 片方失敗 → `{ success: true, partial: true, failed: "task"|"calendar" }`（200）→ フロント warning トースト
- 両方失敗 → `{ success: false }` (500)
- scope 不足 → 403 → 再認証導線トースト

### API

`POST /api/entries/[entryId]/sync-task`（1ルートで予定＋タスク両方を処理）

- リクエスト: `{ slot: "first"|"second"|"final", action: "create"|"update"|"complete" }`
- フォールバック: `action=create` だが `gtaskId` 既存 → `update` に解決。`action=update` だが `gtaskId` 無し → `create` に解決。`action=update` だが日時消失 → `complete` に解決。

### 主要 handler シグネチャ

| handler | 行 | シグネチャ | 用途 |
|--|--|--|--|
| `computeTaskSync` | L318 | `(before: Entry, after: Entry) => { action, slots } \| null` | 保存前後差分から同期 action と対象 slot を算出 |
| `openTaskDialogForEntry` | L351 | `(entryId: string, before: Entry \| null, after: Entry) => void` | `computeTaskSync` 呼び出し → ダイアログ open（EntryDetailModal 用コールバック） |
| `maybeOpenCompleteForEndFlag` | L362 | `(entry: Entry, flags: Record<string, string \| null>) => void` | 選考終了系フラグ検知 → gtaskId が残る slot を complete ダイアログへ |
| `handleFieldUpdate` | L398 | `(entryId: string, fields: Record<string, unknown>) => void` | インライン面接日時 onBlur → PATCH → 面接フィールド変更検知 → `computeTaskSync` |
| `handleFlagUpdate` | L377 | `(entryId: string, flags: Record<string, string \| null>) => void` | フラグ更新 → `maybeOpenCompleteForEndFlag` |
| `handleTaskConfirm` | L429 | `() => Promise<void>` | ダイアログ確認 → slot ループで `sync-task` API 呼び出し → トースト |
| `handleBulkArchive` | L497 | `(selectedEntries: Entry[]) => void` | 一括アーカイブ |
| `handleCreateTasks` | L568 | `(selectedEntries: Entry[]) => void` | エントリー対応タスク作成（単数→遷移 / 複数→API一括） |

### 主要 state

| state | 型 | 行 | 用途 |
|--|--|--|--|
| `entries` | `Entry[]` | L121 | エントリー一覧 |
| `activeTab` | `string` | L123 | フラグタブ切替（求人紹介〜全件） |
| `selectedIds` | `Set<string>` | L149 | 一括操作用の選択 |
| `calendarConnected` | `boolean` | L170 | Google 連携状態（useEffect で `/api/calendar/events` から取得） |
| `taskDialogOpen` | `boolean` | L171 | Google 同期確認ダイアログの表示 |
| `taskDialogAction` | `TaskSyncAction` | L172 | "create" / "update" / "complete" |
| `taskDialogSlots` | `TaskSyncSlot[]` | L173 | ダイアログに表示する slot 一覧（{slot, label, detail}） |
| `taskDialogEntryId` | `string \| null` | L174 | 同期対象エントリーID |
| `taskLoading` | `boolean` | L175 | sync-task API 呼び出し中 |
| `detailEntryId` | `string \| null` | L152 | EntryDetailModal 表示対象 |
| `routeModalEntry` | `Entry \| null` | L164 | EntryRouteSwitchModal 表示対象 |

### 関連定数

| 定数 | 行 | 用途 |
|--|--|--|
| `END_FLAG_DETAILS` | L75 | 選考終了系フラグ値 Set（"書類見送り", "面接見送り", "本人辞退"） |
| `INTERVIEW_SLOT_DEFS` | L88 | slot/label/dateField/timeField/gtaskField の定義配列 |
| `INTERVIEW_DATE_TIME_FIELDS` | L94 | 面接日時フィールド名 Set（6フィールド） |
| `TABS` | L107 | タブ定義（求人紹介〜全件の7タブ） |

### 関連ファイル

| ファイル | 役割 |
|--|--|
| `src/app/api/entries/[entryId]/sync-task/route.ts` | 同期 API（1ルートで予定＋タスク両方を処理） |
| `src/lib/googleCalendar.ts` | カレンダー予定 CRUD（`createCalendarEvent` / `updateCalendarEvent` / `deleteCalendarEvent`）。ScheduleEntry 同期と共用 |
| `src/lib/googleTasks.ts` | ToDo タスク CRUD（`createTask` / `updateTask` / `completeTask`） |
| `src/components/entries/TaskSyncConfirmDialog.tsx` | ダイアログ UI（props: `open`, `action`, `slots`, `loading`, `onConfirm`, `onCancel`） |
| `src/components/entries/EntryDetailModal.tsx` | モーダル一括保存経路（`onRequestTaskSync` props 経由で EntryBoard に委譲、L107） |
| `src/components/entries/EntryTable.tsx` | テーブル本体（面接日時のインライン onBlur → `onFieldUpdate` で EntryBoard に委譲） |
| `prisma/schema.prisma` の `JobEntry` | `*InterviewGtaskId` 3列（L1310-1312）+ `*InterviewGcalId` 3列（L1315-1317） |

### JST 罠の所在

- 予定の開始/終了 dateTime: `sync-task/route.ts` の `toJstDateString()` で `d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })` を使用
- タスクの due: 同上
- `toISOString().slice(0,10)` は **禁止**（JST 9時間ずれで前日になる。詳細は `12-pitfalls.md` 参照）
- `formatInterviewDateTime()` (EntryBoard L81): ダイアログ表示用の日時整形も同じ `sv-SE` + `Asia/Tokyo` パターン

### EntryTable: 本人辞退時の対応フラグ表示フィルタ

- `EntryTable.tsx` の `companyFlag`（企業対応）／`personFlag`（本人対応）dropdown は、`entryFlagDetail` が「本人辞退」系（`本人辞退` / `本人辞退_他社決` / `本人辞退_自社他`、`startsWith("本人辞退")` で判定）のとき、ラベルに「辞退」を含む選択肢のみ表示。それ以外のときは「辞退」を含む選択肢を非表示にする
- これは `COMPANY_FLAG_RULES` / `PERSON_FLAG_RULES`（`entry-flag-rules.ts`）のホワイトリストとは別レイヤーの**描画時フィルタ**。保存値・DB スキーマ・API は一切変更しない（filter は受信した options 配列を絞り込むだけ）
- 例外（常に表示）: 空文字／プレースホルダ option、行が現在保存している値（既存データ保護のため、フィルタ条件外でも消えない）
- 関連関数（EntryTable.tsx 内）: `isWithdrawalDetail` / `isWithdrawalOption` / `filterFlagOptions`
- 適用箇所: `renderCell()` 冒頭で `rawCompanyOptions`／`rawPersonOptions` を `filterFlagOptions(..., entry.entryFlagDetail, entry.companyFlag|personFlag)` に通してから `statusFlags` セルで描画
- 副作用: `書類選考` ステージは `COMPANY_FLAG_RULES` がもともと `["辞退報告前","辞退報告済"]` の辞退系のみのため、`entryFlagDetail` が本人辞退以外のとき企業対応 dropdown は空になり `-` 表示に縮退する（仕様通り）

---

## CandidateDetailPage.tsx

### 基本情報
- パス: `src/components/candidates/CandidateDetailPage.tsx`
- 行数: 1991+ 行（頻出修正対象、肥大化注意）
- 用途: 求職者詳細ページ全体（基本タブ + 面談履歴タブ）
- 親: `/app/(app)/candidates/[id]/page.tsx`

### 全体レイアウト

```
CandidateDetailPage
  ├─ TOP_VIEWS: [{key:"basic", label:"基本"}, {key:"interview", label:"面談履歴"}]
  ├─ activeView === "interview"
  │   └─ <InterviewHistoryTab candidateId currentUser />
  └─ activeView === "basic"
      ├─ <CandidateHeader ... />
      └─ サブタブバー (SUB_TABS) + 各タブコンテンツ
          - history → <HistoryTab>
          - documents → <DocumentsTab>
          - tasks → <CandidateTasksTab>
          - support → <SupportTab>
          - notes → <NotesTab>
```

### 主要 state（抜粋）

| state | 用途 |
|--|--|
| `candidate` | Candidate データ |
| `currentUser` | ログインユーザー |
| `activeView` | "basic" / "interview" タブ切替 |
| `activeTab` | basic 内のサブタブ（history / documents / tasks / support / notes） |
| `editModalOpen` | 基本情報編集モーダル |
| `mypageModalOpen` | 求人マイページ URL モーダル（インライン実装、L1777-1843）|
| `scheduleModalOpen` | 日程調整 URL モーダル（インライン実装、L1845-1961）|
| `googleFormModalOpen` | T-029 Phase D-2: Google フォーム作成モーダル |
| `meetingFiles` | T-029 Phase D-2: MEETING サブタブのファイル一覧（モーダル内ファイル選択用） |

### モーダル一覧

- `editModalOpen` → `<EditModal>` 別コンポーネント
- `mypageModalOpen` → インライン実装（求人マイページ URL 表示）
- `scheduleModalOpen` → インライン実装（日程調整 URL 生成）
- `showEndModal` → `<SupportEndModal>` 別コンポーネント
- `googleFormModalOpen` → `<GoogleFormCreatorModal>` 別コンポーネント（T-029 Phase D-2）
- `<InterviewUrlModal>` → CandidateHeader 経由で別コンポーネント

### 注意

CandidateDetailPage が 1991+ 行と肥大化しているため、新機能追加時は **必ず別コンポーネント化**する。
インラインモーダル実装（mypageModal / scheduleModal）が肥大化の主因。

---

## CandidateHeader.tsx

### 基本情報
- パス: `src/components/candidates/CandidateHeader.tsx`
- 用途: 求職者詳細ページのヘッダー領域（氏名、ID、生年月日、性別、住所、URL/資料ボタン群）
- 親: `CandidateDetailPage.tsx`

### Row 構成

| Row | 内容 |
|--|--|
| Row 1 | 求職者氏名 + ID + 登録日 + 担当者 |
| Row 2 | 生年月日 + 性別 + 連絡先 + 住所 |
| Row 3 | URL・資料ボタン群（求人マイページ / ガイドURL / 日程調整URL / 求人出力 / **Google フォーム作成**）|

### Row 3 の Props（T-029 Phase D-2 で追加）

```typescript
type Props = {
  // 既存 props
  onMypageOpen: () => void;
  onScheduleOpen: () => void;
  onJobOutput: () => void;
  hasGuideUrl: boolean;
  // ... 他

  // T-029 Phase D-2 追加
  onGoogleFormCreate?: () => void;
  googleFormDisabled?: boolean;
  googleFormDisabledReason?: string;  // tooltip 文言
};
```

### Row 3 のレイアウト

```tsx
<div className="px-6 pb-3">
  <div className="flex items-center gap-2 flex-wrap">
    <span className="text-[12px] text-gray-400 mr-1">URL・資料:</span>
    {/* 既存ボタン... */}
    {/* T-029 Phase D-2: 末尾に Google フォーム作成ボタン追加 */}
    <button
      onClick={onGoogleFormCreate}
      disabled={googleFormDisabled}
      title={googleFormDisabledReason}
      className="border border-gray-200 bg-white text-gray-600 rounded-md px-3 py-1 text-[12px] hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Google フォーム作成
    </button>
  </div>
</div>
```

---

## GoogleFormCreatorModal.tsx

### 基本情報
- パス: `src/components/candidates/GoogleFormCreatorModal.tsx`
- 用途: T-029 Phase D-2 で新規追加。AI Google フォーム自動生成モーダル
- 親: `CandidateDetailPage.tsx`

### Props

```typescript
type Props = {
  candidateId: string;          // Candidate.id (cuid)
  candidateNumber: string;      // 5004379 等
  candidateName: string;
  isOpen: boolean;
  onClose: () => void;
  meetingFiles: CandidateFile[]; // MEETING サブタブのファイル一覧
};
```

### 全体レイアウト（マルチステップモーダル）

```
モーダル本体（max-w-2xl, bg-white rounded-xl）
  ├─ ヘッダー: Google フォーム作成 + ステップインジケーター + ×
  ├─ Step 1 (idle): 入力フォーム
  │   ├─ PDF ラジオボタン（最新を初期選択）
  │   ├─ 面談ログ .txt ラジオボタン（最新を初期選択）
  │   ├─ 経験職種カテゴリ（大項目→サブカテゴリ 2 段階ドロップダウン）
  │   └─ [生成開始] ボタン
  ├─ Step 2 (processing): 進行中
  │   └─ 3 段階プログレスバー（解析 / 生成 / 作成）
  ├─ Step 3 (completed): 結果表示
  │   ├─ ✓ 作成完了
  │   ├─ 編集 URL（コピー + 「編集を開く ↗」）
  │   ├─ 回答用 URL（コピー）
  │   ├─ 保存状態表示（DB 保存済み or ブラウザ保持中）
  │   ├─ 作成日時表示（T-038、`googleFormCreatedAt` を JST 表示）
  │   └─ ボタン: [新しく作り直す（confirm）] / [閉じる]（T-038）
  └─ error 状態: エラー表示 + [再試行] / [初めからやり直す]
```

### URL 再表示機能（T-038 追加）

#### useEffect による open 時の既存 URL チェック

モーダル open 時に `/api/candidates/[candidateId]/interviews` を fetch し、`isLatest=true` レコードの `googleFormEditUrl` & `googleFormViewUrl` が両方存在すれば即 `setStep("completed")` + `setFormResult(...)` で完了画面にジャンプ。

#### 判定ロジック

URL の **存在有無** で判定する（`googleFormStatus` は補助情報、URL があれば status が null/未設定でも completed 扱い）。

#### 「新しく作り直す」ボタン

`handleStartFresh()` で `window.confirm()` 表示 → OK で `handleResetAll()` 呼び出し（idle にリセット）。
DB 上の既存 URL は残置されるが、新規作成完了時に `create-form/route.ts` L104-126 の update で上書きされる仕様（DB 整合性問題なし）。

#### state（T-038 追加分）

| state | 型 | 用途 |
|--|--|--|
| `hasCheckedExistingUrl` | `boolean` | open ごとに 1 回だけ fetch するためのフラグ。`isOpen` が false に戻ると初期化 |
| `formCreatedAt` | `string \| null` | フォーム作成日時（DB から取得 or 新規作成時に `new Date().toISOString()`）|

#### 内部型定義

```typescript
type InterviewRecordForGoogleForm = {
  id: string;
  isLatest: boolean;
  googleFormId: string | null;
  googleFormEditUrl: string | null;
  googleFormViewUrl: string | null;
  googleFormCreatedAt: string | null;
  googleFormStatus: string | null;
};
```

⚠️ `InterviewHistoryTab` 側の `InterviewRecord` 型（同名ファイル内別定義）は本タスクでは拡張せず、モーダル内ローカル型として独立。 API レスポンス自体には `include` のみで `googleForm*` カラム全て含有済（`/api/candidates/[candidateId]/interviews/route.ts`）。

⚠️ JST タイムゾーン罠（`12-pitfalls.md` #17）厳守: 日付抽出は `toLocaleDateString('sv-SE')`、時刻は `toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })`。`toISOString().slice(0,10)` 禁止。

### 主要 state

| state | 型 | 用途 |
|--|--|--|
| `step` | "idle" / "processing" / "selectCompany" / "completed" / "error" | ステップ状態（T-035 で `selectCompany` 追加）|
| `currentStage` | "extract" / "generate" / "create" / null | プログレスバー描画用 |
| `stageStatus` | { extract, generate, create: "pending" / "running" / "done" / "failed" } | 各段階の状態 |
| `selectedPdfFileId` / `selectedTxtFileId` | string \| null | ファイル選択 |
| `groupKey` / `categoryValue` / `otherLabel` | string | 経験職種カテゴリ選択 |
| `resumeData` / `questionsJson` / `formResult` | API 結果保持（リトライ時に再利用）|
| `interviewLogText` | string | extract-resume レスポンスから保持、generate-form で再送 |
| `hasCheckedExistingUrl` | boolean | T-038: 既存 URL チェック済みフラグ（open ごと 1 回 fetch）|
| `formCreatedAt` | string \| null | T-038: フォーム作成日時（DB or 新規作成時の Date）|

### selectCompany ステップ（T-035 追加）

extract 成功後、generate_form 呼出前に表示される会社別カテゴリ選択画面。

#### state

| state | 型 | 用途 |
|--|--|--|
| `companyCategoryMap` | `Record<string, string>` | キー=work_history 配列インデックス文字列、値=サブカテゴリコード（API payload に含める）|
| `companyGroupMap` | `Record<string, string>` | キー=同上、値=大項目キー（UI 内部状態のみ、payload 非含）|

#### 初期化タイミング

extract 成功直後に `initializeCompanyCategoryMap(workHistory, defaultGroupKey, defaultCategoryValue)` を呼び、全社にデフォルトカテゴリを適用。

#### UI 構造

各 work_history 要素にカードを動的生成:
- 会社名 + 在籍期間表示
- 大項目ドロップダウン（7 大項目から選択）
- サブカテゴリドロップダウン（大項目に応じて選択肢が変わる、大項目未選択時は disabled）
- デフォルトと異なる場合「変更済み」バッジ表示

#### 「質問生成 開始」ボタンの payload

`companyCategoryMap` を payload に追加し、portal API proxy 経由で candidate-intake へ転送。`achievementCategory` / `achievementCategoryOtherLabel` は既存仕様のまま維持。

#### バリデーション

`validateBeforeGenerate()` で全社のサブカテゴリ選択必須チェック、未選択あれば toast エラー。"other" 選択社がある場合は `achievementCategoryOtherLabel`（グローバル 1 つ）も必須。

#### 「戻る」ボタン挙動

`setStep("idle")` で Step 1 に戻る。companyCategoryMap / companyGroupMap は state に残す（編集内容を保護）。
ただし extract を再実行すると companyCategoryMap は再初期化される（work_history が変わる可能性のため）。

### 関連 API

- POST `/api/candidates/[candidateId]/google-form/extract-resume` (multipart 内部)
- POST `/api/candidates/[candidateId]/google-form/generate-form` (JSON)
- POST `/api/candidates/[candidateId]/google-form/create-form` (JSON、InterviewRecord 永続化込み)

### 既存「📝 面談登録 ↗」との関係

- 既存ボタン: `DocumentsTab.tsx:558-564` に残置中
- T-029 Phase C で削除予定（candidate-intake のフロント `/register` 削除と同時）

---

## このファイルの運用

頻出修正対象の UI コンポーネント（1000+ 行クラス）について、Phase 1 調査で得た構造情報を必ずここに反映する。同じ構造調査を毎回 Cursor で繰り返すのはプロジェクト化の趣旨に反する。

新規構造マップ追加時のテンプレ:
1. 基本情報（パス、行数、用途、親）
2. 全体レイアウト（ASCII 図）
3. 各セクションの構造
4. 主要 handler シグネチャ（特に引数形式）
5. 主要 state
6. 関連ファイル（API、モデル、共通スタイル等）

---

## ダッシュボード（src/app/(app)/page.tsx）— T-066 で 3 タブ化

### feature flag によるレイアウト分岐

- `DAILY_REPORT_ENABLED=false`（デフォルト）：従来の「左 SchedulePanel / 右 2 カラム（タスク・お知らせ）」をそのまま表示。
- `DAILY_REPORT_ENABLED=true`：3 タブ（「スケジュール（日報）」｜「タスク」｜「お知らせ」）。タブ切替のみ `DashboardTabs.tsx`（Client Component）。データ取得は Server Component のままで props 注入（R8）。

### タブの中身

- スケジュールタブ：`SchedulePanel`（既存 SSoT）＋ `DailyReportEntryButton`（「📝 日報を作る」）。右側に勤怠ミニカード／アラート。
- タスクタブ：旧「マイタスク」JSX をそのまま移植。
- お知らせタブ：旧「お知らせ」JSX をそのまま移植。

### DailyReportChatDrawer.tsx

- 右からスライドイン（ScheduleChatDrawer と同じパターン、幅 520px）。
- 上段：社員コメント入力欄（AI が日報を組み立てる素材）。
- 中段：AI 会話。
- 下段：「下書き保存」「確定」アクション。
- API：`/api/daily-report`（GET/POST）と `/api/daily-report/chat`（AI）。

### 注意

- ScheduleChatDrawer（プランニング）と DailyReportChatDrawer（日報生成）は別物。両者を流用しないこと。
- 「🌙 1日を振り返る」（ScheduleReviewDrawer）は既存どおり SchedulePanel 内に残り、その隣に日報導線が追加される。
