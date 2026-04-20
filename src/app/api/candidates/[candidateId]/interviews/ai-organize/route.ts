import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

function fmtSalary(v: number | null | undefined): string {
  if (v == null) return "";
  return `${v}万円`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPrompt(form: Record<string, any>, detail: Record<string, any>, rating: Record<string, any>, memos: { title: string; content: string; flag: string }[], candidate: { name?: string; candidateNumber?: string } | null): string {
  const d = detail || {};
  const r = rating || {};
  const sections: string[] = [];

  sections.push(`【面談基本情報】
・面談日: ${form.interviewDate || "未設定"}
・面談回数: ${form.interviewCount ?? "-"}回目
・面談種別: ${form.interviewType || "未設定"}
・面談手法: ${form.interviewTool || "未設定"}
・結果: ${form.resultFlag || "未設定"}
・求職者名: ${candidate?.name || "不明"}${candidate?.candidateNumber ? `（ID: ${candidate.candidateNumber}）` : ""}`);

  if (form.interviewMemo || form.summaryText) {
    sections.push(`【面談メモ・サマリ】
${form.interviewMemo || ""}
${form.summaryText ? `\nサマリ: ${form.summaryText}` : ""}`);
  }

  if (memos && memos.length > 0) {
    const memoLines = memos.map((m) => `・[${m.flag}] ${m.title}: ${m.content}`).join("\n");
    sections.push(`【面談メモ一覧】\n${memoLines}`);
  }

  const career = [
    d.agentUsageFlag && `・他AG状況: ${d.agentUsageFlag}${d.agentUsageMemo ? ` (${d.agentUsageMemo})` : ""}`,
    d.jobChangeTimeline && `・転職時期: ${d.jobChangeTimeline}${d.jobChangeTimelineMemo ? ` (${d.jobChangeTimelineMemo})` : ""}`,
    d.activityPeriod && `・活動期間: ${d.activityPeriod}${d.activityPeriodMemo ? ` (${d.activityPeriodMemo})` : ""}`,
    d.applicationTypeFlag && `・他社応募: ${d.applicationTypeFlag}${d.currentApplicationCount ? ` ${d.currentApplicationCount}社` : ""}${d.applicationMemo ? ` (${d.applicationMemo})` : ""}`,
    d.employmentStatus && `・就業状況: ${d.employmentStatus}`,
  ].filter(Boolean);
  if (career.length > 0) sections.push(`【転職活動状況】\n${career.join("\n")}`);

  const job = [
    d.companyName && `・企業名: ${d.companyName}${d.tenure ? ` (${d.tenure})` : ""}`,
    d.businessContent && `・会社概要: ${d.businessContent}`,
    d.jobTypeFlag && `・職種: ${d.jobTypeFlag}${d.jobTypeMemo ? ` ${d.jobTypeMemo}` : ""}`,
    d.careerSummary && `・業務内容: ${d.careerSummary}`,
    d.resignReasonLarge && `・退社理由: ${[d.resignReasonLarge, d.resignReasonMedium, d.resignReasonSmall].filter(Boolean).join(" / ")}`,
    d.jobChangeReasonMemo && `・転職理由詳細: ${d.jobChangeReasonMemo}`,
    d.educationFlag && `・学歴: ${d.educationFlag}${d.educationMemo ? ` ${d.educationMemo}` : ""}`,
  ].filter(Boolean);
  if (job.length > 0) sections.push(`【職務経歴】\n${job.join("\n")}`);

  const desired = [
    d.desiredJobType1 && `・希望職種: ${d.desiredJobType1}${d.desiredJobType2 ? `, ${d.desiredJobType2}` : ""}`,
    d.desiredIndustry1 && `・希望業種: ${d.desiredIndustry1}`,
    (d.desiredArea || d.desiredPrefecture) && `・希望エリア: ${[d.desiredArea, d.desiredPrefecture, d.desiredCity].filter(Boolean).join(" ")}`,
    d.currentSalary && `・現年収: ${fmtSalary(d.currentSalary)}`,
    (d.desiredSalaryMin || d.desiredSalaryMax) && `・希望年収: ${fmtSalary(d.desiredSalaryMin)}〜${fmtSalary(d.desiredSalaryMax)}`,
    d.desiredDayOff && `・休日: ${d.desiredDayOff}`,
    d.desiredOvertimeMax && `・残業: ${d.desiredOvertimeMax}`,
    d.desiredTransfer && `・転勤: ${d.desiredTransfer}`,
    d.priorityCondition1 && `・優先条件: ${[d.priorityCondition1, d.priorityCondition2, d.priorityCondition3].filter(Boolean).join(", ")}`,
    d.priorityConditionMemo && `・条件メモ: ${d.priorityConditionMemo}`,
  ].filter(Boolean);
  if (desired.length > 0) sections.push(`【希望条件】\n${desired.join("\n")}`);

  const ratingItems = [
    r.personalityMotivation != null && `・転職意欲: ${r.personalityMotivation}/5${r.personalityMotivationMemo ? ` (${r.personalityMotivationMemo})` : ""}`,
    r.personalityCommunication != null && `・コミュニケーション: ${r.personalityCommunication}/5${r.personalityCommunicationMemo ? ` (${r.personalityCommunicationMemo})` : ""}`,
    r.personalityManner != null && `・マナー: ${r.personalityManner}/5`,
    r.personalityIntelligence != null && `・理解力: ${r.personalityIntelligence}/5`,
    r.personalityHumanity != null && `・人間性: ${r.personalityHumanity}/5`,
    r.overallRank && `・総合ランク: ${r.overallRank}`,
  ].filter(Boolean);
  if (ratingItems.length > 0) sections.push(`【評価】\n${ratingItems.join("\n")}`);

  const action = [
    d.documentStatusFlag && `・書類状況: ${d.documentStatusFlag}${d.documentStatusMemo ? ` (${d.documentStatusMemo})` : ""}`,
    d.documentSupportFlag && `・書類サポート: ${d.documentSupportFlag}`,
    d.contactMethod && `・連絡方法: ${d.contactMethod}`,
    d.jobReferralFlag && `・求人送付: ${d.jobReferralFlag}${d.jobReferralMemo ? ` (${d.jobReferralMemo})` : ""}`,
    d.nextInterviewFlag && `・次回面談: ${d.nextInterviewFlag}${d.nextInterviewDate ? ` ${String(d.nextInterviewDate).slice(0, 10)}` : ""}`,
    d.nextAction && `・現在のネクストアクション: ${d.nextAction}`,
  ].filter(Boolean);
  if (action.length > 0) sections.push(`【現在のアクション状況】\n${action.join("\n")}`);

  return sections.join("\n\n");
}

const SYSTEM_PROMPT = `あなたは人材紹介会社のキャリアアドバイザー（CA）のアシスタントです。
以下の面談記録をもとに、CAが次に取るべきアクションを整理してください。

ルール:
- マークダウン記法（##、**、- など）は使わない
- 通常の文章と改行で整理する
- カテゴリごとに分けて見出しは「【】」で囲む
- 各項目は「・」で箇条書きにする
- 具体的で実行可能なアクションを提案する
- 面談内容に基づいた提案のみ行い、一般的なアドバイスは避ける
- データが不足している場合はその旨を明記し、次回面談でのヒアリング項目として提案する
- 簡潔に、余計な前置きや説明は不要

出力形式:
【最優先（今週中）】
・（具体的なアクション）
・...

【重要（2週間以内）】
・...

【継続フォロー】
・...`;

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { form, detail, rating, memos, candidate } = body as {
    form: Record<string, unknown>;
    detail: Record<string, unknown>;
    rating: Record<string, unknown>;
    memos: { title: string; content: string; flag: string }[];
    candidate: { name?: string; candidateNumber?: string } | null;
  };

  if (!form) {
    return NextResponse.json({ error: "フォームデータがありません" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEYが設定されていません" }, { status: 500 });
  }

  const interviewData = buildPrompt(form, detail || {}, rating || {}, memos || [], candidate);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n【面談記録】\n${interviewData}` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      console.error("Gemini API error:", await response.text());
      return NextResponse.json({ error: "AI整理に失敗しました。しばらく経ってから再度お試しください" }, { status: 500 });
    }

    const data = await response.json();
    const suggestions = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!suggestions) {
      return NextResponse.json({ error: "AI整理に失敗しました。しばらく経ってから再度お試しください" }, { status: 500 });
    }

    return NextResponse.json({ suggestions });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json({ error: "AI整理がタイムアウトしました。再度お試しください" }, { status: 504 });
    }
    console.error("Gemini API error:", error);
    return NextResponse.json({ error: "AI整理に失敗しました。しばらく経ってから再度お試しください" }, { status: 500 });
  }
}
