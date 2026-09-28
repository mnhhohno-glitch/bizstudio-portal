"use client";

// T-205 step8: 面談準備の「最初の整理」をカードで表示する（summary_json をそのまま組み立てる。文章の解釈はしない）。
// 並び: ひとことで → 経歴の流れ → やってきた仕事 → 面談で聞くこと（「聞いた」ボタン） → 強み → 知っておきたい言葉 → 調べた情報の出典。
// step10: 「ひとことで」に会社のホームページ、「経歴の流れ」の会社の行に公式サイトのリンク（research の officialUrl があるときだけ）。
// 見た目は InterviewPrepPanel の色（#2563EB・gray・amber）に合わせる。新しいライブラリは使わない。
import {
  officialSites,
  officialUrlForTitle,
  researchSources,
  type ResearchResult,
} from "@/lib/interview-prep/research-format";
import type { AskedQuestions, PrepSummary } from "@/lib/interview-prep/summary-format";

type Props = {
  summary: PrepSummary;
  research: ResearchResult | null;
  asked: AskedQuestions;
  /** 「聞いた」を付ける／外す（保存は親が行う）。 */
  onToggleAsked: (index: number, asked: boolean) => void;
  disabled?: boolean;
};

function Card({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm px-5 py-4">
      <h3 className="text-[12px] font-semibold text-gray-500 tracking-wide mb-3">{title}</h3>
      {children}
      {footer && <div className="mt-3 pt-2 border-t border-gray-100">{footer}</div>}
    </section>
  );
}

const BADGE_BASE = "inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] border";
const BADGE_GRAY = `${BADGE_BASE} bg-gray-50 text-gray-700 border-gray-200`;
const BADGE_BLUE = `${BADGE_BASE} bg-blue-50 text-blue-700 border-blue-200`;
const BADGE_GREEN = `${BADGE_BASE} bg-emerald-50 text-emerald-700 border-emerald-200`;
const BADGE_AMBER = `${BADGE_BASE} bg-amber-50 text-amber-700 border-amber-200`;

function employmentBadgeClass(status: PrepSummary["employmentStatus"]): string {
  if (status === "在職中") return BADGE_GREEN;
  if (status === "離職中") return BADGE_AMBER;
  return BADGE_GRAY;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline whitespace-nowrap">
      {children} ↗
    </a>
  );
}

function ResearchMark() {
  return <span className="text-[11px] text-gray-400 whitespace-nowrap">🌐 調べた情報</span>;
}

export default function InterviewPrepSummaryCards({ summary, research, asked, onToggleAsked, disabled }: Props) {
  const sources = researchSources(research);
  const sites = officialSites(research);
  const askedCount = summary.questions.filter((_, i) => !!asked[String(i)]).length;

  return (
    <div className="space-y-4 text-gray-800">
      {/* 1. ひとことで */}
      <Card title="ひとことで">
        <p className="text-[17px] leading-[1.8] text-gray-900">{summary.summary}</p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <span className={employmentBadgeClass(summary.employmentStatus)}>{summary.employmentStatus}</span>
          {summary.age && <span className={BADGE_GRAY}>{summary.age}</span>}
          {summary.careerType !== "判定できない" && (
            <span className={BADGE_BLUE} title={summary.careerTypeReason || undefined}>
              {summary.careerType}
            </span>
          )}
          {summary.currentIncome && <span className={BADGE_GRAY}>年収 {summary.currentIncome}</span>}
        </div>
        {summary.careerType === "判定できない" && summary.careerTypeReason && (
          <p className="mt-2 text-[12px] text-gray-500">経歴の型は判定できない（{summary.careerTypeReason}）</p>
        )}
        {sites.length > 0 && (
          <p className="mt-2 text-[12px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>会社のホームページ:</span>
            {sites.map((s) => (
              <ExternalLink key={s.name} href={s.url}>
                {s.name}
              </ExternalLink>
            ))}
          </p>
        )}
        {summary.qualifications.length > 0 && (
          <p className="mt-2 text-[12px] text-gray-500 truncate" title={summary.qualifications.join("、")}>
            資格: {summary.qualifications.join("、")}
          </p>
        )}
      </Card>

      {/* 2. 経歴の流れ */}
      <Card title="経歴の流れ">
        {summary.timeline.length === 0 ? (
          <p className="text-[14px] text-gray-500">レジュメから読み取れる経歴がありません。</p>
        ) : (
          <ol className="relative">
            {summary.timeline.map((t, i) => {
              const last = i === summary.timeline.length - 1;
              const siteUrl = officialUrlForTitle(research, t.title);
              return (
                <li key={i} className={`relative pl-6 ${last ? "" : "pb-4"}`}>
                  {!last && <span aria-hidden className="absolute left-[7px] top-3 bottom-0 w-px bg-gray-200" />}
                  <span
                    aria-hidden
                    className="absolute left-[3px] top-[7px] w-[9px] h-[9px] rounded-full bg-[#2563EB] ring-2 ring-white"
                  />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {t.period && <span className="text-[12px] text-gray-500">{t.period}</span>}
                    {t.fromResearch && <ResearchMark />}
                  </div>
                  <div className="text-[15px] font-bold text-gray-900 leading-[1.7]">
                    {t.title}
                    {siteUrl && (
                      <span className="ml-2 text-[11px] font-normal">
                        <ExternalLink href={siteUrl}>公式サイト</ExternalLink>
                      </span>
                    )}
                  </div>
                  {t.detail && <p className="text-[14px] text-gray-700 leading-[1.8] mt-0.5">{t.detail}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {/* 3. やってきた仕事 */}
      <Card
        title="やってきた仕事"
        footer={<p className="text-[11px] text-gray-400">右側は一般的な意味です。本人のやり方は面談で確認します。</p>}
      >
        {summary.works.length === 0 ? (
          <p className="text-[14px] text-gray-500">レジュメに仕事の内容の記載がありません。</p>
        ) : (
          <div className="space-y-4">
            {summary.works.map((w, wi) => (
              <div key={wi}>
                <div className="text-[14px] font-semibold text-gray-900 mb-1.5">{w.company}</div>
                {w.items.length === 0 ? (
                  <p className="text-[13px] text-gray-500">作業の記載なし</p>
                ) : (
                  <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2">
                    {w.items.map((it, ii) => (
                      <div key={ii} className="contents">
                        <div className="text-[14px] font-bold text-gray-900 leading-[1.7]">{it.term}</div>
                        <div className="text-[14px] text-gray-700 leading-[1.7]">{it.meaning}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 4. 面談で聞くこと（T-205 step9: 件数に関係なく全件を出す） */}
      <Card title={`面談で聞くこと（${askedCount}/${summary.questions.length} 聞いた）`}>
        <div className="space-y-3">
          {summary.questions.map((q, i) => {
            const isAsked = !!asked[String(i)];
            return (
              <div
                key={i}
                className={`rounded-lg border px-4 py-3 transition-colors ${
                  isAsked ? "border-gray-200 bg-gray-50 opacity-60" : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-[11px] text-gray-400">Q{i + 1}</span>
                      {q.mismatch && <span className={BADGE_AMBER}>食い違い</span>}
                    </div>
                    <p className="text-[16px] font-medium text-gray-900 leading-[1.7]">{q.question}</p>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onToggleAsked(i, !isAsked)}
                    aria-pressed={isAsked}
                    className={`shrink-0 rounded-md border px-2.5 py-1 text-[12px] whitespace-nowrap disabled:opacity-50 ${
                      isAsked
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {isAsked ? "✓ 聞いた" : "聞いた"}
                  </button>
                </div>
                {(q.why || q.reveals) && (
                  <div className="mt-2 space-y-0.5 text-[12px] text-gray-500 leading-[1.7]">
                    {q.why && (
                      <p>
                        <span className="text-gray-400">なぜ: </span>
                        {q.why}
                      </p>
                    )}
                    {q.reveals && (
                      <p>
                        <span className="text-gray-400">分かること: </span>
                        {q.reveals}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* 5. 強み */}
      <Card title="強み">
        {summary.strengths.length === 0 ? (
          <p className="text-[14px] text-gray-500">レジュメからは判断できません。</p>
        ) : (
          <ul className="space-y-3">
            {summary.strengths.map((s, i) => (
              <li key={i}>
                <div className="text-[15px] font-medium text-gray-900 leading-[1.7]">{s.strength}</div>
                <p className="text-[13px] text-gray-500 leading-[1.7]">
                  根拠: {s.fromSelfPr ? "本人の自己PRより" : s.basis || "（記載なし）"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 6. 知っておきたい言葉（T-205 step9: 畳まずに全語を出す） */}
      <Card title="知っておきたい言葉">
        {summary.glossary.length === 0 ? (
          <p className="text-[14px] text-gray-500">なし</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2">
            {summary.glossary.map((g, i) => (
              <div key={i} className="contents">
                <div className="text-[14px] font-bold text-gray-900 leading-[1.7]">{g.term}</div>
                <div className="text-[14px] text-gray-700 leading-[1.7]">{g.meaning}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 7. 調べた情報の出典（会社の URL。学校は出さない） */}
      {sources.length > 0 && (
        <div className="px-1 text-[11px] text-gray-500">
          <div className="font-medium mb-1">🌐 調べた情報の出典</div>
          <ul className="space-y-0.5">
            {sources.map((src) => (
              <li key={src.label} className="break-all">
                <span className="text-gray-600">{src.label}:</span>{" "}
                {src.urls.map((u, i) => (
                  <span key={u}>
                    {i > 0 && "、"}
                    <a href={u} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {i + 1}
                    </a>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
