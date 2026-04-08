"use client";
import { inputCls, labelCls } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = { d: Record<string, any>; set: (k: string, v: any) => void };

export default function ActionItems({ d, set }: Props) {
  return (
    <div className="space-y-5">
      <Section title="応募書類状況">
        <div>
          <label className={labelCls}>ステータス</label>
          <select value={d.documentStatusFlag || ""} onChange={(e) => set("documentStatusFlag", e.target.value)} className={inputCls}>
            <option value="">-</option>
            <option value="未着手">未着手</option>
            <option value="作成中">作成中</option>
            <option value="作成済">作成済</option>
            <option value="他社データ確認済">他社で作ってもらったデータがあるので確認し提出依頼済み</option>
          </select>
        </div>
        <div className="mt-2">
          <label className={labelCls}>メモ</label>
          <textarea value={d.documentStatusMemo || ""} onChange={(e) => set("documentStatusMemo", e.target.value)} rows={2} className={inputCls}
            placeholder="マイナビから作成/本人作成..." />
        </div>
      </Section>

      <Section title="連絡方法">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>方法</label>
            <input type="text" value={d.contactMethod || ""} onChange={(e) => set("contactMethod", e.target.value)}
              placeholder="LINE/LINE繋がず/メール" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>メモ</label>
            <input type="text" value={d.contactMemo || ""} onChange={(e) => set("contactMemo", e.target.value)}
              placeholder="LINEはあえてつながず..." className={inputCls} />
          </div>
        </div>
      </Section>

      <Section title="求人送付／送付期限">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>送付ステータス</label>
            <input type="text" value={d.jobReferralFlag || ""} onChange={(e) => set("jobReferralFlag", e.target.value)}
              placeholder="求人送付/送付無し" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>送付期限</label>
            <input type="date" value={d.jobSendDeadline ? String(d.jobSendDeadline).slice(0, 10) : ""}
              onChange={(e) => set("jobSendDeadline", e.target.value ? `${e.target.value}T12:00:00.000Z` : null)} className={inputCls} />
          </div>
        </div>
        <div className="mt-2">
          <label className={labelCls}>メモ</label>
          <textarea value={d.jobReferralMemo || ""} onChange={(e) => set("jobReferralMemo", e.target.value)} rows={2} className={inputCls}
            placeholder="営業は向こうとの事だったが..." />
        </div>
      </Section>

      <Section title="次回面談予定">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>求人送付予定</label>
            <input type="text" value={d.nextInterviewFlag || ""} onChange={(e) => set("nextInterviewFlag", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>日付</label>
            <input type="date" value={d.nextInterviewDate ? String(d.nextInterviewDate).slice(0, 10) : ""}
              onChange={(e) => set("nextInterviewDate", e.target.value ? `${e.target.value}T12:00:00.000Z` : null)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>時間</label>
            <input type="time" value={d.nextInterviewTime || ""} onChange={(e) => set("nextInterviewTime", e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="mt-2">
          <label className={labelCls}>メモ</label>
          <textarea value={d.nextInterviewMemo || ""} onChange={(e) => set("nextInterviewMemo", e.target.value)} rows={2} className={inputCls} />
        </div>
      </Section>

      <Section title="ネクストアクション">
        <textarea value={d.nextAction || ""} onChange={(e) => set("nextAction", e.target.value)} rows={4} className={inputCls} />
      </Section>

      <Section title="GPT用メモ">
        <textarea value={d.gptMemo || ""} onChange={(e) => set("gptMemo", e.target.value)} rows={6} className={inputCls}
          placeholder={`以下の情報をもとに、提案すべき求人を書き出して\n経験：\n強み：\n志向性：\n転職理由：\n年収条件：`} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div><h4 className="text-[13px] font-bold text-[#374151] mb-2 border-b pb-1">{title}</h4>{children}</div>);
}
