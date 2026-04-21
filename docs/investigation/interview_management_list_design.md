# 面談管理一覧画面 設計調査レポート

**調査日:** 2026-04-21
**対象:** v9モック準拠の面談管理一覧ページ新規作成

---

## 1. スキーマ分析: テーブルカラムとフィールドのマッピング

### テーブルカラム → Prismaフィールド対応表

| # | カラム | ソース | フィールドパス | 備考 |
|---|--------|--------|---------------|------|
| 1 | 操作 | - | - | ✎詳細 / 🗑削除 ボタン |
| 2 | 担当RC | InterviewRecord → interviewer → Employee | `interviewer.employeeNumber` + `interviewer.name` | RC = 面談実施者 |
| 3 | 担当CA | InterviewRecord → candidate → employee → Employee | `candidate.employee.employeeNumber` + `candidate.employee.name` | CA = 求職者担当 |
| 4 | 面談日 | InterviewRecord | `interviewDate` + `interviewTool` | |
| 5 | 開始/終了 | InterviewRecord | `startTime` + `endTime` | HH:mm形式 |
| 6 | 回数/結果 | InterviewRecord + InterviewRating | `interviewCount` + `resultFlag` + `rating.overallRank` | |
| 7 | 求職者氏名 | Candidate | `candidate.name` + `candidate.candidateNumber` | リンク → `/candidates/{id}?view=interview` |
| 8 | 年齢/性別 | Candidate | `candidate.birthday`(→年齢計算) + `candidate.gender` | |
| 9 | 電話番号 | Candidate | `candidate.phone` | |
| 10 | メール/住所 | Candidate | `candidate.email` + `candidate.address` | 2行統合 |
| 11 | 転職時期/評価 | InterviewDetail + InterviewRating | `detail.jobChangeTimeline` + `rating.overallRank` | |
| 12 | 希望都道府県 | InterviewDetail | `detail.desiredPrefecture` | |
| 13 | 第一希望職種 | InterviewDetail | `detail.desiredJobType1` | |

### 不足フィールド: なし

全カラムが既存スキーマのフィールドでカバー可能。Prismaスキーマ変更不要。

---

## 2. 既存APIの状況

| エンドポイント | メソッド | 状況 | 用途 |
|---------------|---------|------|------|
| `/api/interviews` | POST | **既存** | 新規作成（candidateId等必須） |
| `/api/interviews` | GET | **新規作成必要** | 一覧取得（フィルター/ソート/ページネーション） |
| `/api/interviews/[id]` | GET | 既存 | 単体取得 |
| `/api/interviews/[id]` | PATCH | 既存 | 更新 |
| `/api/interviews/[id]` | DELETE | 既存 | 削除（Storage添付+cascade） |

**新規作成が必要なのは `GET /api/interviews` のみ。** DELETE は既存のものを再利用。

### GET /api/interviews API設計案

```
GET /api/interviews?
  page=1&
  pageSize=30&
  sortBy=interviewDate&
  sortOrder=desc&
  rcName=&             // 担当RC名（部分一致）
  caName=&             // 担当CA名（部分一致）
  dateFrom=&           // 日付開始（ISO文字列）
  dateTo=&             // 日付終了（ISO文字列）
  candidateName=&      // 求職者名（部分一致）
  search=              // フリー検索（求職者名/番号/RC名/CA名/電話番号）
```

**レスポンス:**
```json
{
  "interviews": [...],
  "total": 150,
  "page": 1,
  "pageSize": 30
}
```

**Prisma include:**
```prisma
{
  candidate: {
    select: {
      id, candidateNumber, name, gender, birthday,
      phone, email, address,
      employee: { select: { id, employeeNumber, name } }
    }
  },
  interviewer: { select: { id, employeeNumber, name } },
  detail: { select: { jobChangeTimeline, desiredPrefecture, desiredJobType1 } },
  rating: { select: { overallRank } }
}
```

---

## 3. サイドバー追加

**ファイル:** `src/components/layout/Sidebar.tsx`

**追加位置:** `apps` 配列の後、`NavItem href="/schedule-urls"` の後に追加（アプリセクション内、履歴書生成の下）

```tsx
// 195行目の後に追加
<NavItem href="/admin/interviews" label="面談登録" icon="📝" />
```

**注意:** 現在のサイドバーは emoji アイコンを使用（lucide-react ではない）。v9モック仕様には「ClipboardList or CalendarCheck」とあるが、既存パターンに合わせて emoji を使うべき。

---

## 4. ルーティング

**ページパス:** `src/app/(app)/admin/interviews/page.tsx`
- URL: `/admin/interviews`
- 既存パターン: `/admin/master`, `/admin/users`, `/admin/announcements` と同列

**コンポーネント構成:**
- `page.tsx` — Server Component（データ取得なし、クライアントへ委譲）
- `InterviewListClient.tsx` — Client Component（フィルター/ソート/ページネーション/モーダル）

**参考パターン:** `src/app/(app)/admin/master/` の `page.tsx` + `CandidateListClient.tsx`

---

## 5. 再利用可能な既存コンポーネント

| コンポーネント | ファイル | 用途 |
|---------------|---------|------|
| `Table, TableWrap, Th, Td` | `src/components/ui/Table.tsx` | テーブル構造 ※ただしv9はカスタムヘッダー色(#185FA5)なのでカスタムで構築 |
| `toast` | sonner | トースト通知 |
| `confirm()` | ブラウザネイティブ | 削除確認 |

**DatePicker / TimePicker:** 既存コンポーネントなし。ネイティブ `<input type="date">` / `<input type="time">` を使用（既存パターン: CandidateListClient.tsx の日付フィルター）。

**候補者検索コンポーネント:** 既存なし。新規登録モーダル内にインライン実装する。

---

## 6. 新規登録モーダル設計

POST /api/interviews の既存バリデーション（route.ts:17行目）:
```
必須: candidateId, interviewDate, startTime, endTime, interviewTool, interviewerUserId, interviewType
```

**v9仕様の必須項目:**
- 求職者（candidateId）— 名前 or 求職者番号で検索
- 面談日（interviewDate）
- 開始時間（startTime）
- 面談手法（interviewTool）

**差異:** 既存APIは `endTime` と `interviewerUserId` と `interviewType` も必須だが、v9仕様では任意。

**対応案:** 
- `interviewerUserId`: ログインユーザーの Employee ID をデフォルト設定
- `interviewType`: デフォルト「新規面談」
- `endTime`: デフォルト空文字列 → API側で `endTime` を任意に変更する必要あり

**⚠️ 要確認:** POST API の必須フィールドを `endTime` のみ任意に緩和してよいか？

---

## 7. 実装ファイル一覧（予定）

| ファイル | 種別 | 内容 |
|---------|------|------|
| `src/components/layout/Sidebar.tsx` | 変更 | メニュー項目追加（1行） |
| `src/app/(app)/admin/interviews/page.tsx` | 新規 | Server Component（ページエントリ） |
| `src/app/(app)/admin/interviews/InterviewListClient.tsx` | 新規 | Client Component（メイン画面） |
| `src/app/api/interviews/route.ts` | 変更 | GET ハンドラ追加（一覧API） |

計: 新規2ファイル + 変更2ファイル

---

## 8. 注意点・確認事項

1. **v9モックファイルがリポジトリ内に存在しない** — `interview_management_mockup_v9.html` は見つからず。タスク説明のUI仕様のみで実装する。
2. **サイドバーアイコン**: 既存パターンは全て emoji。lucide-react の `ClipboardList` に変更するか、emoji で統一するか？ → **emoji で統一推奨**（既存パターンに合わせる）
3. **POST API の endTime 必須緩和**: 新規登録モーダルで endTime を任意にするなら、API の必須バリデーション変更が必要
4. **テーブルヘッダー色**: v9仕様は `#185FA5`（Bizstudio青）。既存 `Table.tsx` の `Th` は白背景のため、カスタムヘッダーで実装
5. **エクスポート機能**: v9仕様に「↓ エクスポート」ボタンあり。初期実装に含めるか、後回しか？
