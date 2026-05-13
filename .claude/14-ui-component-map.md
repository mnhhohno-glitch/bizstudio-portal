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
- 行数: 1900+ 行
- 用途: 紹介履歴タブ全体（ブックマーク / 求人紹介 / エントリーの 3 タブ）
- 親: `CandidateDetailPage.tsx` → `activeTab === "history"`

### 全体レイアウト

```
HistoryTab
  ├─ タブバー: bookmark / jobs / entries
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
  └─ entries タブ → エントリー一覧
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

---

## EntryBoard.tsx（未着手、将来追加枠）

- パス: `src/components/entries/EntryBoard.tsx`
- 用途: エントリー管理画面

⚠️ **構造マップ未作成**。次回修正時に追記。

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
