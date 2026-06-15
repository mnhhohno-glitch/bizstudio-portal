# T-062 AI解析パス調査レポート

## 目的

`pdf-upload` API が「intake接続エラー」を起こしている原因を特定し、正しいAI解析経路を明らかにする。

---

## A. UI側の実装（動作実績あり）

**ファイル**: `src/app/(app)/admin/master/CandidateRegistrationModal.tsx`

新規登録モーダルの「AI解析して自動入力」ボタンが `handleParseResume` (L92-121) を呼び出す:

```typescript
const fd = new FormData();
fd.append("file", file);
const res = await fetch("/api/candidates/parse-resume", {
  method: "POST",
  body: fd,
});
const data = await res.json();
```

レスポンスフィールドのマッピング:
- `data.name` → 氏名
- `data.furigana` → フリガナ
- `data.gender` → 性別
- `data.birthday` → 生年月日
- `data.email` → メール
- `data.phone` → 電話番号
- `data.address` → 住所

---

## B. 正しいAPI経路（Gemini直接呼び出し）

**ファイル**: `src/app/api/candidates/parse-resume/route.ts` (122行)

- **認証**: セッションベース (`getSessionUser`)
- **AI呼び出し**: Gemini API 直接
  - モデル: `gemini-3-flash-preview`
  - temperature: `0.1`
  - URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`
- **環境変数**: `GEMINI_API_KEY` のみ必要
- **入力**: multipart FormData (`file` フィールド、PDF)
- **処理フロー**: PDF → arrayBuffer → base64 → Gemini API → JSON parse → response

```typescript
const apiKey = process.env.GEMINI_API_KEY;
const resp = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
        { text: prompt }
      ]}],
      generationConfig: { temperature: 0.1 },
    }),
  }
);
```

**出力JSON**:
```json
{
  "name": "string|null",
  "furigana": "string|null",
  "gender": "string|null",
  "birthday": "string|null",
  "email": "string|null",
  "phone": "string|null",
  "address": "string|null",
  "desiredJobType1": "string|null",
  "desiredJobType2": "string|null",
  "desiredIndustry1": "string|null",
  "desiredPrefecture": "string|null",
  "desiredEmploymentType": "string|null",
  "desiredSalaryMin": "number|null"
}
```

---

## C. 現在の pdf-upload API の誤った経路

**ファイル**: `src/app/api/rpa/mynavi/pdf-upload/route.ts` (L84-122)

candidate-intake サービスの `/api/intake/extract_resume` を呼び出している:

```typescript
const intakeUrl =
  process.env.CANDIDATE_INTAKE_URL ||
  process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL ||
  HARDCODED_INTAKE_URL;
const secret = process.env.PORTAL_SHARED_SECRET;

const fd = new FormData();
fd.append("candidateId", mynaviApplicantNumber || "MYNAVI_RPA");
fd.append("pdf", new Blob([...]), originalFileName);
fd.append("interviewLog", new Blob([...]), "empty.txt");

const upstream = await fetch(`${intakeUrl}/api/intake/extract_resume`, {
  method: "POST",
  headers: { "x-portal-secret": secret },
  body: fd,
});
```

**問題点**:
1. candidate-intake は面談ログ+PDF を組み合わせて解析するサービスであり、マイナビPDF単体の基本情報抽出には不適切
2. `interviewLog` に空ファイルを渡しており、本来の使い方ではない
3. candidate-intake のレスポンス形式と `parseResumeData()` のパース期待値が合致しない可能性
4. 環境変数 `CANDIDATE_INTAKE_URL` / `PORTAL_SHARED_SECRET` が必要（Gemini直接なら `GEMINI_API_KEY` のみ）

---

## D. 2つの経路の比較

| 項目 | parse-resume (正) | pdf-upload (誤) |
|------|-------------------|-----------------|
| AI サービス | Gemini API 直接 | candidate-intake |
| 環境変数 | `GEMINI_API_KEY` | `CANDIDATE_INTAKE_URL`, `PORTAL_SHARED_SECRET` |
| 入力 | PDF 1ファイル | PDF + 空の interviewLog |
| 出力 | 構造化JSON (13フィールド) | `resumeData` (不明確) |
| 動作実績 | あり（新規登録で運用中） | なし（intake接続エラー） |
| 外部依存 | Google Gemini API のみ | candidate-intake マイクロサービス |

---

## E. parseResumeData の現在の実装

**ファイル**: `src/lib/mynavi-rpa/parse-resume-data.ts`

candidate-intake のレスポンスをパースする関数。Gemini直接に切り替える場合、この関数の入力形式を parse-resume のレスポンス形式に合わせる必要がある。

---

## F. 修正案

### 案1（推奨）: pdf-upload API 内で Gemini 直接呼び出しに置換

`/api/candidates/parse-resume/route.ts` と同じ方式で Gemini API を直接呼び出す。

**修正範囲**:
1. `src/app/api/rpa/mynavi/pdf-upload/route.ts` L84-122 を Gemini 直接呼び出しに置換
2. `src/lib/mynavi-rpa/parse-resume-data.ts` の入力を Gemini レスポンス形式に対応させる
3. import から candidate-intake 関連を削除

**メリット**:
- 外部マイクロサービス依存を排除（Gemini API のみ）
- 動作実績のある経路を再利用
- `GEMINI_API_KEY` は既に .env に設定済み

**実装イメージ**:
```typescript
// candidate-intake 呼び出しを以下に置換:
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません");

const base64Pdf = pdfBuffer.toString("base64");
const prompt = `以下のPDFから...（parse-resume と同じプロンプト）`;

const geminiResp = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
        { text: prompt }
      ]}],
      generationConfig: { temperature: 0.1 },
    }),
  }
);
```

### 案2: parse-resume API を内部呼び出し

pdf-upload から `/api/candidates/parse-resume` を internal fetch で呼ぶ。ただし認証がセッションベースのため RPA コンテキストでは使えない。非推奨。

---

## 結論

**pdf-upload API の AI 解析部分を、candidate-intake 経由から Gemini 直接呼び出しに変更すべき。** 新規登録モーダルで動作実績のある `/api/candidates/parse-resume` と同じ方式を採用することで、確実に動作する経路に移行できる。
