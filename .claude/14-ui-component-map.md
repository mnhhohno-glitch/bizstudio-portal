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

## HistoryTab.tsx（未着手、将来追加枠）

- パス: `src/components/candidates/HistoryTab.tsx`
- 行数: 1700+ 行
- 用途: 紹介履歴タブ全体（ブックマーク / 求人紹介 / エントリーの3タブ）

⚠️ **構造マップ未作成**。次回修正時に Phase 1 調査で構造を把握し、ここに追記すること。

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
  │   └─ 保存状態表示（DB 保存済み or ブラウザ保持中）
  └─ error 状態: エラー表示 + [再試行] / [初めからやり直す]
```

### 主要 state

| state | 型 | 用途 |
|--|--|--|
| `step` | "idle" / "processing" / "completed" / "error" | ステップ状態 |
| `currentStage` | "extract" / "generate" / "create" / null | プログレスバー描画用 |
| `stageStatus` | { extract, generate, create: "pending" / "running" / "done" / "failed" } | 各段階の状態 |
| `selectedPdfFileId` / `selectedTxtFileId` | string \| null | ファイル選択 |
| `groupKey` / `categoryValue` / `otherLabel` | string | 経験職種カテゴリ選択 |
| `resumeData` / `questionsJson` / `formResult` | API 結果保持（リトライ時に再利用）|
| `interviewLogText` | string | extract-resume レスポンスから保持、generate-form で再送 |

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
