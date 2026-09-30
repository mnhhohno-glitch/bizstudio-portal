"use client";

// T-208 step4: 求職者詳細の「面談スクリプト」タブ（?view=script）。
// 上から: ①面談の選択（「1回目 9/11」の並び・既定は一番新しい記録・右端に「案内メール」）
//        ②7つのパートの進み具合 ③左右2列（左: スクリプトの場面カード／右: 面談準備・入力内容）… ②③は InterviewScriptMode。
// 答えの保存と面談記録の欄への反映は、ここから POST /api/interviews/[id]/script-answers/apply に頼む（サーバー側で入れる）。
//   - ボタン・入力: action="scene"（sceneKey つき）を押した順に1つずつ送る（キュー）。返ってきた applied / proposals / detail / workHistories で表示を更新
//   - 前へ／次へ（進み具合だけ）: 1.5 秒デバウンスで action="scene"（sceneKey なし）
//   - 提案［替える］［そのまま］: action="accept" / "dismiss"
// 面談記録が1件も無いとき: 右の面談準備は使える。左のスクリプトは読めるが答えは保存しない（左の上に［新規面談を作成］）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import InterviewScriptMode from "./InterviewScriptMode";
import CandidateContactMailButton from "./CandidateContactMailButton";
import { INTERVIEW_FORM_ROOT_STYLE } from "./interview-form-vars";
import {
  createInterviewRecord,
  defaultSelectedInterview,
  fetchInterviewList,
  formatShortDate,
  InterviewCreateError,
  useCurrentEmployeeId,
  type InterviewListRecord,
  type SessionUserLike,
} from "./interview-create";
import { currentValueAt, type ProposalMap, type WorkHistoryRowLike } from "@/lib/interview-script/apply-plan";
import type { WorkHistoryLike } from "@/lib/interview-script/runtime";
import { SCRIPT_VERSION } from "@/lib/interview-script/script-v1";
import type { AnswerMap, AppliedMap } from "@/lib/interview-script/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

type Props = {
  candidateId: string;
  currentUser: SessionUserLike;
  candidate: { name: string; email: string | null } | null;
  /** 「面談履歴で確かめる」: 面談履歴タブのその記録へ */
  onOpenHistory: (interviewId: string) => void;
};

/** 面談記録の職歴の行（API の形。スクリプトの差し込みと欄の値の両方で使う） */
type WhRow = WorkHistoryRowLike & WorkHistoryLike;

type LoadedRecord = {
  id: string;
  form: AnyRecord;
  detail: AnyRecord;
  workHistories: WhRow[];
};

type ApplyResponse = {
  ok: boolean;
  applied: AppliedMap;
  proposals: ProposalMap;
  detail: AnyRecord | null;
  workHistories: WhRow[];
};

const NAV_SAVE_DEBOUNCE = 1_500;

function StatusDot({ status, lastSavedAt }: { status: string; lastSavedAt: string | null }) {
  if (status === "complete") return <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" title="完了" />;
  if (lastSavedAt) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" title="下書き(保存あり)" />;
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title="未入力" />;
}

export default function InterviewScriptTab({ candidateId, currentUser, candidate, onOpenHistory }: Props) {
  const [interviews, setInterviews] = useState<InterviewListRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [record, setRecord] = useState<LoadedRecord | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [applied, setApplied] = useState<AppliedMap>({});
  const [proposals, setProposals] = useState<ProposalMap>({});
  const [creating, setCreating] = useState(false);
  const currentEmployeeId = useCurrentEmployeeId(currentUser);

  const answersRef = useRef<AnswerMap>({});
  const selectedIdRef = useRef<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navDirtyRef = useRef(false);

  /* ---- 面談一覧 ---- */
  const loadList = useCallback(async () => {
    try {
      const records = await fetchInterviewList(candidateId);
      setInterviews(records);
      return records;
    } catch {
      return null;
    } finally {
      setListLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    let cancelled = false;
    loadList().then((records) => {
      if (cancelled || !records) return;
      setSelectedId((prev) => prev ?? defaultSelectedInterview(records)?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  /* ---- 選んだ面談記録とスクリプトの答え ---- */
  useEffect(() => {
    selectedIdRef.current = selectedId;
    setRecord(null);
    setAnswers({});
    answersRef.current = {};
    setApplied({});
    setProposals({});
    if (!selectedId) return;
    let cancelled = false;
    const id = selectedId;
    Promise.all([
      fetch(`/api/interviews/${id}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/interviews/${id}/script-answers`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([rec, script]) => {
        if (cancelled) return;
        const r = rec?.record || rec;
        if (r) {
          setRecord({
            id,
            form: { startTime: r.startTime || "", interviewTool: r.interviewTool || "電話" },
            detail: r.detail || {},
            workHistories: Array.isArray(r.workHistories) ? r.workHistories : [],
          });
        }
        if (script) {
          const a = (script.answers ?? {}) as AnswerMap;
          setAnswers(a);
          answersRef.current = a;
          setApplied((script.applied ?? {}) as AppliedMap);
          setProposals((script.proposals ?? {}) as ProposalMap);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  /* ---- サーバーへ（1つずつ順番に） ---- */
  const takeResponse = useCallback((forId: string, data: ApplyResponse | null) => {
    if (!data || !data.ok || selectedIdRef.current !== forId) return;
    setApplied(data.applied ?? {});
    setProposals(data.proposals ?? {});
    setRecord((prev) => (prev && prev.id === forId ? { ...prev, detail: data.detail ?? prev.detail, workHistories: data.workHistories ?? prev.workHistories } : prev));
  }, []);

  const post = useCallback(
    (forId: string, body: Record<string, unknown>, keepalive = false) => {
      const run = async () => {
        try {
          const res = await fetch(`/api/interviews/${forId}/script-answers/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            keepalive,
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string };
            if (res.status !== 409) toast.error(err.error || "スクリプトの答えの保存に失敗しました");
            // 409（提案がもう無い）は最新の状態を取り直す
            if (res.status === 409) {
              const again = await fetch(`/api/interviews/${forId}/script-answers`).then((r) => (r.ok ? r.json() : null));
              if (again && selectedIdRef.current === forId) setProposals((again.proposals ?? {}) as ProposalMap);
            }
            return;
          }
          takeResponse(forId, (await res.json()) as ApplyResponse);
        } catch {
          toast.error("スクリプトの答えの保存に失敗しました（通信）");
        }
      };
      queueRef.current = queueRef.current.then(run, run);
      return queueRef.current;
    },
    [takeResponse],
  );

  const flushNavSave = useCallback(
    (keepalive = false) => {
      if (navTimerRef.current) {
        clearTimeout(navTimerRef.current);
        navTimerRef.current = null;
      }
      const id = selectedIdRef.current;
      if (!navDirtyRef.current || !id) return;
      navDirtyRef.current = false;
      void post(id, { action: "scene", answers: answersRef.current, scriptVersion: SCRIPT_VERSION }, keepalive);
    },
    [post],
  );

  // 進み具合だけの変更: デバウンスして保存
  const handleNavigate = (next: AnswerMap) => {
    setAnswers(next);
    answersRef.current = next;
    if (!selectedIdRef.current) return;
    navDirtyRef.current = true;
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
    navTimerRef.current = setTimeout(() => flushNavSave(), NAV_SAVE_DEBOUNCE);
  };

  // 場面の答え: すぐ送る（進み具合の未保存分も同じ答えに含まれる）
  const handleSceneAnswer = (sceneKey: string, next: AnswerMap) => {
    setAnswers(next);
    answersRef.current = next;
    const id = selectedIdRef.current;
    if (!id) return; // 面談記録が無い: 画面の中だけ
    if (navTimerRef.current) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
    navDirtyRef.current = false;
    void post(id, { action: "scene", answers: next, sceneKey, scriptVersion: SCRIPT_VERSION });
  };

  const handleAcceptProposal = (path: string) => {
    const id = selectedIdRef.current;
    if (!id) return;
    void post(id, { action: "accept", path });
  };
  const handleDismissProposal = (path: string) => {
    const id = selectedIdRef.current;
    if (!id) return;
    setProposals((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    void post(id, { action: "dismiss", path });
  };

  // タブを離れる・面談を切り替えるときは、進み具合の未保存分を送る
  useEffect(() => {
    return () => flushNavSave(true);
  }, [flushNavSave, selectedId]);

  /* ---- 職歴の行が無いとき、登録情報の会社名で職歴を作る ---- */
  const handleImportCompanies = async (names: string[]) => {
    const id = selectedIdRef.current;
    if (!id || !record || record.workHistories.length > 0) return;
    let made = 0;
    for (let i = 0; i < names.length; i++) {
      try {
        const res = await fetch(`/api/interviews/${id}/work-histories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order: i + 1, companyName: names[i] || null, businessContent: null,
            tenureYear: null, tenureMonth: null, jobTypeFlag: null, jobTypeMemo: null,
            resignReasonLarge: null, resignReasonMedium: null, resignReasonSmall: null, jobChangeReasonMemo: null,
          }),
        });
        if (res.ok) made++;
      } catch {
        /* 続ける */
      }
    }
    try {
      const r = await fetch(`/api/interviews/${id}`).then((x) => (x.ok ? x.json() : null));
      const rec = r?.record || r;
      if (rec && selectedIdRef.current === id) setRecord((prev) => (prev ? { ...prev, detail: rec.detail || prev.detail, workHistories: Array.isArray(rec.workHistories) ? rec.workHistories : prev.workHistories } : prev));
    } catch {
      /* silent */
    }
    if (made > 0) toast.success(`職歴を${made}社分作りました（企業名のみ）`);
    else toast.error("職歴を作れませんでした");
  };

  /* ---- 新規面談を作成（面談履歴タブと同じ処理） ---- */
  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const newId = await createInterviewRecord({ candidateId, currentUser, currentEmployeeId, existingCount: interviews.length });
      toast.success("新規面談を作成しました");
      await loadList();
      setSelectedId(newId);
    } catch (e) {
      toast.error(e instanceof InterviewCreateError ? e.message : "新規面談の作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  const selected = interviews.find((i) => i.id === selectedId);
  const detail = useMemo<AnyRecord>(() => record?.detail ?? {}, [record]);
  const workHistories = useMemo<WhRow[]>(() => record?.workHistories ?? [], [record]);
  const currentValueOf = useCallback((path: string) => currentValueAt(path, detail, workHistories), [detail, workHistories]);
  const waitingRecord = !!selectedId && !record;

  if (listLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-3 border-[#2563EB] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      {/* ① 面談の選択 */}
      <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 mb-3 flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-medium text-gray-500 mr-1">面談:</span>
        {interviews.length === 0 && <span className="text-[12px] text-gray-400">面談記録がありません</span>}
        {interviews.map((iv, idx) => (
          <button
            key={iv.id}
            type="button"
            onClick={() => setSelectedId(iv.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors ${
              selectedId === iv.id ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <StatusDot status={iv.status} lastSavedAt={iv.lastSavedAt} />
            <span>{idx + 1}回目</span>
            <span className="text-gray-400">{formatShortDate(iv.interviewDate)}</span>
          </button>
        ))}
        {selected && (
          <span className="text-[11px] text-gray-400 ml-1">
            {[selected.interviewTool, selected.startTime ? `${selected.startTime}${selected.endTime ? `〜${selected.endTime}` : ""}` : null, selected.interviewType, selected.interviewer?.name]
              .filter(Boolean)
              .join("・")}
          </span>
        )}
        <div className="ml-auto relative">
          {/* T-207 の案内メール（ボタン・メニュー・確認画面は CandidateContactMailButton 内） */}
          <CandidateContactMailButton candidateId={candidateId} appearance="header" />
        </div>
      </div>

      {/* ②③ スクリプト本体 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" style={INTERVIEW_FORM_ROOT_STYLE}>
        {waitingRecord ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-6 w-6 border-3 border-[#2563EB] border-t-transparent rounded-full" />
          </div>
        ) : (
          <InterviewScriptMode
            candidateId={candidateId}
            interviewId={record?.id ?? null}
            candidate={candidate}
            form={record?.form ?? {}}
            detail={detail}
            workHistories={workHistories}
            answers={answers}
            applied={applied}
            proposals={proposals}
            onNavigate={handleNavigate}
            onSceneAnswer={handleSceneAnswer}
            onAcceptProposal={handleAcceptProposal}
            onDismissProposal={handleDismissProposal}
            onImportCompanies={(names) => void handleImportCompanies(names)}
            currentValueOf={currentValueOf}
            onOpenHistory={record ? () => onOpenHistory(record.id) : undefined}
            noRecordSlot={
              !record ? (
                <div className="rounded-md px-3 py-2 mb-4 flex items-center gap-3 flex-wrap" style={{ background: "var(--im-bg-warn)", fontSize: 12, color: "var(--im-fg-warn)" }}>
                  <span>面談記録を作ると、答えを保存できます。</span>
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={creating}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
                  >
                    {creating ? "作成中..." : "+ 新規面談を作成"}
                  </button>
                </div>
              ) : null
            }
          />
        )}
      </div>
    </div>
  );
}
