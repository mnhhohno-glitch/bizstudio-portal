import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import React from "react";
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import path from "path";

type RouteContext = {
  params: Promise<{ candidateId: string; interviewId: string }>;
};

Font.register({
  family: "NotoSansJP",
  src: path.join(process.cwd(), "public", "fonts", "NotoSansJP-Regular.ttf"),
});

const C = {
  navy: "#1e3a5f",
  dark: "#374151",
  mid: "#6b7280",
  light: "#f3f4f6",
  blue: "#e8f4fd",
  border: "#d1d5db",
  white: "#ffffff",
};

const s = StyleSheet.create({
  page: { fontFamily: "NotoSansJP", fontSize: 9, color: C.dark, paddingTop: 28, paddingBottom: 36, paddingHorizontal: 28 },
  header: { backgroundColor: C.navy, padding: 14, marginBottom: 14, borderRadius: 4 },
  headerTitle: { fontSize: 14, color: C.white, fontWeight: 700 },
  headerSub: { fontSize: 9, color: "#cbd5e1", marginTop: 4 },
  section: { marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontWeight: 700, color: C.navy, borderBottomWidth: 1, borderBottomColor: C.navy, paddingBottom: 3, marginBottom: 6 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 80, fontSize: 8, color: C.mid, paddingVertical: 2 },
  labelWide: { width: 110, fontSize: 8, color: C.mid, paddingVertical: 2 },
  value: { flex: 1, fontSize: 9, color: C.dark, paddingVertical: 2 },
  grid2: { flexDirection: "row", gap: 8 },
  gridCell: { flex: 1 },
  card: { backgroundColor: C.light, borderRadius: 3, padding: 8, marginBottom: 4 },
  cardTitle: { fontSize: 9, fontWeight: 700, color: C.dark, marginBottom: 4 },
  text: { fontSize: 9, color: C.dark, lineHeight: 1.5 },
  textSmall: { fontSize: 8, color: C.mid },
  memoCard: { backgroundColor: C.light, borderRadius: 3, padding: 6, marginBottom: 4 },
  memoHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  ratingRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.border, paddingVertical: 3 },
  ratingLabel: { width: 120, fontSize: 8, color: C.mid },
  ratingScore: { width: 30, fontSize: 9, fontWeight: 700, textAlign: "center" },
  ratingMemo: { flex: 1, fontSize: 8, color: C.dark },
  footer: { position: "absolute", bottom: 16, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7, color: C.mid },
});

function R({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  if (!value) return null;
  return (
    <View style={s.row}>
      <Text style={wide ? s.labelWide : s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
}

function fmtSalary(v: number | null | undefined): string {
  if (v == null) return "";
  return `${v}万円`;
}

function genderLabel(g: string | null): string {
  if (!g) return "";
  switch (g) { case "male": return "男性"; case "female": return "女性"; case "other": return "その他"; default: return ""; }
}

function calcAge(bd: string | Date | null): string {
  if (!bd) return "";
  const today = new Date();
  const birth = new Date(bd);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${age}歳`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function InterviewPDF({ record, detail, rating, memos }: { record: any; detail: any; rating: any; memos: any[] }) {
  const d = detail || {};
  const r = rating || {};
  const c = record.candidate || {};
  const now = new Date();

  const ratingRows = [
    { label: "転職意欲", score: r.personalityMotivation, memo: r.personalityMotivationMemo },
    { label: "コミュニケーション", score: r.personalityCommunication, memo: r.personalityCommunicationMemo },
    { label: "マナー", score: r.personalityManner, memo: r.personalityMannerMemo },
    { label: "理解力", score: r.personalityIntelligence, memo: r.personalityIntelligenceMemo },
    { label: "人間性", score: r.personalityHumanity, memo: r.personalityHumanityMemo },
    { label: "人物合計", score: r.personalityTotal, memo: r.personalityTotalMemo },
    { label: "職種マッチ", score: r.careerJobType, memo: r.careerJobTypeMemo },
    { label: "経験年数", score: r.careerExperience, memo: r.careerExperienceMemo },
    { label: "転職回数", score: r.careerJobChangeCount, memo: r.careerJobChangeCountMemo },
    { label: "実績", score: r.careerAchievement, memo: r.careerAchievementMemo },
    { label: "資格", score: r.careerQualification, memo: r.careerQualificationMemo },
    { label: "経歴合計", score: r.careerTotal, memo: r.careerTotalMemo },
    { label: "希望職種", score: r.conditionJobType, memo: r.conditionJobTypeMemo },
    { label: "希望年収", score: r.conditionSalary, memo: r.conditionSalaryMemo },
    { label: "希望休日", score: r.conditionHoliday, memo: r.conditionHolidayMemo },
    { label: "希望エリア", score: r.conditionArea, memo: r.conditionAreaMemo },
    { label: "条件柔軟性", score: r.conditionFlexibility, memo: r.conditionFlexibilityMemo },
    { label: "条件合計", score: r.conditionTotal, memo: r.conditionTotalMemo },
  ].filter((x) => x.score != null);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>面談記録　{c.name || ""}</Text>
          <Text style={s.headerSub}>
            ID: {c.candidateNumber || ""} ／ {record.interviewCount || "-"}回目面談 ／ {fmtDate(record.interviewDate)} ／ {record.interviewType || ""} ／ {record.interviewTool || ""}
          </Text>
        </View>

        {/* 面談基本情報 + 求職者情報 */}
        <View style={s.grid2}>
          <View style={s.gridCell}>
            <View style={s.section}>
              <Text style={s.sectionTitle}>面談基本情報</Text>
              <R label="面談日" value={fmtDate(record.interviewDate)} />
              <R label="時刻" value={`${record.startTime || ""} 〜 ${record.endTime || ""}`} />
              <R label="手法" value={record.interviewTool} />
              <R label="種別" value={record.interviewType} />
              <R label="回数" value={record.interviewCount ? `${record.interviewCount}回目` : undefined} />
              <R label="結果" value={record.resultFlag} />
              <R label="状態" value={record.status === "complete" ? "入力済" : "下書き"} />
              <R label="担当CA" value={record.interviewer?.name} />
              {r.overallRank && <R label="総合ランク" value={r.overallRank} />}
              {r.grandTotal != null && <R label="総合点" value={`${r.grandTotal}点`} />}
            </View>
          </View>
          <View style={s.gridCell}>
            <View style={s.section}>
              <Text style={s.sectionTitle}>求職者基本情報</Text>
              <R label="氏名" value={c.name} />
              <R label="フリガナ" value={c.nameKana} />
              <R label="生年月日" value={c.birthday ? `${fmtDate(c.birthday)}（${calcAge(c.birthday)}）` : undefined} />
              <R label="性別" value={genderLabel(c.gender)} />
              <R label="電話" value={c.phone} />
              <R label="メール" value={c.email} />
              <R label="住所" value={c.address} />
            </View>
          </View>
        </View>

        {/* 転職活動状況 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>転職活動状況</Text>
          <R label="他AG状況" value={d.agentUsageFlag ? `${d.agentUsageFlag}${d.agentUsageMemo ? ` (${d.agentUsageMemo})` : ""}` : undefined} />
          <R label="転職時期" value={d.jobChangeTimeline ? `${d.jobChangeTimeline}${d.jobChangeTimelineMemo ? ` (${d.jobChangeTimelineMemo})` : ""}` : undefined} />
          <R label="活動期間" value={d.activityPeriod ? `${d.activityPeriod}${d.activityPeriodMemo ? ` (${d.activityPeriodMemo})` : ""}` : undefined} />
          <R label="他社応募" value={d.applicationTypeFlag ? `${d.applicationTypeFlag}${d.currentApplicationCount ? ` ${d.currentApplicationCount}社` : ""}${d.applicationMemo ? ` (${d.applicationMemo})` : ""}` : undefined} />
          <R label="就業状況" value={d.employmentStatus} />
          <R label="学歴" value={d.educationFlag ? `${d.educationFlag}${d.educationMemo ? ` ${d.educationMemo}` : ""}` : undefined} />
        </View>

        {/* 職務経歴 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>職務経歴</Text>
          <View style={s.card}>
            <R label="企業名" value={d.companyName ? `${d.companyName}${d.tenure ? ` (${d.tenure})` : ""}` : undefined} />
            <R label="会社概要" value={d.businessContent} />
            <R label="職種" value={d.jobTypeFlag ? `${d.jobTypeFlag}${d.jobTypeMemo ? ` ${d.jobTypeMemo}` : ""}` : undefined} />
            {d.careerSummary && (
              <View style={s.row}>
                <Text style={s.label}>業務内容</Text>
                <Text style={[s.value, { lineHeight: 1.5 }]}>{d.careerSummary}</Text>
              </View>
            )}
            <R label="退社理由" value={d.resignReasonLarge ? [d.resignReasonLarge, d.resignReasonMedium, d.resignReasonSmall].filter(Boolean).join(" / ") : undefined} />
            {d.jobChangeReasonMemo && (
              <View style={s.row}>
                <Text style={s.label}>転職理由</Text>
                <Text style={[s.value, { lineHeight: 1.5 }]}>{d.jobChangeReasonMemo}</Text>
              </View>
            )}
          </View>
        </View>

        {/* 希望条件 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>希望条件</Text>
          <View style={s.grid2}>
            <View style={s.gridCell}>
              <R label="希望職種" value={[d.desiredJobType1, d.desiredJobType2].filter(Boolean).join(", ") || undefined} />
              <R label="希望業種" value={d.desiredIndustry1} />
              <R label="希望エリア" value={[d.desiredArea, d.desiredPrefecture, d.desiredCity].filter(Boolean).join(" ") || undefined} />
              <R label="現年収" value={fmtSalary(d.currentSalary) || undefined} />
              <R label="希望年収" value={(d.desiredSalaryMin || d.desiredSalaryMax) ? `${fmtSalary(d.desiredSalaryMin)}〜${fmtSalary(d.desiredSalaryMax)}` : undefined} />
            </View>
            <View style={s.gridCell}>
              <R label="休日" value={d.desiredDayOff} />
              <R label="残業" value={d.desiredOvertimeMax} />
              <R label="転勤" value={d.desiredTransfer} />
              <R label="優先条件" value={[d.priorityCondition1, d.priorityCondition2, d.priorityCondition3].filter(Boolean).join(", ") || undefined} />
              {d.priorityConditionMemo && <R label="条件メモ" value={d.priorityConditionMemo} />}
            </View>
          </View>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>Bizstudio Portal - 面談記録</Text>
          <Text style={s.footerText}>出力日: {fmtDate(now)}</Text>
        </View>
      </Page>

      {/* Page 2: 評価 + ネクストアクション + メモ */}
      {(ratingRows.length > 0 || d.nextAction || memos.length > 0 || record.interviewMemo) && (
        <Page size="A4" style={s.page}>
          {/* 評価 */}
          {ratingRows.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>ランク評価{r.overallRank ? `　（総合: ${r.overallRank}　${r.grandTotal != null ? `${r.grandTotal}点` : ""}）` : ""}</Text>
              {ratingRows.map((item, i) => (
                <View key={i} style={s.ratingRow}>
                  <Text style={s.ratingLabel}>{item.label}</Text>
                  <Text style={s.ratingScore}>{item.score}</Text>
                  <Text style={s.ratingMemo}>{item.memo || ""}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ネクストアクション */}
          {d.nextAction && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>ネクストアクション</Text>
              <View style={s.card}>
                <Text style={[s.text, { lineHeight: 1.6 }]}>{d.nextAction}</Text>
              </View>
            </View>
          )}

          {/* 面談メモ */}
          {record.interviewMemo && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>面談メモ</Text>
              <View style={s.card}>
                <Text style={[s.text, { lineHeight: 1.6 }]}>{record.interviewMemo}</Text>
              </View>
            </View>
          )}

          {/* メモ一覧 */}
          {memos.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>メモ一覧（{memos.length}件）</Text>
              {memos.map((memo, i) => (
                <View key={i} style={s.memoCard}>
                  <View style={s.memoHeader}>
                    <Text style={s.cardTitle}>{memo.flag} - {memo.title}</Text>
                    <Text style={s.textSmall}>{fmtDate(memo.date)}{memo.time ? ` ${memo.time}` : ""}</Text>
                  </View>
                  <Text style={s.text}>{memo.content}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.footer}>
            <Text style={s.footerText}>Bizstudio Portal - 面談記録</Text>
            <Text style={s.footerText}>出力日: {fmtDate(now)}</Text>
          </View>
        </Page>
      )}
    </Document>
  );
}

export async function GET(req: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { interviewId } = await context.params;

  const record = await prisma.interviewRecord.findUnique({
    where: { id: interviewId },
    include: {
      candidate: {
        select: {
          name: true, nameKana: true, candidateNumber: true, birthday: true,
          phone: true, email: true, address: true, gender: true,
        },
      },
      interviewer: { select: { name: true } },
      detail: true,
      rating: true,
      memos: { orderBy: { date: "asc" }, select: { title: true, content: true, flag: true, date: true, time: true } },
    },
  });

  if (!record) {
    return NextResponse.json({ error: "面談が見つかりません" }, { status: 404 });
  }

  try {
    const doc = React.createElement(InterviewPDF, {
      record,
      detail: record.detail,
      rating: record.rating,
      memos: record.memos,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(doc as any);

    const candidateName = record.candidate?.name || "面談記録";
    const dateStr = fmtDate(record.interviewDate);
    const fileName = encodeURIComponent(`${candidateName}_${record.interviewCount || 1}回目面談_${dateStr}.pdf`);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${fileName}`,
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json({ error: "PDF生成に失敗しました" }, { status: 500 });
  }
}
