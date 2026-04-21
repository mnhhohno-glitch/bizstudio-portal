# 面談ログ解析ボタン実装設計書（Step 2-3）

## 概要

InterviewForm の添付タブにある「✨ ログを解析して各カラムへ自動入力」ボタンを、
candidate-intake の `/api/portal/analyze-interview` エンドポイントと接続し、
AI解析結果を InterviewDetail / InterviewRating の各フィールドに自動反映する。

---

## 1. 現状分析

### 既存ボタンの動作（現在）

- **場所:** `InterviewForm.tsx:1226` — 添付ファイルセクションのヘッダー右
- **現在の挙動:** 個別添付ファイルの `handleAnalyze(attachmentId)` を呼ぶ
  - `POST /api/interviews/{id}/attachments/{attachmentId}/analyze`
  - 1ファイルのみをGemini解析 → `InterviewAttachment.analysisResult` に保存
  - **InterviewDetail への反映は行われない**（個別ファイル解析のみ）
- **問題:** candidate-intake のマルチパス解析（PDF+ログ同時、YAML プロンプト、flags.ts）を利用していない

### candidate-intake 側 API（Step 1 完了済み）

- **エンドポイント:** `POST /api/portal/analyze-interview`
- **認証:** `x-portal-secret` ヘッダー
- **リクエスト:**
  ```json
  {
    "pdfBuffer": "Base64エンコードPDF",
    "interviewLog": "面談ログテキスト",
    "candidateNumber": "5000001"
  }
  ```
- **レスポンス:**
  ```json
  {
    "success": true,
    "filemaker_mapping": { "エージェント利用フラグ": "あり", ... },
    "work_history": [{ "何社目": 1, "企業名": "...", ... }],
    "missing_items": ["希望エリアフラグ"],
    "analysis_metadata": { "geminiTimeMs": 12000, ... }
  }
  ```

---

## 2. Excel カラム → Portal フィールド 完全マッピング

### 基本情報シート（64列）

| # | Excel カラム名（filemaker_mapping キー） | Portal フィールド | 型 | 変換 |
|---|---------------------------------------|------------------|-----|------|
| 1 | エージェント利用フラグ | `detail.agentUsageFlag` | select | そのまま |
| 2 | エージェント利用メモ | `detail.agentUsageMemo` | text | そのまま |
| 3 | 転職時期フラグ | `detail.jobChangeTimeline` | select | そのまま |
| 4 | 転職時期メモ | `detail.jobChangeTimelineMemo` | text | そのまま |
| 5 | 転職活動期間フラグ | `detail.activityPeriod` | select | そのまま |
| 6 | 転職活動期間メモ | `detail.activityPeriodMemo` | text | そのまま |
| 7 | 現在応募求人数 | `detail.currentApplicationCount` | text | そのまま |
| 8 | 応募種別フラグ | `detail.applicationTypeFlag` | select | そのまま |
| 9 | 応募状況メモ | `detail.applicationMemo` | text | そのまま |
| 10 | 学歴フラグ | `detail.educationFlag` | select | そのまま |
| 11 | 学歴メモ | `detail.educationMemo` | text | そのまま |
| 12 | 卒業年月 | `detail.graduationDate` | text | そのまま |
| 13 | 面談メモ | `record.interviewMemo` | text | 親モデルに反映 |
| 14 | 希望職種フラグ | `detail.desiredJobType1` | select | そのまま |
| 15 | 希望職種メモ | `detail.desiredJobType1Memo` | text | そのまま |
| 16 | 希望業種フラグ | `detail.desiredIndustry1` | select | そのまま |
| 17 | 希望業種メモ | `detail.desiredIndustry1Memo` | text | そのまま |
| 18 | 希望エリアフラグ | `detail.desiredArea` | select | そのまま |
| 19 | 希望都道府県 | `detail.desiredPrefecture` | text | そのまま |
| 20 | 希望市区 | `detail.desiredCity` | text | そのまま |
| 21 | 希望エリアメモ | `detail.desiredAreaMemo` | text | そのまま |
| 22 | 現在年収 | `detail.currentSalary` | text | そのまま |
| 23 | 希望下限年収 | `detail.desiredSalaryMin` | text | そのまま |
| 24 | 希望年収 | `detail.desiredSalaryMax` | text | そのまま |
| 25 | 現年収メモ | `detail.currentSalaryMemo` | text | そのまま |
| 26 | 下限年収メモ | `detail.desiredSalaryMinMemo` | text | そのまま |
| 27 | 希望年収メモ | `detail.desiredSalaryMaxMemo` | text | そのまま |
| 28 | 希望曜日フラグ | `detail.desiredDayOff` | select | そのまま |
| 29 | 希望曜日メモ | `detail.desiredDayOffMemo` | text | そのまま |
| 30 | 希望最大残業フラグ | `detail.desiredOvertimeMax` | select | そのまま |
| 31 | 希望最大残業メモ | `detail.desiredOvertimeMemo` | text | そのまま |
| 32 | 希望転勤フラグ | `detail.desiredTransfer` | select | そのまま |
| 33 | 希望転勤メモ | `detail.desiredTransferMemo` | text | そのまま |
| 34 | 自動車免許フラグ | `detail.driverLicenseFlag` | select | そのまま |
| 35 | 自動車免許メモ | `detail.driverLicenseMemo` | text | そのまま |
| 36 | 語学フラグ | ※ 下記参照 | — | 変換必要 |
| 37 | 語学スキルフラグ | `detail.languageSkillFlag` | select | 変換必要 |
| 38 | 語学スキルメモ | `detail.languageSkillMemo` | text | そのまま |
| 39 | 日本語スキルフラグ | `detail.japaneseSkillFlag` | select | そのまま |
| 40 | 日本語スキルメモ | `detail.japaneseSkillMemo` | text | そのまま |
| 41 | PCスキル_タイピングフラグ | `detail.typingFlag` | select | そのまま |
| 42 | PCスキル_タイピングメモ | `detail.typingMemo` | text | そのまま |
| 43 | PCスキル_Excelフラグ | `detail.excelFlag` | select | そのまま |
| 44 | PCスキル_Excelメモ | `detail.excelMemo` | text | そのまま |
| 45 | PCスキル_Wordフラグ | `detail.wordFlag` | select | そのまま |
| 46 | PCスキル_Wordメモ | `detail.wordMemo` | text | そのまま |
| 47 | PCスキル_PPTフラグ | `detail.pptFlag` | select | そのまま |
| 48 | PCスキル_PPTメモ | `detail.pptMemo` | text | そのまま |
| 49 | 応募書類状況フラグ | `detail.documentStatusFlag` | select | そのまま |
| 50 | 応募書類状況メモ | `detail.documentStatusMemo` | text | そのまま |
| 51 | 応募書類サポートフラグ | `detail.documentSupportFlag` | select | そのまま |
| 52 | 応募書類サポートメモ | `detail.documentSupportMemo` | text | そのまま |
| 53 | LINE設定フラグ | `detail.lineSetupFlag` | select | そのまま |
| 54 | LINE設定メモ | `detail.lineSetupMemo` | text | そのまま |
| 55 | 求人送付フラグ | `detail.jobReferralFlag` | select | そのまま |
| 56 | 求人送付予定時期 | `detail.jobReferralTimeline` | text | そのまま |
| 57 | 求人送付メモ | `detail.jobReferralMemo` | text | そのまま |
| 58 | 次回面談設定フラグ | `detail.nextInterviewFlag` | select | そのまま |
| 59 | 次回面談予定日 | `detail.nextInterviewDate` | text | そのまま |
| 60 | 次回面談予定時刻 | `detail.nextInterviewTime` | text | そのまま |
| 61 | 次回面談予定メモ | `detail.nextInterviewMemo` | text | そのまま |
| 62 | フリーメモ | `detail.freeMemo` | text | そのまま |
| 63 | 初回面談まとめ | `detail.initialSummary` | text | そのまま |
| 64 | インポート用照合キー | — | — | 不要（Portal はDB リレーション） |

### 職歴シート（12列）

| # | Excel カラム | Portal フィールド | 変換 |
|---|------------|------------------|------|
| 1 | 求職者NO | — | 不要（リレーション管理） |
| 2 | 何社目 | — | ソート用（直近を判定） |
| 3 | 企業名 | `detail.companyName` | 直近1社 |
| 4 | 事業内容 | `detail.businessContent` | 直近1社 |
| 5 | 在籍期間_年 + _ヶ月 | `detail.tenure` | 結合（例: "3年6ヶ月"） |
| 6 | 職種フラグ | `detail.jobTypeFlag` | 直近1社 |
| 7 | 職種メモ | `detail.jobTypeMemo` | 直近1社 |
| 8 | 退職理由_大 | `detail.resignReasonLarge` | 直近1社 |
| 9 | 退職理由_中 | `detail.resignReasonMedium` | 直近1社 |
| 10 | 退職理由_小 | `detail.resignReasonSmall` | 直近1社 |
| 11 | 転職理由メモ | `detail.jobChangeReasonMemo` | 直近1社 |
| — | 全社分 | `detail.careerSummary` | テキスト整形して格納 |

---

## 3. 語学スキルフラグの解決

### 問題
candidate-intake の flags.ts には2つの別カラムがある:
- **語学フラグ:** 言語種別（English, Chinese, Spanish, ...）
- **語学スキルフラグ:** 習熟度（ネイティブレベル, ビジネスレベル, 日常会話レベル, 不可）

Portal の InterviewForm には1フィールドのみ:
- **`languageSkillFlag`:** `["不可", "日常会話", "ビジネス", "ネイティブ"]`

### 解決策
```typescript
// 語学スキルフラグの値を Portal の選択肢にマッピング
const LANGUAGE_SKILL_MAP: Record<string, string> = {
  "ネイティブレベル": "ネイティブ",
  "ビジネスレベル": "ビジネス",
  "日常会話レベル": "日常会話",
  "不可": "不可",
};

// 語学フラグ（言語種別）は languageSkillMemo に含める
// 例: "English" → languageSkillMemo に "英語" を追加
```

**方針:** `語学スキルフラグ` → `languageSkillFlag` にマッピング（値変換あり）。
`語学フラグ`（言語種別）→ `languageSkillMemo` に言語名を含めて反映。

---

## 4. 職歴の構造差異解決

### 問題
- candidate-intake: 1社=1行の配列（`work_history[]`）
- Portal: InterviewDetail に1社分のフィールドのみ

### 解決策
```typescript
function mapWorkHistory(workHistory: WorkHistoryItem[]) {
  // 直近（最大の何社目）を個別フィールドに
  const sorted = [...workHistory].sort((a, b) => (b.何社目 ?? 0) - (a.何社目 ?? 0));
  const latest = sorted[0];

  const detail: Record<string, string> = {};
  if (latest) {
    detail.companyName = latest.企業名 ?? "";
    detail.businessContent = latest.事業内容 ?? "";
    detail.tenure = formatTenure(latest.在籍期間_年, latest.在籍期間_ヶ月);
    detail.jobTypeFlag = latest.職種フラグ ?? "";
    detail.jobTypeMemo = latest.職種メモ ?? "";
    detail.resignReasonLarge = latest.退職理由_大 ?? "";
    detail.resignReasonMedium = latest.退職理由_中 ?? "";
    detail.resignReasonSmall = latest.退職理由_小 ?? "";
    detail.jobChangeReasonMemo = latest.転職理由メモ ?? "";
  }

  // 全社分を careerSummary テキストに
  const summaryLines = sorted.map((w) =>
    `【${w.何社目}社目】${w.企業名}（${w.事業内容}）${formatTenure(w.在籍期間_年, w.在籍期間_ヶ月)} / ${w.職種フラグ}`
  );
  detail.careerSummary = summaryLines.join("\n");

  return detail;
}
```

---

## 5. 実装計画

### 5-1. 環境変数追加

```env
CANDIDATE_INTAKE_URL=https://candidate-intake-production.up.railway.app
PORTAL_SHARED_SECRET=（既存の共有シークレット）
```

### 5-2. プロキシ API 作成

**ファイル:** `src/app/api/interviews/[id]/analyze-with-intake/route.ts`

```
POST /api/interviews/{id}/analyze-with-intake
```

**処理フロー:**
1. 認証チェック（getSessionUser）
2. InterviewRecord + Attachments 取得
3. 添付ファイルから PDF（履歴書）と TXT（面談ログ）を自動検出
4. Supabase Storage からファイルダウンロード
5. candidate-intake `/api/portal/analyze-interview` にPOST
6. レスポンスJSON をそのまま返却

### 5-3. マッピングモジュール

**ファイル:** `src/lib/interview-analyzer-mapping.ts`

**責務:**
- `filemaker_mapping` → `setDetail()` 呼び出し用キーバリューペアへの変換
- `work_history[]` → 直近1社の個別フィールド + `careerSummary` テキスト
- 語学スキルフラグの値変換
- `面談メモ` → `interviewMemo`（親モデル）の分離

**エクスポート:**
```typescript
export function mapFilemakerToDetail(
  mapping: Record<string, unknown>
): Record<string, string>;

export function mapWorkHistoryToDetail(
  workHistory: WorkHistoryItem[]
): Record<string, string>;

export function extractInterviewMemo(
  mapping: Record<string, unknown>
): string | null;
```

### 5-4. InterviewForm ボタン改修

**変更箇所:** `InterviewForm.tsx:1226`

**Before:**
```tsx
<BtnMini variant="ai" onClick={() => {
  const first = attachments.find((a) => a.analysisStatus !== "completed");
  if (first) handleAnalyze(first.id);
}}>✨ ログを解析して各カラムへ自動入力</BtnMini>
```

**After:**
```tsx
<BtnMini variant="ai" loading={intakeAnalyzing} onClick={handleIntakeAnalyze}>
  ✨ ログを解析して各カラムへ自動入力
</BtnMini>
```

**新しい `handleIntakeAnalyze` 関数:**
1. `POST /api/interviews/{id}/analyze-with-intake`
2. レスポンスの `filemaker_mapping` をマッピングモジュールで変換
3. `Object.entries(mapped).forEach(([key, val]) => setDetail(key, val))` で一括反映
4. `work_history` も同様にマッピング → setDetail
5. 面談メモがあれば `setInterviewMemo()` にも反映
6. toast で成功/失敗を表示
7. 既存の個別 `handleAnalyze` はそのまま残す（個別ファイル解析用）

---

## 6. 既存機能への影響分析

| 既存機能 | 影響 | 対策 |
|---------|------|------|
| 個別ファイル AI 解析（✨ AI解析 ボタン） | **影響なし** — 各添付ファイル横のボタンはそのまま残す | — |
| `handleAnalyze` 関数 | **影響なし** — 新しい `handleIntakeAnalyze` は別関数 | — |
| InterviewDetail の手動入力 | **影響なし** — AI解析結果は `setDetail` で反映するのみ、上書き確認ダイアログを表示 | 解析前に「既存データを上書きしますか？」確認 |
| InterviewRating | **今回は対象外** — candidate-intake の解析結果にはレーティング情報がないため | 将来対応可 |
| 面談管理一覧ページ | **影響なし** — 一覧はDB保存済みデータを表示するのみ | — |
| 既存の `/api/interviews/analyze/route.ts` | **影響なし** — 別エンドポイント。ただし将来的に統合検討可 | — |

---

## 7. 制約事項・注意点

1. **candidate-intake が稼働していること** — ダウン時はエラーメッセージを表示し、手動入力で対応
2. **添付ファイルに PDF と TXT が必要** — どちらか欠けている場合もAPIは呼べる（interviewLog のみ or pdfBuffer のみ）
3. **上書き確認** — 既にフィールドに値が入っている場合、解析結果で上書きするか確認ダイアログを表示
4. **タイムアウト** — candidate-intake の解析は最大60秒程度。プロキシAPI の maxDuration は 300s に設定
5. **フラグ値の不一致** — candidate-intake の flags.ts と Portal の select options が厳密に一致しない場合がある。マッピングモジュール内で変換テーブルを管理
