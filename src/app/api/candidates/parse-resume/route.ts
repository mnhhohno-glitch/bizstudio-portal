import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { findMatchingSlot } from "@/lib/scout/auto-link";
import { recordGeminiUsage } from "@/lib/ai-usage";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * "YYYY-MM-DD"（AI抽出の応募日）を Date(UTC 00:00) に変換する。
 * JST暦日として扱うため Date.UTC を使う（罠#17: toISOString().slice は使わない）。
 * 不正・null は null を返す（推測で埋めない）。
 */
function parseYmdToDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}

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
- desiredIndustry2: 希望業種の第2希望
- desiredPrefecture1: 希望勤務地の第1希望（都道府県、例 神奈川県）
- desiredPrefecture2: 希望勤務地の第2希望（都道府県、例 東京都）
- desiredEmploymentType: 希望雇用形態（正社員/契約社員/派遣社員/パート・アルバイト/業務委託/その他 のいずれか）
- desiredSalaryMin: 希望年収の下限（万円単位の整数、例 450）

## 抽出項目（応募情報 - 該当セクションがあれば）
- consultantName: コンサルタント名（スカウト配信者の氏名、例「藤本なつみ」）
- applicationRoute: 応募経路（マイナビ転職スカウト経由なら「スカウト」、それ以外は推定可能なら値、不明なら null）
- mediaSource: 媒体名（PDFが「マイナビ転職」のWEB履歴書なら「マイナビ転職」、それ以外は推定可能なら値、不明なら null）
- applicationDate: 応募日（PDFの「応募内容」枠に記載された応募日時から日付部分を抽出し YYYY-MM-DD 形式で返す。時刻は不要。記載が見つからなければ null。推測で埋めない）

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
            maxOutputTokens: 4000,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error("Gemini API error:", response.status);
      return NextResponse.json({ error: "PDF解析に失敗しました" }, { status: 500 });
    }

    const data = await response.json();

    // T-135: 費用記録（fire-and-forget）。空レスポンスで return する前に記録する。
    void recordGeminiUsage({
      system: "portal",
      endpoint: "candidate-resume-parse",
      model: "gemini-3-flash-preview",
      usage: data?.usageMetadata,
      meta: { caller: "candidate-register-modal", pdfBytes: fileBuffer.length },
    });

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return NextResponse.json({ error: "PDF解析に失敗しました" }, { status: 500 });
    }

    // JSONをパース（```jsonラッパーがある場合も対応）
    const jsonStr = rawText.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("Parse resume JSON parse failed:", {
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        rawTextLength: rawText.length,
        rawTextTail: rawText.slice(-200),
      });
      return NextResponse.json({ error: "PDF解析に失敗しました（応答形式エラー）" }, { status: 500 });
    }

    // ---- 応募日 / MAS種別 / 配信日 を算出（pdf-upload と同じ方針）----
    const applicationDate: string | null = parsed.applicationDate || null;
    const recruiterName: string | null = parsed.consultantName || null;
    // T-067 Phase2a: 旧「1号機=開放日」判定を廃止。モーダルは配信日(Excel)・登録日を持たないため masType は null（CAが手入力）。
    const masType: string | null = null;
    let scoutDeliveryDate: string | null = null;
    if (recruiterName?.trim()) {
      // 配信日: 応募日が取れた場合のみ 担当RC＋応募日 で配信枠を引く（モーダルのプレビュー用。Phase2bで見直し）
      const appDate = parseYmdToDate(applicationDate);
      if (appDate) {
        try {
          const matched = await findMatchingSlot({
            recruiterName: recruiterName.trim(),
            applicationDate: appDate,
          });
          if (matched?.deliveryDate) {
            // JST暦日で YYYY-MM-DD に整形（罠#17: toISOString().slice は使わない）
            scoutDeliveryDate = matched.deliveryDate.toLocaleDateString("sv-SE", {
              timeZone: "Asia/Tokyo",
            });
          }
        } catch (e) {
          console.error("[parse-resume] findMatchingSlot failed:", e);
        }
      }
    }

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
      desiredIndustry2: parsed.desiredIndustry2 || null,
      desiredPrefecture1: parsed.desiredPrefecture1 || null,
      desiredPrefecture2: parsed.desiredPrefecture2 || null,
      desiredEmploymentType: parsed.desiredEmploymentType || null,
      desiredSalaryMin: typeof parsed.desiredSalaryMin === "number" ? parsed.desiredSalaryMin : null,
      consultantName: parsed.consultantName || null,
      applicationRoute: parsed.applicationRoute || null,
      mediaSource: parsed.mediaSource || null,
      applicationDate,
      masType,
      scoutDeliveryDate,
    });
  } catch (error) {
    console.error("Parse resume error:", error);
    return NextResponse.json({ error: "PDF解析に失敗しました" }, { status: 500 });
  }
}
