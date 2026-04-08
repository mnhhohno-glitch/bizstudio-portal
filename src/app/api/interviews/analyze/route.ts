import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const maxDuration = 300;

const GEMINI_MODEL = "gemini-3-flash-preview";

const ANALYZE_PROMPT = `あなたは人材紹介会社のキャリアアドバイザーのアシスタントです。
面談の文字起こしテキストとWEB履歴書PDFから、面談情報を構造化JSONとして抽出してください。

## 出力形式
以下のJSON形式で出力してください。JSONのみ出力し、マークダウンのコードブロック記法は使わないこと。
値が不明・読み取れない項目はnullにしてください。

{
  "interviewMemo": "面談の要約メモ（300-500字程度。面談で話された主要な内容をまとめる）",
  "summaryText": "初回面談まとめ（求職者の経歴・希望・人物像を簡潔にまとめた文章。500字程度）",
  "detail": {
    "agentUsageFlag": "初めて利用 | 利用中 | 過去利用あり | null",
    "agentUsageMemo": "エージェント利用に関する補足",
    "employmentStatus": "在職中 | 離職中 | 退職予定 | null",
    "jobChangeTimeline": "1カ月以内 | 3カ月以内 | 半年以内 | 未定 | null",
    "jobChangeTimelineMemo": "転職時期の補足",
    "activityPeriod": "1週間以内 | 1カ月以内 | 3カ月以内 | null",
    "activityPeriodMemo": "活動期間の補足",
    "currentApplicationCount": "現在の応募数（数値またはnull）",
    "applicationTypeFlag": "検討中 | 応募中 | null",
    "applicationMemo": "応募状況の補足",
    "educationFlag": "大卒 | 短大・専門卒 | 高卒 | 大学院卒 | null",
    "educationMemo": "学歴の補足（学校名・学部等）",
    "graduationDate": "卒業年月（例: 2020年3月）",
    "companyName": "現在（直近）の会社名",
    "businessContent": "会社の事業内容",
    "tenure": "在籍期間（例: 2020年4月〜現在）",
    "jobTypeFlag": "職種カテゴリ",
    "jobTypeMemo": "職種の詳細",
    "resignReasonLarge": "退職理由（大分類）",
    "resignReasonMedium": "退職理由（中分類）",
    "resignReasonSmall": "退職理由（小分類）",
    "jobChangeReasonMemo": "転職理由の詳細",
    "jobChangeAxisFlag": "転職軸の分類",
    "jobChangeAxisMemo": "転職軸の詳細",
    "desiredJobType1": "第一希望職種",
    "desiredJobType1Memo": "職種希望の補足",
    "desiredJobType2": "第二希望職種",
    "desiredIndustry1": "希望業界",
    "desiredIndustry1Memo": "業界希望の補足",
    "desiredArea": "希望エリア（首都圏 | 関西 | 等）",
    "desiredPrefecture": "希望都道府県",
    "desiredCity": "希望市区町村",
    "desiredAreaMemo": "エリア希望の補足",
    "currentSalary": "現在年収（万円単位の数値、例: 350）",
    "currentSalaryMemo": "現在年収の補足",
    "desiredSalaryMin": "希望年収下限（万円単位の数値）",
    "desiredSalaryMinMemo": "下限の補足",
    "desiredSalaryMax": "希望年収上限（万円単位の数値）",
    "desiredSalaryMaxMemo": "上限の補足",
    "desiredDayOff": "希望休日（土日祝 | シフト制 等）",
    "desiredDayOffMemo": "休日希望の補足",
    "desiredHolidayCount": "希望年間休日数",
    "desiredOvertimeMax": "希望残業上限",
    "desiredOvertimeMemo": "残業の補足",
    "desiredTransfer": "転勤可否（可 | 不可 | 条件付き可）",
    "desiredTransferMemo": "転勤の補足",
    "workStyleFlags": "働き方（カンマ区切り。例: リモート可,フレックス）",
    "companyFeatureFlags": "会社特徴（カンマ区切り。例: 上場企業,ベンチャー）",
    "priorityCondition1": "優先条件1位",
    "priorityCondition2": "優先条件2位",
    "priorityCondition3": "優先条件3位",
    "priorityConditionMemo": "優先条件の補足",
    "driverLicenseFlag": "普通自動車免許 | なし | null",
    "driverLicenseMemo": "免許の補足",
    "languageSkillFlag": "英語力レベル",
    "languageSkillMemo": "語学力の補足",
    "japaneseSkillFlag": "日本語レベル（外国籍の場合）",
    "japaneseSkillMemo": "日本語力の補足"
  }
}

## ルール
- 面談テキストから読み取れる情報を優先する
- PDF履歴書は学歴・職歴・スキルの補完に使う
- 推測で補完しない。読み取れない情報はnullにする
- 年収は数値（万円単位）で返す
- 面談メモは面談で話された内容の要約、初回面談まとめは求職者のプロフィールまとめ`;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY が未設定です" }, { status: 500 });

  const formData = await request.formData();
  const transcript = formData.get("transcript") as string | null;
  const resumePdf = formData.get("resumePdf") as File | null;

  console.log("[analyze] Request received:", {
    hasTranscript: !!transcript,
    transcriptLength: transcript?.length,
    hasPdf: !!resumePdf,
    pdfSize: resumePdf?.size,
  });

  if (!transcript && !resumePdf) {
    return NextResponse.json({ error: "テキストまたはPDFを入力してください" }, { status: 400 });
  }

  // Build Gemini request parts
  const parts: Array<Record<string, unknown>> = [];

  if (resumePdf) {
    const buffer = Buffer.from(await resumePdf.arrayBuffer());
    parts.push({
      inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") },
    });
  }

  let textContent = ANALYZE_PROMPT + "\n\n";
  if (transcript) {
    textContent += `## 面談文字起こしテキスト\n${transcript}\n\n`;
  }
  if (resumePdf) {
    textContent += "## 添付PDF履歴書\n上記のPDFファイルも参照して情報を抽出してください。\n";
  }

  parts.push({ text: textContent });

  console.log("[analyze] Calling Gemini API, parts count:", parts.length, "text length:", textContent.length);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[InterviewAnalyze] Gemini error:", response.status, errText);
      return NextResponse.json({ error: "AI解析に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("[analyze] Gemini response length:", rawText.length, "preview:", rawText.substring(0, 300));

    // Parse JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[analyze] No JSON in response:", rawText.substring(0, 500));
      return NextResponse.json({ error: "AI応答のパースに失敗しました" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log("[analyze] Parsed fields:", Object.keys(parsed), "detail keys:", parsed.detail ? Object.keys(parsed.detail).length : 0);
    return NextResponse.json(parsed);
  } catch (e) {
    console.error("[analyze] Error:", e instanceof Error ? e.message : e, e instanceof Error ? e.stack : "");
    return NextResponse.json({ error: "AI解析に失敗しました" }, { status: 500 });
  }
}
