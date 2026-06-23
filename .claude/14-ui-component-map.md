# 14. UI コンポーネント構造マップ

頻出修正対象の UI コンポーネントの内部構造マップ。実装着手前にここで構造を把握し、毎回の Cursor 経由構造調査を削減する。

## 支援フラグの source of truth（T-080）

- 「フラグ」＝`Candidate.supportStatus`（テーブル `candidates.support_status`、デフォルト `"BEFORE"`）。**求職者単位**で1つ。面談単位ではない。
- 正規値定義：`src/lib/support-status-constants.ts` の `SUPPORT_STATUS_VALUES = ["BEFORE","ACTIVE","WAITING","ENDED","ARCHIVED"]`。表示ラベルは `SUPPORT_STATUS_LABEL`（BEFORE=支援前 / ACTIVE=支援中 / WAITING=待機 / ENDED=支援終了 / ARCHIVED=アーカイブ）。
- 中項目：`Candidate.supportSubStatus`（許可値は `SUPPORT_SUB_STATUS_MAP`）。`supportSubStatusManual=true` のとき手動上書き済みで、自動再計算ロジックは触らない。
- 自動再計算ヘルパ：`src/lib/support-sub-status.ts`
  - `calculateSubStatus(candidateId)`：JobEntry/CandidateFile から ACTIVE 時の中項目を自動判定（入社済/内定/面接/書類選考/エントリー/求人紹介/BM/求人紹介前）
  - `resetSubStatusForStatus(candidateId, supportStatus)`：大項目変更時に中項目を整合（ACTIVE は計算、それ以外は `SUPPORT_SUB_STATUS_DEFAULT[supportStatus]`）
  - `recalculateSubStatusIfAuto(candidateId)`：`supportStatus === "ACTIVE"` のときだけ supportSubStatus を再計算（エントリー操作等のトリガー）

## resultFlag → supportStatus 自動マッピング（T-080）

- **実装**: `src/lib/interview-result-to-status.ts`
- **マッピング表** `RESULT_FLAG_TO_SUPPORT_STATUS`：
  - 面談前 → BEFORE
  - 連絡なし辞退 / 連絡あり辞退 / 支援終了_当社判断 / 支援終了_本人希望 → ENDED
  - 求人紹介 送付前 / 求人紹介 送付済 / 継続 / 保留 → ACTIVE
  - マッピング表に無い値 / null → **何もしない**（誤上書き防止）
- **適用関数** `applyLatestInterviewResultToSupportStatus(candidateId)`：
  - 「最新面談」＝`interviewCount` 最大（NULLS LAST）、同数なら `interviewDate` 最新。既存 `isLatest`（面談日のみ）とは別判定軸。
  - 既に supportStatus が一致なら何もしない。
  - `supportSubStatusManual=true` なら supportSubStatus は触らない。それ以外は ACTIVE は `calculateSubStatus` で自動判定、BEFORE/ENDED は `SUPPORT_SUB_STATUS_DEFAULT` にリセット。
  - 例外は throw しない（保存処理本体を壊さないようログのみ）。
- **適用タイミング**（resultFlag が書き込まれる3保存パスすべての**直後**）:
  - `POST /api/interviews` (`src/app/api/interviews/route.ts`)：新規作成・コピー処理後
  - `PATCH /api/interviews/[id]` (`src/app/api/interviews/[id]/route.ts`)：body に `resultFlag` キーがあるときのみ
  - `PATCH /api/interviews/[id]/autosave` (`src/app/api/interviews/[id]/autosave/route.ts`)：body に `resultFlag` キーがあるときのみ。トランザクション外で実行
- `recalculateSubStatusIfAuto` との関係：競合しない。本ロジックは status 変更時に supportSubStatus も整合させるので、結果的に同じ ACTIVE 用 `calculateSubStatus` を内部呼出しする形になる。エントリー操作等の他トリガーから `recalculateSubStatusIfAuto` が後で呼ばれても、ACTIVE 時のみ subStatus を再計算するだけで衝突しない。

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
| `sortKeys` | `SortKey[]`（最大2、`SortKey = { basis: SortBasis; dir: "asc"\|"desc" }`） | 2段クロスソート（[0]=1次/[1]=2次）。旧 `sortField`/`sortDir`/`companyMode` を統合（T-099 で置換） |

### 主要 handler

| handler | シグネチャ | 用途 | 行 |
|--|--|--|--|
| `openAnalysis(e)` | `(e: React.MouseEvent) => void` | バッジクリック → モーダル open + セレクト初期値設定 | L1046 |
| `updateRatingMarker(axis, value)` | `(axis: "wish" \| "pass" \| "overall", value: string) => void` | セレクト変更 → テキスト内マーカー書換 + state 更新（T-055 追加） | 新規 |
| 保存ボタン onClick | inline | PATCH API → local state 更新（aiAnalysisComment + aiMatchRating） | L1334 |
| `fetchBookmarkRatings()` | 引数なし | 求人紹介タブ用に 3 軸評価 Map 構築 | L1775 |
| `parse3AxisRatings(comment)` | `(comment: string \| null) => { wish, pass, overall } \| null` | テキストから 3 軸パース（表示専用） | L365 |

### ブックマーク選択 / 出力済判定（T-095 追記）

- 選択 state: `selectedIds: Set<string>`（BookmarkSection 内、L416）。チェック済みファイル ID 集合。
- 「全選択」ハンドラ: `toggleAll`（L725〜732）。`filteredFiles` 全件 ID を ON/OFF トグル。チェックボックス UI は L916〜924。
- 出力済（緑バッジ「出力済」）の判定条件: **`file.lastExportedAt`（!= null）**（描画 L1073〜1078）。型は `BookmarkFile.lastExportedAt: string | null`（L269）。送信先は `lastExportedTo`（"circus" / それ以外は HITO-Link）。
- 「未出力を選択」（T-095 追加 → 追補でトグル式チェックボックス化）: 「全選択」の右横。`toggleAll` と同型のチェックボックス。ハンドラ `toggleUnexported`（未出力分 `filteredFiles.filter((f) => !f.lastExportedAt)` が全選択済みなら除外／未選択なら追加。出力済の選択状態は不変）+ `unexportedAllChecked`（未出力1件以上かつ全選択済みで checked）。判定は出力済（`file.lastExportedAt`）の逆。

### ブックマーク 2段クロスソート（T-099）

旧「会社名軸3択 ⊻ 列ヘッダー（排他・希望/通過/総合は内部AND）」を廃止し、最大2段（1次キー＋2次キー）のクロスソートに刷新。

- **キー配列の型**: `type SortBasis = "company_name"|"want"|"interest"|"wish"|"pass"|"overall"|"uploader"|"date"`、`type SortKey = { basis: SortBasis; dir: "asc"|"desc" }`。state は `sortKeys: SortKey[]`（[0]=1次, [1]=2次, 最大2）。
- **合成比較関数**: `makeCompositeComparator(sortKeys, getResponse)`（純関数, HistoryTab.tsx 上部）。1次 → 2次 → **確定タイブレーク（総合A優先 → 会社名昇順）** の順で評価。空配列でもタイブレークが効くため全キー解除時も安定整列。基準別比較は `compareByBasis`（want/interest は単方向で dir 無視・`responseRank` 流用、wish/pass/overall は `compareRank` で欠損は常に末尾、company_name/uploader/date は localeCompare/時刻×dir）。
- **昇格ロジック**: `activateBasis(basis)`（BookmarkSection 内）。現1次クリック→方向トグル（want/interest は `hasDirToggle=false` で無変化）／現2次クリック→1次へ昇格（現1次は2次へ・方向維持）／未選択クリック→1次（`defaultDir`：date のみ desc）・現1次を2次へ降格・現2次は破棄。`cycleKeyDir(basis)`＝そのキーの方向のみ変更（優先順位不変、2次もここで変更可）、`removeKey(basis)`＝解除（1次を消すと2次が繰上り）。
- **チップ UI の場所**: ツールバー（検索行の下）。「表示順：」行に会社名軸3択ボタン（名前順=company_name / 応募したい順=want / 気になる順=interest、各 active に次数バッジ）。その下に「並び替え：」チップバー（1次/2次・基準ラベル・▲▼方向トグル〔want/interest 非表示〕・✕解除）。列ヘッダー（希望/通過/総合/担当/紹介日）クリックでも `activateBasis`、`DirArrows`+`OrderBadge`（次数バッジ）表示。会社名ヘッダーはプレーン。
- 補助コンポーネント: `DirArrows`（方向▲▼）、`OrderBadge`（1/2次数バッジ）を HistoryTab.tsx 上部に追加。`SortIcon`（旧式）は Archived セクションが引き続き使用（未削除）。

### 求人紹介(Jobs)へのクロスソート移植＋共通化（T-100）

T-099 のBM比較・操作ロジックを **accessor 駆動に汎用化** し、BM・Jobs で共有（**BM の観測挙動は完全非回帰**）。

- **汎用比較**: `type SortAccessors<T> = { getCompanyName, getRank(x,axis), getResponse, getDate, getUploader? }`。`compareByBasis<T>(a,b,key,acc)` / `makeCompositeComparator<T>(sortKeys,acc)` がジェネリック化（HistoryTab.tsx 上部）。確定タイブレークは `acc.getRank(_,"overall")`→`acc.getCompanyName` で BM/Jobs 共通。
- **共有フック**: `useCrossSort(initial)` が `{ sortKeys, keyOf, degreeOf, activateBasis, cycleKeyDir, removeKey }` を返す。BM＝`useCrossSort([{basis:"date",dir:"desc"}])`、Jobs＝同初期値で **独立インスタンス**（`jobSortKeys` 等にリネーム束縛）。
- **共有UI部品**: `SortBasisButtons`（会社名軸3択）/ `SortChipBar`（並び替えチップ）を関数コンポーネント化し BM・Jobs 双方が使用。
- **Jobs の accessor**: `getCompanyName=job.company_name`、`getRank=findBookmarkRating(company_name)?.[axis]`（BM評価のクロス参照, `bookmarkRatings` Map）、`getResponse=job.candidate_response`（行に直接）、`getDate=job.created_at`。**担当(uploader)・DB列はソート対象外**（getUploader 省略, DB ヘッダー非クリック）。
- **Jobs state**: `jobSortKeys`（旧 `jobSortField`/`jobSortDir`/`handleJobSort` を置換廃止）。初期=紹介日降順。旧デフォルト（candidate_response 順）は廃止。UI は抽出結果ツールバー直下に `SortBasisButtons`+`SortChipBar`、列ヘッダー（希望/通過/総合/紹介日）が `jobActivateBasis` 参加＋`DirArrows`/`OrderBadge`。

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

### EntryTable: entryFlagDetail 別の企業対応／本人対応 選択肢制限（運用要件）

特定の `entryFlagDetail` 値のとき、企業対応／本人対応 dropdown の表示選択肢を絞る（描画のみ。保存値・API・スキーマは変更しない）。

| entryFlagDetail | 企業対応 | 本人対応 |
|--|--|--|
| `一次面接選考中` / `二次面接選考中` / `最終面接選考中` | `所感報告前` / `所感報告済`（2択） | `本人所感回収中` / `本人所感回収済`（2択） |
| `適性検査受講中` | `受講完了報告前` / `受講完了報告済`（2択） | `受講完了未確認` / `受講完了確認済`（2択） |
| `一次日程調整中` / `二次日程調整中` / `最終日程調整中` | **制限なし**（全選択肢） | `見送り通知未送信` / `見送り通知送信済` / `選考通過連絡前` / `日程回収中` / `日程回収済` / `日程通知前` / `日程通知済`（7択） |

- 上記以外の `entryFlagDetail` では従来どおり全選択肢を表示
- マップ各エントリの `company`/`person` は **片側のみ optional**。未定義の側は制限せず全選択肢
- 既存値の保護: 現在値が制限に含まれない場合は**現在値だけ残す**（書き換え・空欄化しない）
- 適用箇所（EntryTable.tsx）: `restrictByDetail()`（既存 `filterFlagOptions()` の後段で適用）
- 関連定数（EntryTable.tsx 内）: `DETAIL_FLAG_RESTRICTIONS`（entryFlagDetail → `{ company?, person? }` のマップ。verbatim 文字列）/ `PERSON_FLAGS_IN_SCHEDULING`（日程調整中の本人対応7値）
- 値の由来: `src/lib/constants/entry-flag-rules.ts` の `COMPANY_FLAG_RULES["面接"]` / `PERSON_FLAG_RULES["面接"]` および `EntryBoard.tsx` L227-229 の自動遷移と一致

### EntryTable: 内定/承諾フラグ選択時の日付自動入力（サーバ側）

- 操作: エントリーフラグを `内定` に選択 → `offerDate`（内定日）に JST 当日を自動入力
- 操作: フラグ詳細を `承諾` に選択 → `acceptanceDate`（承諾日）に JST 当日を自動入力
- **空欄時のみ入力。既存値は上書きしない**（手入力値を保護）
- 内定/承諾以外に戻しても既存日付は**消さない**
- 実装箇所: `src/app/api/entries/[entryId]/flags/route.ts` の PATCH。`prisma.jobEntry.findUnique` で現在の `offerDate`/`acceptanceDate` を確認し、null のときだけ `data` に追加
- 日付生成: `jstDateStringToDbDate(todayJstDateString())`（`src/lib/dailyReport/jstDate.ts`）。`todayJstDateString` は `toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })` で JST YYYY-MM-DD を取得し、`new Date("YYYY-MM-DDT00:00:00.000Z")` で UTC midnight Date に変換。他の日付フィールド（entryDate 等）の保存規約と同一。**`toISOString().slice(0,10)` は使わない**（罠 #17）

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

---

## PerformancePanel.tsx（実績表・T-071）

### 基本情報
- パス: `src/components/performance/PerformancePanel.tsx`（Client Component）
- 用途: ダッシュボードの**独立タブ「実績表」**で全幅表示する CA 実績表。FileMaker 形の週マトリクス＋5タブ。
- 配置: `page.tsx` の `performanceTab`（`<div className="w-full">`）として 2 番目のタブに配置。feature flag `DAILY_REPORT_ENABLED` 配下（4タブ表示時のみ）。
- **ダッシュボードのタブ構成（4タブ）**：**日報**｜**実績表**｜タスク｜お知らせ（`DashboardTabs.tsx`）。実績表は日報とタスクの間。
- 日報タブ（T-069①）＝`DailyReportView`（`src/components/dailyReport/DailyReportView.tsx`）。スケジュール編集（`SchedulePanel`：予定作成/AI/カレンダー同期）は折りたたみ `<details>` で温存（既存機能リグレッション防止）。勤怠も同タブ。

### DailyReportView.tsx（日報タブ・T-069①）
- パス: `src/components/dailyReport/DailyReportView.tsx`（Client）。前日/翌日ナビ＋`?date=YYYY-MM-DD` 連動（`history.replaceState`、②直リンクの土台）。
- データ源: `GET /api/daily-report?date=`（既存を拡張）→ `scheduleEntries`(当日予定)・`tomorrowEntries`(明日)・`scheduleSummary`(完了数)・`dayMatrix`(当日 `computeWeeklyMatrix`)・`attributes`(当日初回面談者の属性)・`report`(scheduleNote/metricsReflection)。
- **上段3列**: スケジュール予定｜実績（完了 N/M・消化率%）｜明日の予定。
  - **予定枠＝作成導線つき（T-069 移植）**：ヘッダに **＋追加（手動 `ScheduleEntryFormModal`）／✏️AI（`ScheduleChatDrawer`）／📅同期（`/api/schedule/[id]/sync-calendar`）** ＋ `CalendarConnectButton`。各エントリに編集/削除。schedule は `GET /api/schedule?date=` で取得（id＋entries）、未作成日は `POST /api/schedule`（空）で自動作成してから追加。既存モーダル/ドロワー/APIを**無改変で再利用**、日付は日報 `date` 連動。
  - **実績枠＝完了チェック（read-only解除）**：各エントリに完了トグル（`PATCH /api/schedule/entry/[id]/complete`・楽観更新）。消化率は `sched.entries` から算出。
  - 明日枠は read-only（`/api/daily-report` の `tomorrowEntries`）。
  - **旧・折りたたみ「スケジュールを編集」（`SchedulePanel`）は撤去**（手動/AI/同期/完了を上段に移植済み）。`SchedulePanel` 自体は flag-OFF レガシーレイアウト（page.tsx）で残存・不変。カレンダー同期の重複バグは別課題で未対応。
- **下段**: 左＝当日実績表（当月実績と同項目・当日値、合計行/決定は #FFF4E6）｜中＝`DailyCharts`（**縦棒4本（箱型・隙間ゼロ）**＝初回面談・既存面談(＝求人面談2回目+既存面談3回目以降)・紹介・エントリー（書類通過以降は日々頻繁でないため除外）。`barPercentage:1.0/categoryPercentage:1.0/borderWidth:1` で連続したバーに＋**円3種**＝当日初回面談者の ランク/男女比/年代（職種希望は実用不可のため非表示。属性集計APIには残置）｜右＝所感2欄（**気づき**＝「予定通りに行かなかった内容…」、**振り返り**＝当日数字、`flex-1 min-h-[180px]` で縦に拡大）。
- **コメント＝右アコーディオン＋ポップアップ（T-069②後）**：所感を画面下段から外し、**統合1本文 `reportBody`**（定型■1〜■6）に。入力は **右スライドのアコーディオン**（「📝 コメント入力」）＋ **中央モーダル**（「👁 コメント表示」、表示・編集可）。両方＋自動保存が **同じ `reportBody`（CA×日付1レコード・重複なし）** を更新。新規（本文空）でアコーディオンを開くと**定型文初期表示**（記入済みは保存内容、上書きしない）。
- **日報AIアシスト（T-069③）**：アコーディオン最下部のチャット入力 → `POST /api/daily-report/assist`（Claude `claude-sonnet-4-6`）。**日報skill（`src/skills/daily-report-advisor/SKILL.md`・`getDailyReportSkill`）＋ job-matching-advisor skill** を system 注入（cache_control: ephemeral）。当日集計（面談/紹介/エントリー/BM/選定率/支援中ACTIVE数）を**数字として渡す（AIに計算させない＝捏造防止）**。返り値 JSON `{ message, rewrittenBody(■1〜■6保持), advice(上司視点) }`。「本文に反映」で `rewrittenBody`→`reportBody`（`onBodyChange` 経由で自動保存＋未確定化）→ 確定→提出。会話は `DailyReportChat` に保存。旧 `/api/daily-report/chat`（aiBody用）は別物・不変。Gemini 不使用。
- **確定→提出制限**：「確定」で `commentConfirmedAt` セット。**確定済みでないと「提出」は disabled**（本文編集で未確定に戻る＝サーバが reportBody 編集時に commentConfirmedAt を NULL 化、提出も未確定なら 400）。
- **自動保存＋提出（T-069②）**：`reportBody` は**自動保存**（2.5秒 debounce＋日付移動/離脱前 keepalive、`dirtyRef`）。下書き保存ボタンなし。**右上に「提出」**（`status=SUBMITTED`・`submittedAt`、確定済みのみ）。**提出時のみ LINE WORKS 通知**（本文は `reportBody` を【コメント】ブロックで載せる）。POST の update は body 提供フィールドのみ反映（旧 comment/aiBody を潰さない）。
- **下段は2列**（コメント欄を外した分）：当日実績（`300px`・やや広く）｜グラフ（`1fr`・広く）。
- **求人検索グラフ（行動量＋精度）**：面談系縦棒の隣に **BM数(求人紹介数=createdAt当日)・出力数(提案数=lastExportedAt当日)** の縦棒（棒上に数値＝inline plugin `barValue` afterDatasetsDraw）。**選定率**を見出しに大きく表示（`(A+B+C)÷合計BM`、D・未評価除外）。**求人ABCD ドーナツ**＝当日BM の `aiMatchRating` 構成比（A/B/C/D/未評価）。母数は**紹介保留含む（archivedAt 条件なし）**。`/api/daily-report?date=` の `jobSearch{bmCount,exportCount,ratings,selectionRate}`（`computeJobSearchDay`・`uploadedByUserId`軸）。⚠️ 既存 metrics.ts の jobSearched/jobIntroduced（archivedAt=null）とは別集計（archivedAt=null だとDの77%が保留に逃げ選定率100%固定になるため、グラフ用は archivedAt 条件なし）。
- 所感保存: `POST /api/daily-report`（`scheduleNote`/`metricsReflection`、CA×日付＝`daily_reports` upsert）。日付移動で各日を再読込。
- 集計の数え方は実績表と共通（両ソース統合・ユニーク・MIN方式）。属性は `computeInterviewAttributes`（`src/lib/performance/attributes.ts`・monthly と共用）。Chart.js cdnjs・テーマ追従。CA 以外は当日実績/グラフ非表示（スケジュール・所感のみ）。
- 全幅レイアウト：旧・スケジュールタブ右半分への同居（窮屈）をやめ、独立タブで `w-full` のテーブル（`table className="w-full"`）として配置。フォント・余白を `text-[13px]` / `px-3 py-2.5` で広げて可読性を確保。横スクロールは原則発生しない（必要時のみ `overflow-x-auto`）。

#### Googleカレンダー連携UI（日報タブ・共通コンポーネント `CalendarConnectButton`）
新ダッシュボード（日報タブ）の Google カレンダー / ToDo 連携ボタンは `DailyReportView` のヘッダ直下（カレンダー連携バー・自分モードのみ表示）に配置。実体は `src/components/schedule/CalendarConnectButton.tsx`（`SchedulePanel` と共用）。

```
page.tsx (src/app/(app)/page.tsx)
├── isDailyReportEnabled() === true → DashboardTabs（日報｜実績表｜タスク｜お知らせ）
│   └── scheduleTab → DailyReportView (src/components/dailyReport/DailyReportView.tsx)
│       └── [L492-496] カレンダー連携バー（!viewMode のみ）
│           └── CalendarConnectButton (src/components/schedule/CalendarConnectButton.tsx)
│               ├── 未連携: button「🔗 Googleカレンダー / ToDo を連携」
│               │   └── onConnect → GET /api/calendar/auth → window.location.href = authUrl（OAuth 認可へ遷移）
│               └── 連携済: span「✅ Googleカレンダー / ToDo 連携中」
│                   ├── button「再認証」→ onConnect（同上 OAuth フロー再実行・スコープ更新用）
│                   └── button「解除」→ DELETE /api/calendar/disconnect → onDisconnect
└── isDailyReportEnabled() === false → 旧ダッシュボード
    └── SchedulePanel [L432-446] 同じ CalendarConnectButton（onConnect は同じ OAuth フロー）

OAuth フロー（lib/googleCalendar.ts getAuthUrl）:
  scope: calendar.events + tasks → Google 認可 → /api/calendar/callback → GoogleCalendarConnection upsert
  → リダイレクト /?calendar_connected=true（フロント側のメッセージ表示は未実装）
```

- **重要（T-069 移植時の注意）**: `onConnect` には必ず OAuth 認可フロー（`/api/calendar/auth` → `window.location.href = authUrl`）を渡す。`fetchCalendar()`（`/api/calendar/events` のイベント再取得）を渡すと連携ボタン・再認証ボタンが無反応になる（`08-bug-patterns.md` I-1）。未連携ユーザーのみ露呈するため見逃しやすい。

### 構成（T-071 FileMaker 形に作り替え。旧・期間ボタン式（日/週/月/3か月/半期/年/期間指定）は廃止）
- **ヘッダ**: 担当セレクト（`GET /api/performance/advisors`、初期=本人 `selfEmployeeId`）／**起算日ピッカー** `<input type="date">`（初期=今日 JST）／**粒度切替（週／月／半年）**（`GRANULARITIES`、cohort タブ時は disabled、初期=week）／🎯 目標登録ボタン（TargetModal）。
- **粒度切替（UIラベルと内部値の対応に注意）**：UI ラベル「週」=内部 `day`（起算日から5日・各列1日）、「月」=内部 `week`（5週）、「半年」=内部 `month`（起算月から6ヶ月）。**ボタン表示ラベルだけ付け替え、`granularity` 値と列生成ロジックの対応は不変**（`day=5日` がラベル「週」になるだけ）。`/api/performance/weekly` に `granularity` を付与し、列ヘッダ・列数（5 or 6）を動的描画。「直近6ヶ月」タブは粒度切替対象外（cohort 固定）。
- **右端3列**：合計｜平均｜達成率。合計＝TOTAL（目標｜実績、全期間再ユニーク。**当月実績タブのみ「目標｜実績｜%」**）。**平均＝TOTAL実績÷列数**（実績ベース、列数=5 or 6、行の fmt で書式）。達成率＝TOTAL実績÷TOTAL目標。
- **当月実績タブの合計列に転換率%（T-071 ③）**：**当月実績タブ（先頭タブ・`MONTHLY_ROWS`）の合計列のみ**に各段階の%を追加表示（人数ベース・当月通算）。**週列（1W〜5W）・平均列・達成率列には%を出さない**（週別の率は「率の窓問題」で意味を持たないため）。**マトリクス4詳細タブ（面談・紹介・エントリー・選考）には%を出さない**（スコープ外、現状維持）。
  - 率の定義は `Row.pct(m: WeeklyMatrix)`（行ごとに定義、`ratio(n, d)` で 0 除算は null＝「—」）。直近6ヶ月 COHORT_ROWS と同じパターン：
    - 面談行：sub（初回／求人(2回目)／既存(3回目以降)）＝**構成比 ÷合計面談**、**合計面談＝100%**（最上段、隣接段比なし）。
    - 紹介行：sub（初回提案／既存提案）＝**構成比 ÷合計提案**、**合計提案＝紹介率 ÷合計面談**。
    - エントリー行：sub（新規／既存）＝**構成比 ÷合計エントリー**、**合計エントリー＝エントリー率 ÷合計提案**。
    - 選考行：**書類通過率＝÷合計エントリー** / **内定率＝÷書類通過** / **決定率＝÷内定**（当月レンジ通算の隣接段比、コホート率ではない）。決定売上・売上単価は%なし。
  - 表示は合計セル内「目標｜実績｜%」（青字 `text-[#2563EB]` で `pctFmt`、左に区切り `｜`）。ヘッダのサブラベルは `rows.some(r => !!r.pct)` で条件分岐（当月実績タブ＝`目標｜実績｜%`、4詳細タブ＝`目標｜実績`）。
  - 算出値は `total.matrix` をそのまま使う（合計列が既に持つ当月レンジ通算ユニーク再集計値。週別の単純和ではない）。「率の窓問題」を回避しつつ当月のファネル形状が可視化される。
- **全員**：担当セレクトに「全員」（`employeeId=all`）。全CA合算（候補者ユニーク重複排除、目標なし）。
- **明細一覧**：マトリクスの下に対象候補者を全件表示（`DetailTable`、`GET /api/performance/detail`）。タブ連動で列を出し分け（`DETAIL_COLS`）。選考状況は **書類選考｜内定｜承諾 のサブタブ**（`selectionStage`）。見出しに「対象◯人／◯件」（summary.persons＝マトリクス人数と一致）。長い列（企業名・求人タイトル）は truncate。
- **FileMaker 風色付け（修正①）**：
  - ヘッダ行＝**ダークグレー `#3C3C3C`＋白文字**（マトリクス・明細・直近6ヶ月共通。サブ文字＝`#D1D5DB`）。`HEAD_CLS`/`SUBHEAD_CLS`。
  - 段階行色は**タブ別**：面談・選考＝色なし（合計面談は上罫線＋太字 `isTotal`）。求人紹介・エントリー＝人数行に薄青帯 `#EFF6FF`（`Row.band`）。
  - **合計列（TOTAL列）の特別背景色は撤去**（他列と同じ）。
- **明細はポップアップ化**：マトリクス下は「📋 明細を見る（◯人/◯件）」ボタンのみ。クリックで**モーダル**（`showDetail`、`max-w-[1400px]`、`thead` sticky、スクロール域 `max-h-[480px]`＝15行相当、ヘッダはダークグレー）。
  - **面談・選考タブは常に15行表示**（`DETAIL_FIXED_ROWS=15`、不足は空行、超過はスクロール）。**エントリーは行数固定しない**。
  - **求人タイトル列は約2倍幅**（`DetailCol.wide` → `max-w-[360px]`/`min-w-[300px]`）。
  - 選考サブタブ（書類選考｜内定｜承諾）はモーダルヘッダ内で**3つ均等幅**（`w-[360px]` の `flex-1`）。
- **直近6ヶ月（FileMaker 画像6 準拠に拡充）**：行＝初回/求人(2回目)/既存(3回目以降)/**合計面談**・初回/既存/**合計求人紹介**・新規/既存/**合計エントリー**・書類選考通過/内定数/決定数・決定売上(粗利)/売上単価。各月 **実績(人数)＋%**（人数のみ、件数・1人当たりは出さない）。
  - %の定義：面談/提案/エントリー sub＝**構成比**（÷各合計、合計=100%）。書類通過/内定/決定＝**コホート隣接転換率**（書類通過÷コホートエントリー・内定÷書類通過・決定÷内定）。決定売上/単価＝数値のみ（%なし）。
  - 帯色：合計行・売上系＝オレンジ `#FFF4E6`。cohort API（`/api/performance/cohort`）が拡充項目を返す（面談/提案/エントリーは `computeWeeklyMatrix` 月レンジ、選考は cohort funnel）。母集団定義（その月エントリー候補者追跡）は不変。
  - **レイアウト**：各月セルは**実績｜% の2列横並び**（縦積みをやめ行高縮小）。thead 2段（1段目＝月 colSpan=2、2段目＝実績/%）、`Fragment` で月ごとに2 td。
  - **幅バランス**：`table w-full` ＋ `table-layout:fixed` ＋ `<colgroup>`。段階列＝`<col width:190px>`（最長項目名「売上単価（1人当単価）」が折り返さず収まる）、月12列（各月 実績/% の2 col）は**残り幅を均等配分**（width 未指定で fixed が等分）。間延びなく全幅を使う。
  - **合計列・平均列（T-071 ③）**：月6列の右に**合計**（実績｜%）・**平均**（実績｜%）を追加。**達成率列は作らない**（マトリクス4タブのみ）。
    - **合計の人数系**（面談/紹介/エントリー各種・書類通過・内定・決定）＝**6ヶ月通算の候補者ユニーク人数**（cohort API が6ヶ月全期間で再集計：人数は `computeWeeklyMatrix`、選考は cohort funnel SQL を6ヶ月レンジで再実行。COUNT DISTINCT）。月別の単純和ではない（複数月にまたがる候補者は1人）。
    - **合計の件数系・売上**＝各月の単純加算（決定売上＝粗利は単純合計）。
    - **合計の率**＝6ヶ月通算コホート率（隣接段比、通算ユニーク人数で算出）。売上単価＝6ヶ月通算売上 ÷ 6ヶ月通算決定人数。
    - **平均**＝**各月実績の÷6固定平均**（当月含む6ヶ月の月平均、月の実態に近い）。**合計のユニークと平均の分子が別計算**になることを許容（合意済み・仕様）。
    - **平均の率**＝**平均人数の隣接段比**（`avg(dp)/avg(cohort_base)` 等。cohort 0 月の null 扱いを単純化、月の実態に近い）。
    - ヘッダは合計＝左罫線太め（`border-l-2 border-[#9CA3AF]`）、平均＝左罫線細め（`border-l border-[#5A5A5A]`）。色は `HEAD_CLS`/`SUBHEAD_CLS` 統一。平均セルの数値は小数1桁、合計セルは整数。
- **6タブ**: **当月実績**｜面談実績｜求人紹介実績｜エントリー実績｜選考状況｜直近6ヶ月（当月実績が先頭・既定タブ）。
- **当月実績タブ（T-071②）**: `GET /api/performance/monthly?employeeId=&anchorDate=`。当月（anchorDate の月）を **1日起算で週分割（月内クランプ、`weeklyBusinessDays`：W1=1日〜最初の日曜、以降 月〜日、4〜6週）**。
  - 上段＝週別表：列＝1W〜（4-6）W｜合計｜平均｜達成率、行＝直近6ヶ月と同項目（人数のみ＝`MONTHLY_ROWS`）。`WeekMatrixTable` を流用（レスポンスは weekly 互換 columns/total）。集計は `computeWeeklyMatrix`（両ソース統合・MIN方式の初回/既存）。目標は当月 PerformanceTarget を週按分（initial面談・提案・エントリーのみ、書類通過以降は週按分せず「—」＝T-073方針）。達成率＝当月通算実績÷月目標。
  - **行色ルール（直近6ヶ月と統一）**：`Row.band` を `boolean | "orange"` に拡張。**合計面談・合計提案・合計エントリー・決定の4行のみ `band: "orange"`（#FFF4E6）**で強調、他は白。`band: true`（#EFF6FF・薄青）は既存4タブ（面談/提案/エントリー/選考）で維持。
  - 下段グラフ（`MonthlyCharts`・Chart.js）：**折れ線**＝週別 面談/紹介/エントリー数の推移（面談タブの折れ線と同スタイル、面談=青/紹介=緑/エントリー=オレンジ）＋ **円4種**＝当月初回面談者の ランク／男女比／**職種希望（第1希望大分類）**／年齢層。
  - **属性の母集団＝当月の初回面談（`interview_count=1`・辞退系除外・担当軸 candidate.employeeId）**。ランク＝`overall_rank`、性別＝`candidate.gender`、**職種希望＝`interview_details.desired_job_types[0]->>'large'`（candidate.desiredJobType1 は充足率21%で使わない・面談詳細JSONの大分類73%を使う）**、年齢層＝`candidate.birthday`→AGE を6バンド＋不明。各円に「未設定/未評価/不明」スライスを含む。4種とも母数＝初回面談数。
- **タブ・目標登録ボタンの幅統一**：実績表ヘッダの全タブ（当月実績〜直近6ヶ月）と「🎯 目標登録」ボタンを `w-[112px] text-center` で固定幅（「エントリー実績」基準の均一）。
- **面談タブのグラフ（常設・面談実績タブのみ）**: マトリクス下に Chart.js（cdnjs UMD `4.4.1`）で**左＝折れ線・右＝円**を横並び常設（明細はボタン→ポップアップのまま）。
  - 折れ線＝面談数推移（初回=青/求人(2回目)=緑/既存(3回目〜)=オレンジ）、横軸＝**粒度連動の列ラベル**（`weekly.columns[].matrix.interview`）。
  - 円（ドーナツ）＝**初回面談のランク割合**（`overallRank`：A+/A/B+/B/C/D＋未評価）。`weekly.total.interviewRanks`（`computeInterviewRankBreakdown` で `interview_count = 1` に絞る、合計＝初回面談数 = `interview.first`）。S は存在しない。目的：その期間に新規で会った人の質（ランク）の分布。求人/既存（2回目以降）は再面談で評価が重複するため除外。
  - 軸/凡例色は canvas の `getComputedStyle().color`（テーマ追従）、グリッドは半透明グレー（ダーク/ライト両対応）。`InterviewCharts` コンポーネント、`loadChartJs()` で script を一度だけ注入。他タブには出さない。
- **面談明細にランク列**追加（`InterviewRating.overallRank`、detail API で `rating.overallRank` を select）。
- **週マトリクス（4タブ）**: `GET /api/performance/weekly?employeeId=&anchorDate=`。列＝W1〜W5（各「目標｜実績」、ヘッダに日付範囲）＋ TOTAL（目標｜実績）＋ 達成率。
  - 行（段階）は `ROWS` 定数で定義（tab → Row[]）。`Row.actual(matrix)` で実績抽出、`Row.targetKey` があれば目標＋達成率表示、`Row.fmt` で書式（1人当たりは小数1桁、決定売上/単価は ¥）。
  - 面談実績＝初回/求人面談(2回目)/既存(3回目以降)/合計。求人紹介・エントリー＝新規/既存/合計 × 人数・件数・1人当たり（件数÷人数）。選考状況＝書類通過/内定/承諾（人数）＋決定売上/決定単価（`revenue` 集計）。
  - **率（段階間転換率）は週マトリクスでは出さない**（人数・件数・達成率のみ）。TOTAL はユニーク再集計値（週別合計ではない）。目標未登録・未到来は「—」。
- **直近6ヶ月（1タブ）**: `GET /api/performance/cohort?employeeId=&months=6`。月別（6ヶ月前〜前月、当月含まない）に各段階の人数＋**コホート率**（前段が分母、月をまたいで追跡）。人数の下に率を縦に重ねて表示。
- タブ切替で weekly / cohort を出し分け。担当・起算日・タブ変更で再フェッチ。横スクロール許容（`overflow-x-auto`, `min-w`）。

### Server/Client 構成
- page.tsx の Server Component は触らず（R8 維持）、PerformancePanel 内で `useEffect`+fetch。

### 関連
- API: `src/app/api/performance/weekly/route.ts`（週マトリクス）, `cohort/route.ts`（コホート）, `advisors/route.ts`（CA一覧）, `target/`（T-073）。`/api/performance`（旧6期間）は残置だが UI からは未使用。
- 集計: `src/lib/performance/weeklyMatrix.ts:computeWeeklyMatrix`（raw SQL・新規/既存・件数/人数）、`src/lib/performance/fiveWeeks.ts:splitIntoFiveWeeks`、`src/lib/dailyReport/metrics.ts:computeCaMetricsForRange`（数え方の正本、変更なし）
- 詳細仕様は `03-portal-spec.md`「T-071: 実績表機能」参照

### TargetModal.tsx（目標設定ポップアップ・T-073）

- パス: `src/components/performance/TargetModal.tsx`（Client Component）
- 入口: PerformancePanel ヘッダの「🎯 目標登録」ボタン（担当セレクト横）。`employeeId` 未選択時は disabled。初期対象月は今月（JST）。
- レイアウト（大型モーダル `max-w-[1320px]`、**1つの横並び統合表**）:
  - 列：`段階 | 参考値[昨年同月｜前月｜3か月｜半年] | 目標 | 週按分[W1..Wn｜月計]`（`table-layout:fixed` ＋ `<colgroup>` で段階列のみ132px固定・数値列は均等幅）。ヘッダはダークグレー `#3C3C3C`＋白（実績表と統一）、2段（参考値/週按分は colSpan、目標は rowSpan2）。
  - **各段階は実数値の行＋率の行**：実数値（人数）の真下にインデント薄字「○○率」。参考値・目標・週按分すべての列で縦に揃う。
  - **参考値**（`GET /api/performance/target/reference` 4期間）：数値の行＝実績数、率の行＝前段転換率（%）。
  - **面談は初回/既存/合計の3行＋構成比**（参考値側）：初回（first）／既存（second+thirdPlus）／合計（total）。各行に「人数（÷合計面談 の構成比）」を表示。初回面談率（実施率）は廃止。reference API は `interviewExisting`/`interviewTotal` を返す。
  - **逆算の面談＝合計面談が母数**（T-073）：`reverseCalc` の面談段＝`紹介÷紹介率＝totalInterviewCount`（紹介率は紹介÷合計面談に統一済み）。面談行の並びは **合計面談（逆算・週按分対象）→ 初回面談率（内訳・%手入力 `firstInterviewRatio`／kind="fipct"）→ 初回面談（=合計×初回%）→ 既存面談（=合計×(1-初回%)）**。初回/既存は内訳で逆算非影響。保存は **interviewCount＝初回面談**（達成率は初回実績と比較するため）・**existingInterviewCount＝既存**・**firstInterviewRatio＝初回%(0〜1)**。週按分は合計面談（旧・初回面談→合計に変更）。`firstInterviewRatio` は nullable カラム（migration `20260608140000_t073_first_interview_ratio`・冪等）。複数%入力（紹介率・1人あたり件数・初回%）が確定して初めて保存可（complete に ratioValid 追加）。
  - **各週の内訳・率表示（Phase B）**：週按分（W1〜Wn）の各週に、初回面談＝合計面談の週按分(`allocateToWeeks`)×初回%・既存面談＝同×(1-初回%) を表示（各週 初回+既存=合計面談の按分値）。1人あたり件数・紹介率は月固定値を各週に表示。`funnelRows` の行に `weekText(i)`/`monthText`（empty 行でも週/月計に値を出す）を追加。
  - **週按分の手動調整（Phase C）**：**初回面談・既存面談の各週セルのみ手入力可**（`weekInput`＝input。合計面談・紹介・エントリーは input にしない）。各週の実効値＝手動値(`ovFirst`/`ovExisting` state)があればそれ、無ければ自動配分。**合計面談（各週）＝初回+既存で自動更新**（`effTotal`・直接編集不可）。超過＝手動時のみ、初回+既存の週合計(`sumTotalIv`)>月の合計面談目標で赤＋アラート＋**保存ブロック**（`ivOver` を save `disabled` に追加）。「自動配分に戻す」(`resetWeekly`)で override 破棄。保存は **`weeklyOverrides Json?`**（`{firstInterview:[...], existingInterview:[...]}`、未調整週 null。全週未調整なら `Prisma.JsonNull`）。migration `20260608180000_t073_weekly_overrides`（JSONB・nullable・冪等）。読込時 週数一致で復元・違えば自動。**実績表(weekly/route)・達成率は月目標ベースのまま不変**（手動週値を参照しない）。初回%(firstInterviewRatio・月固定)とは別物。
  - **売上単価（決定単価）の参考値（Phase A）**：参考値テーブルに「売上単価（決定単価）」行を追加。参考値＝実績の決定売上÷決定数（reference API が `matrix.selection.decidedUnitPrice` を返す。売上未記録期間は「—」）。目標セル＝上部で手入力した売上単価（`targetText` で ¥ 表示）。
  - **目標**：数値の行＝`reverseCalc` の逆算人数（自動・青字）、率の行＝率%手入力欄。
  - **紹介は3段**：紹介（人数）＝逆算自動／紹介率＝%手入力／**1人あたり件数＝件数手入力（新規、`proposalPerPerson`）**／**紹介（件数）＝紹介人数×1人あたり件数の自動算出（青字）**。1人あたり件数の参考値は実績の提案1人当たり（reference API が `computeWeeklyMatrix.proposal.total.perPerson` を返す）。
  - **週按分**：**初回面談・紹介（人数・件数）・エントリーのみ**（各週切り上げ・最終週帳尻・月計＝合計）。**書類通過・内定・承諾はタイミングが読めないため週按分しない（W列・月計とも「—」）**。率・係数の行は空（按分対象外）。
  - 売上・単価入力は表の上部にまとめて配置（逆算の起点）。すべてカンマ区切り表示（`toLocaleString("ja-JP")`、入力欄も `commaInt`/`onlyDigits` で3桁区切り）。
  - `proposalPerPerson` は PerformanceTarget の nullable カラム（紹介件数は人数×係数で再算出可のため係数のみ保存）。`isComplete`（達成率の対象＝人数）は不変、紹介件数は実績表の達成率には影響しない。
- 保存: `POST /api/performance/target`（upsert）。`isComplete` で全段階数が確定したときのみ保存可。既存目標は開いたとき読み込んで編集（率は % に戻して表示）。
- ヘッダの `<input type="month">` で対象月を切替（参考値・既存目標を再取得）。
- 計算ロジック: `src/lib/performance/reverseCalc.ts`（逆算）、`src/lib/performance/businessDays.ts`（営業日・週按分、`@holiday-jp/holiday_jp` で祝日除外）。
- 詳細仕様は `03-portal-spec.md`「T-073: 目標設定機能」参照

## /admin/users/[id]（社員詳細・T-096、2026-06-10）

- page.tsx（Server Component・約180行）: admin 403ガード → prisma.employee.findUnique（userId={id}、bankAccount/insurance/salary/equipment/dependents/leaveRequests(desc,200件) include）→ 日付を "YYYY-MM-DD" 化・PWを有無boolean化して EmployeeDetailClient へ。todayJst も props 渡し
- EmployeeDetailClient.tsx（約250行）: Employee未登録時は社員番号入力→POST /api/admin/employees。登録済みならヘッダー（社員番号/氏名/生年月日+年齢/性別/在籍状態/入社日/退社日/在籍年数）＋6タブ切替
- タブ:
  - BasicInfoTab（基本情報＋連絡先＋緊急連絡先、年齢・在籍年数リアルタイム計算）
  - BankAccountTab（口座）
  - InsuranceTab（雇用保険・社会保険・扶養の3ブロック＋DependentsSection 1:N行編集）
  - SalaryTab（支給総額リアルタイム自動合計）
  - EquipmentTab（PasswordField: マスク→「表示」クリックで /secrets fetch、空入力=変更しない）
  - LeaveTab（残日数編集は既存勤怠API、履歴は閲覧のみ）
- 共有: detail-types.ts（型＋calcAge/calcTenure/patchEmployeeSection）、detail-ui.tsx（FormField等）
- 主要handler: 各タブ handleSave → PATCH /api/admin/employees/[employeeId] {section, data} → router.refresh()
- 一覧 UserListClient.tsx の操作列に「詳細」リンク（/admin/users/[u.id]）を追加（既存挙動無変更）

## 社員詳細 自動補完（T-097, 2026-06-11）

- BankAccountTab: bankCode 4桁到達/onBlur → GET banks/[code] → setForm bankName。branchCode 3桁到達/onBlur → GET banks/[code]/branches/[branchCode] → setForm branchName。404時は既存値を消さない
- BasicInfoTab 連絡先: 郵便番号フィールド（住所の前）。7桁到達/onBlur → GET postal-code/[code]。1件=自動入力 / 複数=住所欄下のドロップダウン選択 / 0件=何もしない。補完後も手入力上書き可
- 共有 TextInput(detail-ui.tsx) に onBlur prop

## 社員詳細 AI仮入力（T-098＋追補: 全画面D&D, 2026-06-11）

- 各タブの個別ボタン（T-098）: detail-ui.tsx の ResumeAiButton ＋ useResumeAiFill(employeeId, setForm, allowedKeys)。単一ファイル・自タブのみ・空欄マージ
- 全画面D&D（追補）: EmployeeDetailClient が document レベルで dragenter/over/leave/drop（カウンタでチラつき防止）、ドラッグ中/解析中はfixed全画面オーバーレイ。Employee未登録ブランチは無効
  - 解析結果は親 state aiFillData（新参照=新ドロップ）として 基本情報/社会保険/口座 タブへ配布
  - 配布マージ useAiFillData(aiFillData, setForm, allowedKeys): aiFillData参照変化時＋タブのマウント時に1回だけ空欄マージ（後から開いたタブも埋まる）、同一参照は再マージしない(appliedRef)
- 共通マージ: resume-ai-merge.ts の mergeEmptyOnly（ボタン経路・D&D経路の両方が使用）
- タブ別 allowedKeys: Basic=name/furigana/birthday/gender/postalCode/address/phone/emergencyContact{Name,Relation,Phone}、Insurance=pensionNumber/employmentInsuranceNumber、Bank=bankName/bankCode/branchName/branchCode/accountType/accountNumber/accountHolderKana

---

## 一覧画面マップ: 面談一覧 / 求職者管理一覧（T-101, 2026-06-23）

両一覧に「応募日 / 配信日 / 経路（媒体）」の表示列＋検索を追加した際に把握した構造マップ。
**3項目の連携元は全て `Candidate` 直持ち**（`applicationDate` / `scoutDeliveryDate` / `mediaSource`）。join 不要・求職者1人1件（T-091手入力欄）。詳細は `02-data-sources.md` 参照。

### 画面A: 面談管理一覧 InterviewListClient

- パス: `src/app/(app)/admin/interviews/InterviewListClient.tsx`（クライアント）/ ページ `src/app/(app)/admin/interviews/page.tsx`
- 取得元: **`GET /api/interviews`**（`src/app/api/interviews/route.ts`）。`page/pageSize` でサーバページネーション（PAGE_SIZE=30）。行型 `InterviewRow`（候補は `r.candidate.*` にネスト）。
- フィルタの二層構造（重要）:
  - **サーバ側**（API query へ送る）: rcName / caName / dateFrom/To（面談日）/ candidateName / search
  - **クライアント側**（`displayedInterviews = interviews.filter(...)`, T-068 由来）: typeFilter / toolFilter、**＋T-101 で応募日範囲 / 配信日範囲 / 経路(媒体) を追加**。件数サマリ（新規/既存●件）もこの `displayedInterviews` から算出するため自動連動。
  - ⚠️ クライアント側フィルタは現在ページの30件のみが対象（T-068踏襲の既知の制約）。
- 列構成（T-101後, COL_WIDTHS=15要素）: 操作 → **応募日/配信日** → **経路** → 担当RC → 担当CA → 面談日 → 開始/終了 → 回数/結果 → 求職者氏名 → 年齢/性別 → 電話 → メール/住所 → 転職時期/評価 → 希望都道府県 → 第一希望職種。新2列は「操作の右・担当RC の左」。colSpan（loading/空）=15。

### 画面B: 求職者管理一覧 CandidateListClient

- パス: `src/app/(app)/admin/master/CandidateListClient.tsx`（クライアント）/ ページ `src/app/(app)/admin/master/page.tsx`（server component, `serialized` で行整形）
- 取得元: 初期は page.tsx の SSR（`prisma.candidate.findMany` → `serialized`）。リフレッシュ時のみ **`GET /api/master/candidates?include=employee`**（`...c` 全フィールド spread のため Date は ISO 文字列で返る）。**全件クライアント保持・全フィルタがクライアント側**（`filtered` useMemo）。
- 行型 `CandidateRow`。T-101 で `applicationDate` / `scoutDeliveryDate` を追加（`mediaSource`/`applicationRoute`/`recruiterName` は T-064 で既存）。page.tsx の `serialized` にも両日付を `toISOString()` で追加すること（SSR初期表示用）。
- フィルタ: 支援タブ / フリー検索 / 担当CA / 登録日範囲 / 性別 / 終了理由 / 経路(applicationRoute=スカウト/応募) / 媒体(mediaSource) ＝ T-064既存。**T-101 で応募日範囲 / 配信日範囲を追加**。クリアボタン条件＆ハンドラに新state追加。
  - ⚠️ 用語衝突注意: 画面Bの既存「経路」フィルタは `applicationRoute`（スカウト/応募）。T-101の「経路」列は **媒体名 `mediaSource`** を表示（タスク定義の経路＝媒体名）。媒体プルダウンは既存を流用したため追加せず、列表示のみ追加。
- 列構成（T-101後, colgroup=12列）: ☑ → 求職者番号 → 氏名 → フリガナ → 性別 → 担当CA → **応募日/配信日** → **経路** → 担当RC → 登録日時 → 支援状況 → ステータス。新2列は「担当CA の右・担当RC の左」。空 colSpan=12。

### 共通実装（罠#17 / JST）

- 日付は必ず `Asia/Tokyo` 基準で文字列化。両ファイルにヘルパ `jstDateStr(iso)`（`toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"})` → `YYYY-MM-DD`、比較・範囲境界用）と `fmtJstSlash(iso)`（表示用 `YYYY/MM/DD`、null は "-"）を定義。
- 範囲フィルタは JST 日付文字列の辞書順比較（`d >= from` / `d <= to`）。日付が無い行は範囲指定時に除外（登録日範囲の既存挙動と同じ通常フィルタ意味論）。`toISOString().slice(0,10)` / `getDay()` は使わない。
- 応募/配信セルは「面談日」セル同様の上下2段（上=応募日, 下=配信日, 11px グレー）。経路セルは1行 truncate。

### 担当RC 列の表示ソース（T-102, 2026-06-23）

両一覧の「担当RC」列は **スカウト配信担当 = `Candidate.recruiterName`** を表示する（号機表記は表示時のみ `formatRecruiterName`（`src/lib/recruiterDisplay.ts`, 91d28ed）で実名変換。空文字/NULL は「-」）。

- **画面B（CandidateListClient）**: 91d28ed の時点で既に `formatRecruiterName(cand.recruiterName) || "-"` を表示。T-102 で変更なし（既に正しい）。
- **画面A（InterviewListClient）**: T-102 で修正。**旧実装は `r.interviewer`（面談者＝登録者アカウント）を表示しており誤り**だった。`r.candidate.recruiterName` を `formatRecruiterName` 経由で表示するよう差し替え（`/api/interviews` の candidate select に `recruiterName: true` を追加）。
  - `interviewer` フィールド自体は型・API select で引き続き保持（削除不可。将来用）。
- `formatRecruiterName` は **VIEW-ONLY**。保存値・集計キー・突合キーには使わない（号機表記のまま扱う）。

#### 面談一覧 担当RC のソート/フィルタ基準（T-102追補, 2026-06-23）

担当RC のソート（`rcName` ヘッダ）と左の絞り込み入力（`rcName`）を **表示値（号機→実名変換後）基準** に揃えた。表示・ソート・絞り込みの3つが配信担当の実名で一致する。

- **クライアント側は無変更**。`InterviewListClient` は従来どおり `sortBy=rcName` / `rcName` パラメータを `/api/interviews` に送るのみ。
- **サーバ側（`/api/interviews` GET）で実装**（面談一覧は **サーバページング**＝全件がクライアントに来ないため client 側では大域整合が取れない）。Prisma の `orderBy`/`where` では JS 変換（`formatRecruiterName`）を表現できないため、`rcName` が絞り込み指定 **または** `sortBy==="rcName"` のときだけ専用パスに分岐:
  1. `where`（rcName 以外の既存条件）に一致する全行を取得（`select` は `interviewSelect` 定数に抽出し通常パスと共有）
  2. 絞り込み: `normalizeRecruiterName(formatRecruiterName(recruiterName)).includes(normalizeRecruiterName(入力))` で表示値と部分一致（表記揺れは正規化で吸収）
  3. ソート: `formatRecruiterName(recruiterName)` を `localeCompare(_, "ja")`。**空（一覧「-」）は昇順/降順に関わらず末尾**
  4. `total = 絞込後件数`、`slice` でページング
  - それ以外の列（interviewDate / caName 等）は従来どおり `orderBy + skip/take + count` の高速パスで**完全非変更**。
- **正規化の単一集約**: `src/lib/recruiterDisplay.ts` に `normalizeRecruiterName()`（全角数字→半角・空白除去の比較用）を追加し、`formatRecruiterName` も内部でこれを使用。号機↔実名の対応表（`MACHINE_NUMBER_TO_REAL_NAME`）は1か所のまま。サーバ/クライアント双方がこの1モジュールを import（`recruiterDisplay.ts` は pure で server-import 可、既に scout 配下の server component が使用）。
- 担当CA のソート/絞り込み・件数サマリ・他列は非変更。

#### 担当RC 表示形式「実名(RPA○号機)」＋エントリー管理への適用（T-104, 2026-06-24）

- **表示形式変更（単一集約）**: `src/lib/recruiterDisplay.ts` の `MACHINE_NUMBER_TO_REAL_NAME` の値を **「実名(RPA○号機)」** に変更（例 1号機→`藤本 なつみ(RPA1号機)`、4号機→`上原 千遥(RPA4号機)`、6号機→`安藤 嘉富(RPA6号機)`）。`formatRecruiterName` のマッチ/正規化ロジックは不変。号機表記でない実名（藤本 夏海・大野 望 等）は変換せずそのまま、空は「-」。
- 出力に号機表記も含むため、面談一覧の担当RC絞り込みは **実名部分（「上原」「岡田」）でも号機部分（「4号機」「RPA4」）でも部分一致でヒット**（`normalizeRecruiterName(formatRecruiterName(...))` 経由）。ソートも新表示値（実名先頭）基準で機能・空は末尾。`formatRecruiterName` は冪等的（出力を再投入しても同値）なので二重適用しても壊れない。
- **3画面の担当RC は全て `formatRecruiterName` 経由**:
  - 求職者管理一覧（CandidateListClient）・面談管理一覧（InterviewListClient）: 既に経由済み → lib 変更が自動反映。
  - **エントリー管理（`src/components/entries/EntryTable.tsx`）: T-104 で担当RC列を新規追加**（担当CA の右）。`COMMON_COLS` に `{ key:"rc", label:"担当RC", sortKey:"rc" }`、`getFieldValue` と `renderCell` に `rc` ケース（`formatRecruiterName(entry.candidate.recruiterName)`）。データは `Entry.candidate.recruiterName`（`/api/entries` の candidate select に `recruiterName: true` 追加、`EntryBoard.tsx` の `Entry` 型に `recruiterName?: string | null` 追加）。エントリー一覧のソートは `applySortAndGroup` によるクライアント側（`handleSort` は再フェッチせず state のみ）なので担当RC列ソートも client 側で表示値基準・空は末尾。
- 同 lib を使う他画面（`scout/by-media`・`by-sent`・`ScoutLinkPanel`・`CandidateHeader`）も新表示形式に追従（VIEW専用なので集計/突合キーには影響なし）。

## prefill=offer-acceptance 導線（内定承諾報告タスク, master 6d8433b, 2026-06-23）

エントリーの内定承諾を起点に `/tasks/new` の内定承諾報告テンプレートへ値をプリセットして遷移する導線。

- 起点（`src/components/entries/EntryBoard.tsx`）: `maybeOfferAcceptancePrompt(entry, flags)`（`handleFlagUpdate` の PATCH 成功後に呼出、`flags.entryFlagDetail==="承諾" && entry.entryFlag==="内定"` で発火）→ state `offerAcceptEntry` に対象を入れ確認モーダルを表示（`TaskSyncConfirmDialog` 直後にレンダ）。「作成する」で `goToOfferAcceptanceTask(entry)` が `window.location.href = /tasks/new?prefill=offer-acceptance&...`（日付は JST/sv-SE、null は付与しない）。
- 受信（`src/app/(app)/tasks/new/page.tsx`）: useEffect（`offerPrefillApplied` ref で1回）。カテゴリ「内定承諾報告」を name 一致で `setCategoryId`、候補者を `candidateId`（`id`/`candidateNo`）一致で選択、企業名/内定承諾日/入社日 → `resolvedCat.fields` のラベル一致で `setFieldValues[field.id]`、feeType/理論年収/手数料%/revenue → 課金方式 state（`naiteiFeeMode`/`naiteiTheoryIncome`/`naiteiFeeRate`/`naiteiFixedFee`）、`setStep(2)`。
- 課金方式UI: `isNaitei` カスタムブロック内（雇用形態の下）。helper: module `computeReferralFee()`。「理論年収」「紹介手数料（税抜き）」は `getVisibleFields` の `hiddenLabels` に追加し generic 描画から除外（submit 時に `extraFieldValues` でラベル格納）。
- テンプレ値プリセットの確立パターン（**ラベル一致→`setFieldValues[field.id]`**）: 既存 `prefill=entry`（page.tsx:379-390）/ `prefill=interview-decline`（451-463）と同方式。新導線も踏襲。
