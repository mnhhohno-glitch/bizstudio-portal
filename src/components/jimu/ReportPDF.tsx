import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { AppState } from "@/types/jimu";
import { Q1_OPTIONS, Q2_UNIFIED } from "@/data/jimu-questions";
import { UNIFIED_SCENARIOS } from "@/data/jimu-scenarios";
import { UNIFIED_STORY } from "@/data/jimu-story";

Font.register({
  family: "NotoSansJP",
  src: "/fonts/NotoSansJP-Regular.ttf",
});

const NAVY = "#1e3a5f";
const LIGHT_BLUE = "#e8f4fd";
const DARK_GRAY = "#374151";
const MID_GRAY = "#6b7280";
const LIGHT_GRAY = "#f3f4f6";

const s = StyleSheet.create({
  page: {
    fontFamily: "NotoSansJP",
    fontSize: 11,
    color: DARK_GRAY,
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 30,
  },
  coverPage: {
    fontFamily: "NotoSansJP",
    backgroundColor: NAVY,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  coverTitle: {
    fontSize: 24,
    color: "white",
    fontWeight: 700,
    marginBottom: 40,
    textAlign: "center",
  },
  coverInfo: {
    fontSize: 14,
    color: "white",
    textAlign: "center",
    marginBottom: 8,
  },
  coverLogo: {
    fontSize: 12,
    color: "white",
    textAlign: "center",
    position: "absolute",
    bottom: 40,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: 700,
    color: NAVY,
    marginBottom: 12,
    marginTop: 4,
  },
  questionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: NAVY,
    marginBottom: 4,
  },
  answerText: {
    fontSize: 11,
    color: DARK_GRAY,
    marginBottom: 12,
    paddingLeft: 8,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    marginVertical: 10,
  },
  blueBox: {
    backgroundColor: LIGHT_BLUE,
    borderRadius: 6,
    padding: 16,
    marginBottom: 16,
  },
  borderedBox: {
    borderWidth: 2,
    borderColor: NAVY,
    borderRadius: 6,
    padding: 16,
    marginBottom: 16,
  },
  grayBox: {
    backgroundColor: LIGHT_GRAY,
    borderRadius: 6,
    padding: 12,
    marginTop: 12,
  },
  reportTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: NAVY,
    marginBottom: 6,
  },
  reportBody: {
    fontSize: 11,
    color: DARK_GRAY,
    lineHeight: 1.6,
  },
  scenarioRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  correctMark: { color: "#16a34a", fontWeight: 700 },
  partialMark: { color: "#ca8a04", fontWeight: 700 },
  incorrectMark: { color: "#dc2626", fontWeight: 700 },
  pageNumber: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 9,
    color: MID_GRAY,
  },
});

function getQ1Label(answerId: string): string {
  const opt = Q1_OPTIONS.find((o) => o.id === answerId);
  return opt?.label || answerId;
}

function getQ2Label(answerId: string): string {
  const opt = Q2_UNIFIED.options.find((o) => o.id === answerId);
  return opt?.label || answerId;
}

function getStoryQ3Label(answerId: string): string {
  const evening = UNIFIED_STORY.find((sec) => sec.checkpoint?.id === "q3");
  if (!evening?.checkpoint) return answerId;
  const opt = evening.checkpoint.options.find((o) => o.id === answerId);
  return opt?.label || answerId;
}

const REFLECTION_LABELS: Record<number, string> = {
  1: "問1：取締役会議の資料更新（正確さ）",
  2: "問2：急ぎの見積書作成（スピード × 正確さ）",
  3: "問3：他部署への経費精算フォロー（社内調整）",
  4: "問4：契約書の金額ミス発見（気づきと先回り）",
  5: "問5：3つの同時依頼の優先判断（マルチタスク）",
};

interface Props {
  state: AppState;
  reportText: string;
}

function parseReportForPDF(text: string) {
  const marker = "■ パート2";
  const idx = text.indexOf(marker);
  if (idx === -1) return { part1: text, part2: "" };

  const clean = (str: string) =>
    str.replace(/^[━─═]+\n?/gm, "").replace(/\n[━─═]+$/gm, "");

  let p1 = text.substring(0, idx).trim();
  let p2 = text.substring(idx).trim();
  p1 = clean(p1).replace(/■ パート1[^\n]*\n?/, "").trim();
  p2 = clean(p2).replace(/■ パート2[^\n]*\n?/, "").trim();
  return { part1: p1, part2: p2 };
}

function ReportTextBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <View>
      {lines.map((line, i) => {
        if (line.startsWith("【") && line.includes("】")) {
          return (
            <Text key={i} style={[s.reportTitle, { marginTop: i > 0 ? 10 : 0 }]}>
              {line}
            </Text>
          );
        }
        if (line.trim() === "") {
          return <View key={i} style={{ height: 6 }} />;
        }
        return (
          <Text key={i} style={s.reportBody}>
            {line}
          </Text>
        );
      })}
    </View>
  );
}

export default function ReportPDF({ state, reportText }: Props) {
  const now = new Date();
  const dateFormatted = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const correctCount = state.quizResults.filter((r) => r.correct).length;
  const parsed = parseReportForPDF(reportText);

  return (
    <Document>
      {/* 表紙 */}
      <Page size="A4" style={s.coverPage}>
        <Text style={s.coverTitle}>事務職 志望動機分析資料</Text>
        <Text style={s.coverInfo}>氏名：{state.candidateName}</Text>
        <Text style={s.coverInfo}>作成日：{dateFormatted}</Text>
        <Text style={s.coverLogo}>Bizstudio</Text>
      </Page>

      {/* 回答履歴 */}
      <Page size="A4" style={s.page}>
        <Text style={s.sectionHeader}>■ 質問と回答</Text>

        <Text style={s.questionLabel}>
          Q1. 事務を目指した理由を、一番正直に選んでください
        </Text>
        <Text style={s.answerText}>→ {getQ1Label(state.answers.q1)}</Text>
        {state.freeTexts.q1 && (
          <Text style={[s.answerText, { marginTop: -8 }]}>
            （自由記述：{state.freeTexts.q1}）
          </Text>
        )}

        <Text style={s.questionLabel}>
          Q2. {Q2_UNIFIED.question}
        </Text>
        <Text style={s.answerText}>→ {getQ2Label(state.answers.q2)}</Text>
        {state.freeTexts.q2 && (
          <Text style={[s.answerText, { marginTop: -8 }]}>
            （自由記述：{state.freeTexts.q2}）
          </Text>
        )}

        <View style={s.divider} />

        <Text style={s.sectionHeader}>■ ストーリーで共感した場面</Text>
        <Text style={s.answerText}>
          → {getStoryQ3Label(state.storyResponses.q3)}
        </Text>

        <View style={s.divider} />

        <Text style={s.sectionHeader}>
          ■ シナリオ結果（5問中{correctCount}問正解）
        </Text>
        {UNIFIED_SCENARIOS.map((scenario) => {
          const result = state.quizResults.find(
            (r) => r.questionNumber === scenario.questionNumber
          );
          const selectedOpt = result
            ? scenario.options.find((o) => o.id === result.selectedAnswer)
            : null;

          let markStyle = s.incorrectMark;
          let markText = "✗ 不正解";
          if (selectedOpt?.result === "correct") {
            markStyle = s.correctMark;
            markText = "✓ 正解";
          } else if (selectedOpt?.result === "partial") {
            markStyle = s.partialMark;
            markText = "△ 惜しい";
          }

          return (
            <View key={scenario.questionNumber} style={{ marginBottom: 6 }}>
              <Text style={s.questionLabel}>
                シナリオ{scenario.questionNumber}：{scenario.scene}
              </Text>
              <Text style={s.answerText}>
                → {selectedOpt?.label || "（未回答）"}{" "}
                <Text style={markStyle}>（{markText}）</Text>
              </Text>
            </View>
          );
        })}

        <View style={s.divider} />

        <Text style={s.sectionHeader}>■ 一番印象に残ったシナリオ</Text>
        <Text style={s.answerText}>
          → {state.reflection.mostImpressiveScenario
            ? REFLECTION_LABELS[state.reflection.mostImpressiveScenario]
            : "（未選択）"}
        </Text>
        <Text style={s.answerText}>
          理由：{state.reflection.whyImpressive || "（未記入）"}
        </Text>

        <View style={s.divider} />

        <Text style={s.sectionHeader}>■ あなたの体験</Text>
        <Text style={s.answerText}>
          → {state.reflection.pastExperience || "（未記入）"}
        </Text>

        <Text style={s.sectionHeader}>■ 一番うれしかった瞬間</Text>
        <Text style={s.answerText}>
          → {state.reflection.happiestMoment || "（未回答）"}
        </Text>

        <Text style={s.pageNumber}>2</Text>
      </Page>

      {/* レポート パート1 */}
      <Page size="A4" style={s.page}>
        <Text style={s.sectionHeader}>■ パート1：あなたの志望動機の素材</Text>
        <View style={s.blueBox}>
          <ReportTextBlock text={parsed.part1} />
        </View>
        <Text style={s.pageNumber}>3</Text>
      </Page>

      {/* レポート パート2 */}
      <Page size="A4" style={s.page}>
        <Text style={s.sectionHeader}>
          ■ パート2：面接で使える志望動機（完成版）
        </Text>
        <View style={s.borderedBox}>
          <ReportTextBlock text={parsed.part2} />
        </View>

        <View style={s.grayBox}>
          <Text style={{ fontSize: 10, color: MID_GRAY, fontWeight: 700, marginBottom: 4 }}>
            企業への志望動機について
          </Text>
          <Text style={{ fontSize: 10, color: MID_GRAY, lineHeight: 1.5 }}>
            これは"なぜ事務職をやりたいか"の志望動機です。{"\n"}
            面接では"なぜこの会社か"も聞かれます。{"\n"}
            企業の事業内容・社風・求人情報を調べて、{"\n"}
            "この会社だからこそ"の理由も準備しましょう。
          </Text>
        </View>
        <Text style={s.pageNumber}>4</Text>
      </Page>
    </Document>
  );
}
