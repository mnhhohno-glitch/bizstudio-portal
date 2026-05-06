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

## CandidateDetailPage.tsx（未着手、将来追加枠）

- パス: `src/components/candidates/CandidateDetailPage.tsx`
- 用途: 求職者詳細ページ全体

⚠️ **構造マップ未作成**。次回修正時に追記。

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
