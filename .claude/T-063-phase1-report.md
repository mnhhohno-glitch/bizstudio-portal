# T-063 Phase 1 調査報告

## 調査1: UI 画面とコンポーネント

### 画面
- **求職者一覧画面** (`/admin/master`) の「求職者を新規登録」モーダル

### ファイル
- `src/app/(app)/admin/master/CandidateRegistrationModal.tsx`

### コンポーネント
- `CandidateRegistrationModal`（`CandidateListClient.tsx` L7 でインポート）

### 実コード転記

#### PDF 添付フィールド + AI解析ボタン（L314-L342）
```typescript
// src/app/(app)/admin/master/CandidateRegistrationModal.tsx L314-L342
        {/* PDF Upload Section */}
        <div className="mb-5 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-[13px] font-medium text-[#374151] mb-2">📄 WEB履歴書から自動入力（任意）</p>
          <div
            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer relative ${pdfDragging ? "border-[#2563EB] bg-blue-50" : "border-gray-300 hover:border-[#2563EB]"}`}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragging(false); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragging(false); const f = e.dataTransfer.files[0]; if (f?.type === "application/pdf") setPdfFile(f); }}
            onClick={() => fileInputRef.current?.click()}
          >
            {pdfFile ? (
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-gray-700">📄 {pdfFile.name}</span>
                <button onClick={(e) => { e.stopPropagation(); setPdfFile(null); }} className="text-gray-400 hover:text-red-500 text-sm">✕</button>
              </div>
            ) : (
              <p className="text-[13px] text-gray-400 pointer-events-none">{pdfDragging ? "ここにドロップ" : "PDFをドラッグ＆ドロップ、またはクリックして選択"}</p>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPdfFile(f); e.target.value = ""; }} />
          <button
            onClick={handleParseResume}
            disabled={!pdfFile || parsing}
            className="mt-2 w-full bg-purple-600 text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {parsing ? "解析中..." : "✨ AI解析して自動入力"}
          </button>
        </div>
```

#### onClick ハンドラ `handleParseResume`（L108-L137）
```typescript
// src/app/(app)/admin/master/CandidateRegistrationModal.tsx L108-L137
  const handleParseResume = async () => {
    if (!pdfFile) return;
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      const res = await fetch("/api/candidates/parse-resume", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "PDF解析に失敗しました");
        return;
      }
      const data = await res.json();
      if (data.name) setCandidateName(data.name);
      if (data.furigana) setNameKana(data.furigana);
      if (data.gender) setGender(data.gender);
      if (data.birthday) setBirthday(data.birthday);
      if (data.email) setEmail(data.email);
      if (data.phone) setPhone(data.phone);
      if (data.address) setAddress(data.address);
      toast.success("履歴書の解析が完了しました");
    } catch {
      toast.error("PDF解析に失敗しました");
    } finally {
      setParsing(false);
    }
  };
```

#### PDF 添付の実装方法
- **方式**: multipart/form-data（FormData で `file` フィールドとして送信）
- **ファイル選択**: `<input type="file" accept=".pdf">` + ドラッグ＆ドロップ
- **状態管理**: `pdfFile: File | null`（React state）

---

## 調査2: ボタン押下処理経路

### 呼び出しチェーン全体

```
[UI] CandidateRegistrationModal
  → handleParseResume()        -- L108
    → POST /api/candidates/parse-resume (FormData: file)   -- L114
      → Gemini API (gemini-3-flash-preview)                -- route.ts L34
      → JSONレスポンス返却                                    -- route.ts L103-117
  → フォームフィールドに自動入力  -- L124-130
  → ユーザーが「登録する」ボタンを押下
  → handleSubmit()             -- L157
    → POST /api/master/candidates (JSON)                   -- L162
      → prisma.candidate.create()                          -- master/candidates/route.ts L142-157
    → POST /api/candidates/{id}/files/upload (FormData)    -- L199（PDF保存）
  → supportStatus 選択ダイアログ表示
```

**重要**: 手動フローでは「AI解析」と「DB登録」は **2ステップ分離** されている。AI解析はフォーム自動入力のみで、DB登録はユーザーが「登録する」を押すまで行われない。

### API ハンドラ: `/api/candidates/parse-resume`

```typescript
// src/app/api/candidates/parse-resume/route.ts 全文（L1-L122）
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI機能が設定されていません" }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "PDFファイルを選択してください" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDFファイルのみアップロード可能です" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "ファイルサイズは10MB以下にしてください" }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const base64Data = fileBuffer.toString("base64");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: base64Data,
                  },
                },
                {
                  text: `以下はWEB履歴書（転職サイトの登録情報）のPDFから抽出したテキストです。
以下の項目を抽出し、JSON形式で返却してください。

## 抽出項目（個人情報）
- name: 氏名（姓と名の間に半角スペース）
- furigana: フリガナ（カタカナ、姓と名の間に半角スペース）
- gender: 性別（"male" or "female"）
- birthday: 生年月日（YYYY-MM-DD形式）
- email: メールアドレス
- phone: 電話番号（ハイフンなし、数字のみ）
- address: 住所（都道府県から）

## 抽出項目（希望条件 - 該当セクションがあれば）
- desiredJobType1: 希望職種の第1希望（例 営業事務・営業アシスタント）
- desiredJobType2: 希望職種の第2希望（例 一般事務・庶務）
- desiredIndustry1: 希望業種の第1希望
- desiredPrefecture: 希望勤務地の都道府県（例 神奈川県）
- desiredEmploymentType: 希望雇用形態（正社員/契約社員/派遣社員/パート・アルバイト/業務委託/その他 のいずれか）
- desiredSalaryMin: 希望年収の下限（万円単位の整数、例 450）

## ルール
- テキストに含まれない項目はnullにする
- 推測で値を補完しない
- JSON以外の文字は出力しない（\`\`\`jsonなどのマークダウンも不要）
- 性別は "male" または "female" で出力する`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2000,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error("Gemini API error:", response.status);
      return NextResponse.json({ error: "PDF解析に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return NextResponse.json({ error: "PDF解析に失敗しました" }, { status: 500 });
    }

    const jsonStr = rawText.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr);

    return NextResponse.json({
      name: parsed.name || null,
      furigana: parsed.furigana || null,
      gender: parsed.gender || null,
      birthday: parsed.birthday || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      address: parsed.address || null,
      desiredJobType1: parsed.desiredJobType1 || null,
      desiredJobType2: parsed.desiredJobType2 || null,
      desiredIndustry1: parsed.desiredIndustry1 || null,
      desiredPrefecture: parsed.desiredPrefecture || null,
      desiredEmploymentType: parsed.desiredEmploymentType || null,
      desiredSalaryMin: typeof parsed.desiredSalaryMin === "number" ? parsed.desiredSalaryMin : null,
    });
  } catch (error) {
    console.error("Parse resume error:", error);
    return NextResponse.json({ error: "PDF解析に失敗しました" }, { status: 500 });
  }
}
```

### AI 解析サービス
- **モデル**: `gemini-3-flash-preview`（Gemini API 直接呼び出し）
- **方式**: PDF を Base64 エンコードして `inlineData` として送信
- **温度**: 0.1（決定的出力）

### AI 解析プロンプト本文
parse-resume API にインライン記述（上記コード L50-L74）。`gemini-resume-parser.ts` にも同一プロンプトが `RESUME_PROMPT` 定数として定義（L25-L49）。

### DB 書き込み処理
手動フローでは `handleSubmit()` → `POST /api/master/candidates` → `prisma.candidate.create()`:

```typescript
// src/app/api/master/candidates/route.ts L142-L157
    const candidate = await prisma.candidate.create({
      data: {
        candidateNumber,
        name: formattedName,
        nameKana: nameKana.trim(),
        ...(email ? { email: email.trim() } : {}),
        ...(phone ? { phone: phone.trim() } : {}),
        ...(address ? { address: address.trim() } : {}),
        gender,
        ...(birthday ? { birthday: new Date(birthday + "T12:00:00.000Z") } : {}),
        ...(recruiterName?.trim() ? { recruiterName: recruiterName.trim() } : {}),
        ...(applicationRoute?.trim() ? { applicationRoute: applicationRoute.trim() } : {}),
        ...(mediaSource?.trim() ? { mediaSource: mediaSource.trim() } : {}),
        employeeId,
      },
    });
```

登録後に PDF を Google Drive にアップロード:
```typescript
// src/app/(app)/admin/master/CandidateRegistrationModal.tsx L194-L206
      if (pdfFile) {
        try {
          const uploadFormData = new FormData();
          uploadFormData.append("file", pdfFile);
          uploadFormData.append("category", "MEETING");
          await fetch(`/api/candidates/${createdCandidate.id}/files/upload`, {
            method: "POST",
            body: uploadFormData,
          });
        } catch {
          // PDF保存失敗は登録自体には影響させない
        }
      }
```

---

## 調査3: T-062 PDF との接続可能性

### 重要発見

**T-062 の `pdf-upload` API は既に「PDF → AI解析 → 判定 → Candidate 登録 → Google Drive 保存」を一気通貫で実行している。**

つまり、T-063 で目指す「アップロード済み PDF から求職者を自動登録」は、**T-062 の既存 API で既に実現済み**。

### pdf-upload API ハンドラ実コード

```typescript
// src/app/api/rpa/mynavi/pdf-upload/route.ts 全文（L1-L294）
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { parseResumeData } from "@/lib/mynavi-rpa/parse-resume-data";
import { parseResumeWithGemini, type GeminiResumeResult } from "@/lib/gemini-resume-parser";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { checkDuplicateProcessing } from "@/lib/mynavi-rpa/duplicate-check";
import { isAgeNg, isForeignNg, calculateAge } from "@/lib/mynavi-rpa/judgment";
import { notifyMynaviDuplicateSkip, notifyMynaviError } from "@/lib/mynavi-rpa/notify";
import { generateNextCandidateNumber } from "@/lib/candidate-number";
import { uploadFileToDrive, getOrCreateFolder } from "@/lib/google-drive";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

export const runtime = "nodejs";
export const maxDuration = 300;

async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({
    where: { email: "anonymous@local" },
    select: { id: true },
  });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({
    where: { role: "admin", status: "active" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

function deriveNameParts(
  name: string | null,
  lastName: string | null,
  firstName: string | null,
): { last: string; first: string } {
  if (lastName && firstName) return { last: lastName, first: firstName };
  const n = (name || "").trim();
  if (!n) return { last: "", first: "" };
  const parts = n.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) {
    return { last: parts[0], first: parts.slice(1).join("") };
  }
  return { last: n, first: n };
}

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let batchId = "";
  try {
    const form = await req.formData();
    const pdf = form.get("pdf");
    batchId = String(form.get("batchId") || "") || req.nextUrl.searchParams.get("batchId") || "";
    const recruiterName =
      (form.get("recruiterName") ? String(form.get("recruiterName")) : null)
      ?? req.nextUrl.searchParams.get("recruiterName");

    if (!batchId) {
      return NextResponse.json({ error: "batchId は必須です" }, { status: 400 });
    }
    if (!(pdf instanceof File)) {
      return NextResponse.json({ error: "pdf ファイルは必須です" }, { status: 400 });
    }

    const batch = await prisma.rpaExecutionBatch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    if (!batch) {
      return NextResponse.json({ error: "指定されたバッチが見つかりません" }, { status: 404 });
    }

    const pdfBuffer = Buffer.from(await pdf.arrayBuffer());

    // ---- Gemini API で履歴書解析 ----
    let resumeData: GeminiResumeResult | null = null;
    let aiErrorDetail: string | null = null;
    try {
      resumeData = await parseResumeWithGemini(pdfBuffer);
    } catch (e) {
      aiErrorDetail = e instanceof Error ? e.message : String(e);
    }

    const parsed = parseResumeData(resumeData);

    // ---- AI 解析失敗 ----
    if (aiErrorDetail || !parsed.name || !parsed.birthDate) {
      const reason = aiErrorDetail ? `AI解析失敗（Gemini解析エラー）` : "AI解析失敗";
      const log = await prisma.mynaviRpaProcessingLog.create({
        data: { batchId, status: "AI_FAILED", reason, canSendReply: false,
                candidateName: parsed.name, phoneNormalized: normalizePhoneNumber(parsed.phone),
                errorMessage: aiErrorDetail },
      });
      return NextResponse.json({
        processingLogId: log.id, candidateId: null, candidateNumber: null,
        canSendReply: false, reason, status: "AI_FAILED",
      });
    }

    // ---- 二重処理チェック（30分ウィンドウ） ----
    const phoneNormalized = normalizePhoneNumber(parsed.phone);
    if (phoneNormalized) {
      const dup = await checkDuplicateProcessing(phoneNormalized);
      if (dup) {
        const log = await prisma.mynaviRpaProcessingLog.create({ ... });
        return NextResponse.json({ ..., status: "DUPLICATE_SKIP" });
      }
    }

    // ---- 送信可否判定（年齢・外国籍） ----
    const age = calculateAge(parsed.birthDate);
    const ageNg = isAgeNg(parsed.birthDate);
    const foreignNg = isForeignNg(last, first);
    // status: "NORMAL" | "AGE_NG" | "FOREIGN_NG"

    // ---- Candidate 新規登録 ----
    const candidateNumber = await generateNextCandidateNumber();
    const candidate = await prisma.candidate.create({
      data: {
        candidateNumber,
        name: parsed.name,
        ...(parsed.nameKana ? { nameKana: parsed.nameKana } : {}),
        ...(parsed.gender ? { gender: parsed.gender } : {}),
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(phoneNormalized ? { phone: phoneNormalized } : {}),
        ...(parsed.address ? { address: parsed.address } : {}),
        ...(recruiterName?.trim() ? { recruiterName: recruiterName.trim() } : {}),
        applicationRoute: "スカウト",
        mediaSource: "マイナビ転職",
        birthday: parsed.birthDate,
      },
    });

    // ---- PDF を Google Drive に保存 ----
    const parentFolderId = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID;
    const folderId = await getOrCreateFolder(candidate.id, parentFolderId);
    const uploaded = await uploadFileToDrive(pdfFileName, pdfBuffer, folderId, "application/pdf");
    await prisma.candidateFile.create({
      data: {
        candidateId: candidate.id, category: "ORIGINAL",
        fileName: pdfFileName, fileSize: pdfBuffer.length,
        mimeType: "application/pdf", driveFileId: uploaded.fileId,
        driveViewUrl: uploaded.webViewLink, driveFolderId: folderId,
        memo: "マイナビRPA自動取り込み", uploadedByUserId: systemUserId,
      },
    });

    // ---- ProcessingLog 記録 + supportSubStatus 再計算 ----
    await prisma.mynaviRpaProcessingLog.create({ ... });
    await recalculateSubStatusIfAuto(candidate.id);

    return NextResponse.json({
      processingLogId: log.id, candidateId: candidate.id,
      candidateNumber, canSendReply, reason, status,
    });
  } catch (e) { ... }
}
```

### PDF 保管場所
- **保存先**: Google Drive（`GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID` 配下の求職者別フォルダ）
- **メタデータ**: `CandidateFile` テーブル（`driveFileId`, `driveViewUrl`, `driveFolderId`）
- **DB に Base64 保存ではない**

### candidateNumber の管理
- `Candidate.candidateNumber`（unique）に保存
- 採番ロジック: `generateNextCandidateNumber()` で 5000000〜5899999 の最大値+1
- マイナビ求職者番号ではなく portal 独自の番号

### 手動フロー vs T-062 RPA フローの差分

| 観点 | 手動フロー（CandidateRegistrationModal） | T-062 RPA フロー（pdf-upload） |
|--|--|--|
| AI解析 | parse-resume API（Gemini直接呼び出し） | `parseResumeWithGemini()`（同一プロンプト） |
| 解析→登録 | 2ステップ（フォーム自動入力→ユーザー確認→登録ボタン） | 1ステップ（API内で自動完結） |
| 認証 | セッション認証（getSessionUser） | RPA シークレット（x-rpa-secret） |
| 担当CA | ユーザーが選択 | **未設定**（employeeId = null） |
| 経路/媒体 | ユーザーが選択 | 固定（スカウト / マイナビ転職） |
| PDF保存先 | files/upload API → category: "MEETING" | Google Drive 直接 → category: "ORIGINAL" |
| 判定ロジック | なし | 年齢NG（40歳以上）、外国籍NG、二重処理チェック |
| バッチ管理 | なし | RpaExecutionBatch + MynaviRpaProcessingLog |
| 通知 | なし | LINE WORKS 通知 |

---

## 調査4: 自動発火経路候補評価

### 前提の再整理

T-062 の `pdf-upload` API は **既に「PDF受領 → AI解析 → 判定 → Candidate登録 → Drive保存」を一気通貫で実行している**。つまり、PAD フローが pdf-upload を叩いた時点で求職者登録まで完了している。

元のタスク背景にあった「アップロードされた PDF から求職者情報を抽出し、portal の求職者レコードとして自動登録するフロー」は **既に T-062 で実装済み**。

### 想定される Phase 2 の本来のゴール

T-062 の既存フローでカバーされていない追加要件があるとすれば:

1. **担当 CA の自動割り当て**（現状 employeeId = null で登録される）
2. **AI解析の精度向上**（追加フィールド抽出、異なるプロンプト）
3. **他媒体への拡張**（マイナビ以外の PDF への対応）
4. **AI解析結果のレビュー/承認フロー**（手動確認ステップの追加）

### 経路候補の再評価

| 案 | 概要 | 想定実装量 | 評価 |
|--|--|--|--|
| A: PAD で画面操作（UI 自動化） | 手動フロー（CandidateRegistrationModal）をブラウザ操作で再現 | 大（PAD シナリオ構築 + ブラウザ操作は脆弱） | **非推奨**: T-062 の pdf-upload API が既に同等以上の機能を持つため不要 |
| B: 新 API 追加 | 不要。既存の `/api/rpa/mynavi/pdf-upload` が該当機能を持つ | 小（既存 API の微修正で対応可能） | **推奨**: 既存 API に不足機能（担当CA割り当て等）を追加する形 |
| C: アップロード完了トリガーで自動実行 | 不要。pdf-upload API 内で既に自動実行されている | - | **不要**: 既に実現済み |

### 推奨方針

**既存の pdf-upload API を拡張する形**で不足機能を追加するのが最も効率的。
- 変更箇所: `src/app/api/rpa/mynavi/pdf-upload/route.ts`（1ファイル）
- 既存コードへの影響: 最小限（追加フィールドの処理追加のみ）
- 失敗時のリカバリ: `MynaviRpaProcessingLog` で追跡可能（既存）
- Phase 2 実装所要: **小**

---

## 調査5: 抽出フィールド一覧

### AI 解析プロンプトが抽出するフィールド

プロンプト本文: `src/lib/gemini-resume-parser.ts` L25-L49（`RESUME_PROMPT` 定数）
同一プロンプトは `src/app/api/candidates/parse-resume/route.ts` L50-L74 にもインライン記述。

```
以下はWEB履歴書（転職サイトの登録情報）のPDFから抽出したテキストです。
以下の項目を抽出し、JSON形式で返却してください。

## 抽出項目（個人情報）
- name: 氏名（姓と名の間に半角スペース）
- furigana: フリガナ（カタカナ、姓と名の間に半角スペース）
- gender: 性別（"male" or "female"）
- birthday: 生年月日（YYYY-MM-DD形式）
- email: メールアドレス
- phone: 電話番号（ハイフンなし、数字のみ）
- address: 住所（都道府県から）

## 抽出項目（希望条件 - 該当セクションがあれば）
- desiredJobType1: 希望職種の第1希望（例 営業事務・営業アシスタント）
- desiredJobType2: 希望職種の第2希望（例 一般事務・庶務）
- desiredIndustry1: 希望業種の第1希望
- desiredPrefecture: 希望勤務地の都道府県（例 神奈川県）
- desiredEmploymentType: 希望雇用形態（正社員/契約社員/派遣社員/パート・アルバイト/業務委託/その他 のいずれか）
- desiredSalaryMin: 希望年収の下限（万円単位の整数、例 450）

## ルール
- テキストに含まれない項目はnullにする
- 推測で値を補完しない
- JSON以外の文字は出力しない（```jsonなどのマークダウンも不要）
- 性別は "male" または "female" で出力する
```

### フィールドマッピング表

| AI 抽出フィールド | 型 | Candidate DB カラム | RPA フローで保存 | 手動フローで保存 | 備考 |
|--|--|--|--|--|--|
| name | string | `name` | YES | YES | 必須（null なら AI_FAILED） |
| furigana | string | `nameKana` | YES | YES | |
| gender | string | `gender` | YES | YES | "male" / "female" |
| birthday | string→Date | `birthday` | YES | YES | 必須（null なら AI_FAILED） |
| email | string | `email` | YES | YES | |
| phone | string | `phone` | YES（正規化済み） | YES | RPA では `normalizePhoneNumber()` 適用 |
| address | string | `address` | YES | YES | |
| desiredJobType1 | string | **保存されない** | NO | NO | AI は抽出するが DB カラムなし |
| desiredJobType2 | string | **保存されない** | NO | NO | 同上 |
| desiredIndustry1 | string | **保存されない** | NO | NO | 同上 |
| desiredPrefecture | string | **保存されない** | NO | NO | 同上 |
| desiredEmploymentType | string | **保存されない** | NO | NO | 同上 |
| desiredSalaryMin | number | **保存されない** | NO | NO | 同上 |

### 求職者テーブルのスキーマ定義

```prisma
// prisma/schema.prisma L230-L279
model Candidate {
  id                     String    @id @default(cuid())
  candidateNumber        String    @unique @map("candidate_number")
  name                   String
  nameKana               String?   @map("name_kana")
  gender                 String? // "male" | "female" | "other"
  email                  String?
  phone                  String?
  address                String?
  birthday               DateTime?
  supportStatus          String    @default("BEFORE") @map("support_status")
  supportSubStatus       String?   @map("support_sub_status")
  supportSubStatusManual Boolean   @default(false) @map("support_sub_status_manual")
  supportEndReason       String?   @map("support_end_reason")
  supportEndNote         String?   @map("support_end_note")
  supportEndDate         DateTime? @map("support_end_date")
  supportEndComment      String?   @map("support_end_comment") @db.Text

  employeeId String?   @map("employee_id")
  employee   Employee? @relation(fields: [employeeId], references: [id])

  recruiterName    String? @map("recruiter_name")
  applicationRoute String? @map("application_route")
  mediaSource      String? @map("media_source")

  guideEntries           GuideEntry[]
  notes                  CandidateNote[]
  jimuSessions           JimuSession[]
  tasks                  Task[]
  files                  CandidateFile[]
  advisorSessions        AdvisorChatSession[]
  jobEntries             JobEntry[]
  hiddenJobIntroductions HiddenJobIntroduction[]
  candidateJobResponses  CandidateJobResponse[]
  shareLinks             FileShareLink[]
  interviewRecords       InterviewRecord[]
  candidateMemos         CandidateMemo[]
  settingsHistories      CandidateSettingsHistory[]
  mynaviProcessingLogs   MynaviRpaProcessingLog[]
  bsDocumentFolders      BSDocumentFolder[]

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("candidates")
}
```

---

## 調査6: 課題一覧と判定

| # | 課題 | 内容 | 判定 |
|--|--|--|--|
| 1 | **担当CA未設定** | RPA フローで登録された求職者の `employeeId` が null。手動フローでは必須。 | 今 Phase 同梱（pdf-upload API に `employeeId` パラメータ追加 or デフォルト担当CA設定） |
| 2 | **希望条件フィールドが DB 未保存** | AI は desiredJobType1 等を抽出するが Candidate テーブルに該当カラムがない | 後 Phase 送り（DB マイグレーション + UI 対応が必要で規模が大きい） |
| 3 | **parse-resume API にプロンプト重複** | `parse-resume/route.ts` と `gemini-resume-parser.ts` に同一プロンプトが二重定義 | 後 Phase 送り（リファクタ案件。動作に影響なし） |
| 4 | **手動フローの PDF カテゴリ不一致** | 手動フローでは PDF を `category: "MEETING"` で保存、RPA では `category: "ORIGINAL"`。MEETING は不適切 | 後 Phase 送り（手動フロー側の修正。本タスクのスコープ外） |
| 5 | **supportStatus 初期値** | RPA フローでは `supportStatus` がデフォルト "BEFORE" のまま。手動フローではユーザーが選択 | 不要（"BEFORE" がデフォルトで正しい。CA が後から変更する運用） |
| 6 | **phone 正規化の差異** | 手動フローでは `phone` をそのまま保存、RPA フローでは `normalizePhoneNumber()` を適用 | 不要（RPA フロー側が正しい。手動フローの修正は別タスク） |
| 7 | **バッチ管理の必須化** | pdf-upload は `batchId` 必須。単発呼び出し用に batchId なしでも動く API が必要か | 今 Phase 同梱（Phase 2 で新 API を検討する場合に対応） |
| 8 | **外国籍判定の精度** | カタカナ/英語のみで外国籍判定。帰化日本人や在日外国人の判定精度に課題あり | 不要（既知の制約。現状の判定ロジックで運用上問題なし） |
| 9 | **Gemini API エラー時のリトライ** | AI解析失敗時にリトライなし。一時的なAPI障害でスキップされる | 後 Phase 送り（リトライキューの実装が必要で規模が大きい） |
| 10 | **T-063 の本来の目的の再確認** | T-062 が既に一気通貫フローを持つため、T-063 で追加すべき機能の明確化が必要 | 今 Phase 同梱（Phase 2 開始前にスコープ再定義が必要） |

---

## Phase 2 実装方針推奨案

### 結論

**T-062 の `pdf-upload` API は既に「PDF → AI解析 → 判定 → Candidate 登録 → Drive 保存」を一気通貫で実行している。**

T-063 の当初想定（「アップロード済み PDF を AI 解析ボタン相当の処理に流し込む」）は、既存の pdf-upload API が API 内部で完結させているため、**追加の自動発火実装は不要**。

### Phase 2 で取り組むべき実際の課題

T-063 として価値のある追加実装は以下に絞られる:

1. **担当 CA の自動割り当て**: pdf-upload API に `employeeId` パラメータを追加するか、デフォルト担当CA を設定する仕組みの追加
2. **バッチなし単発 API**: `batchId` を不要にした簡易版エンドポイント（他媒体からの呼び出し用）
3. **スコープ再定義**: T-062 で既に実現済みの機能を踏まえ、T-063 のゴールを再設定

### 経路図（現状）

```
PAD フロー
  │
  ├─ batch-start → RpaExecutionBatch 作成
  │
  ├─ [ループ] pdf-upload
  │     ├─ parseResumeWithGemini(pdfBuffer)  ← AI解析
  │     ├─ parseResumeData(resumeData)       ← フィールド正規化
  │     ├─ isAgeNg / isForeignNg             ← 送信可否判定
  │     ├─ checkDuplicateProcessing          ← 重複チェック
  │     ├─ prisma.candidate.create()         ← ★求職者登録
  │     ├─ uploadFileToDrive()               ← Google Drive 保存
  │     ├─ prisma.candidateFile.create()     ← ファイルメタデータ登録
  │     └─ MynaviRpaProcessingLog 記録
  │
  ├─ [ループ] reply-sent（canSendReply=true のもの）
  │
  └─ batch-finish → 集計 + LINE WORKS 通知
```

この経路は **既に完全に動作している**。Phase 2 は「この経路に何を足すか」の判断から始める。
