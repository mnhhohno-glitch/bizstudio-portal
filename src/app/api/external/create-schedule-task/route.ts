import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";
import { AI_COMMENT_PREFIX, resolveStoredStatus, resolveSystemUserId } from "@/lib/schedule-tasks";
import { autoReserveFromPreferences } from "@/lib/schedule-agent/auto-reserve";
import { sendAutoReserveErrorAlert } from "@/lib/schedule-agent/alert";
import { classifyWindows } from "@/lib/schedule-agent/match-slot";
import { methodFromFormatField, parseDesiredWindows } from "@/lib/schedule-agent/parse-preferences";
import { eventTitleWhen, jstIso, reservedRangeLabel } from "@/lib/schedule-agent/jst";
import type { MeetingMethod } from "@/lib/schedule-agent/reply-templates";

interface CreateScheduleTaskRequest {
  type: "mynavi_new" | "consultation" | "interview";
  candidateName: string;
  preferredDates: string;
  meetingFormat: string;
  email?: string;
  notes?: string;
  advisorName?: string;
  candidateId?: string;
  source?: string;
  /**
   * T-194: フォーム送信時の自動仮確定を行うか（オプトイン）。
   * true かつ type==="mynavi_new" のときだけ動く。未指定・false は従来どおり（挙動完全不変）。
   */
  autoReserve?: boolean;
}

/** T-194: 自動仮確定の時間上限（ms）。超えたら「空きなし」扱いで返し、フォーム送信自体は待たせない。 */
const AUTO_RESERVE_BUDGET_MS = 8000;

/** T-194: レスポンスに足す自動仮確定の結果（autoReserve=true のときだけ現れる）。 */
type AutoReserveResponse = {
  result: "reserved" | "not_reserved";
  slot?: { start: string; end: string; label: string };
  method?: MeetingMethod;
  reason?: "no_slot" | "excluded_only" | "error" | "timeout" | "no_config";
};

type AssigneeInfo = {
  userId: string;
  employeeId: string;
  name: string;
  lineworksId: string | null;
};

export async function POST(request: Request) {
  // 1. 認証チェック
  const apiSecret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.EXTERNAL_API_SECRET;

  if (!expectedSecret || apiSecret !== expectedSecret) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body: CreateScheduleTaskRequest = await request.json();
    const {
      type,
      candidateName,
      preferredDates,
      meetingFormat,
      notes,
      advisorName,
      candidateId,
      source,
      autoReserve,
    } = body;

    if (!candidateName || !preferredDates || !meetingFormat) {
      return NextResponse.json(
        { success: false, error: "candidateName, preferredDates, meetingFormat は必須です" },
        { status: 400 }
      );
    }

    // 1.5 candidateId から PDF由来の正式氏名を解決（T-139）
    //   フォーム手入力の氏名は入力ミス（例「平塚美月 美月」の重複入力）が起こり、RPAの
    //   マイナビ検索を失敗させる。PDFから機械抽出した Candidate.name はマイナビ登録氏名と
    //   完全一致するため、candidateId が渡された場合は Candidate.name をタイトル氏名に使う。
    //   ★後方互換が絶対条件: candidateId 無し／Candidate 不在なら従来どおりフォーム氏名を使う。
    //     無効な candidateId でも 400 にせず安全側（従来動作）へ倒す（フォーム送信全体の失敗回避）。
    let effectiveName = candidateName;
    let validatedCandidateId: string | null = null;
    if (candidateId) {
      const candidate = await prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { id: true, name: true },
      });
      if (candidate) {
        validatedCandidateId = candidate.id;
        if (candidate.name?.trim()) {
          effectiveName = candidate.name.trim();
        }
      }
    }
    const nameWasSwapped = effectiveName !== candidateName;

    // 2. タスクタイトル生成（氏名部分に effectiveName を使う。命名パターンは不変）
    let taskTitle: string;
    switch (type) {
      case "mynavi_new":
        taskTitle = source
          ? `【${source} 新規面談調整】新規応募者 ${effectiveName}`
          : `【新規面談調整】新規応募者 ${effectiveName}`;
        break;
      case "consultation":
        taskTitle = `【面談調整】${effectiveName} - 担当:${advisorName ?? "未設定"}`;
        break;
      case "interview":
        taskTitle = `【面接希望日】${effectiveName} - 担当:${advisorName ?? "未設定"}`;
        break;
      default:
        return NextResponse.json(
          { success: false, error: "無効なtypeです" },
          { status: 400 }
        );
    }

    // 3. 担当者決定
    const assignees: AssigneeInfo[] = [];

    if (type !== "mynavi_new" && advisorName) {
      // advisorName から User を検索
      const advisorUser = await prisma.user.findFirst({
        where: { name: advisorName, status: "active" },
        include: { employee: { select: { id: true, name: true } } },
      });
      if (advisorUser) {
        let employeeId = advisorUser.employee?.id;
        // User→Employee リレーション未リンク時は名前でフォールバック
        if (!employeeId) {
          const emp = await prisma.employee.findFirst({
            where: { name: advisorName, status: "active" },
            select: { id: true },
          });
          employeeId = emp?.id;
        }
        if (employeeId) {
          assignees.push({
            userId: advisorUser.id,
            employeeId,
            name: advisorUser.employee?.name ?? advisorUser.name,
            lineworksId: advisorUser.lineworksId,
          });
        }
      }
    }

    // mynavi_new の場合、または advisorName が見つからなかった場合 → マイナビ管理担当全員
    if (assignees.length === 0) {
      const mynaviUsers = await prisma.user.findMany({
        where: { isMynaviAssignee: true, status: "active" },
        include: { employee: { select: { id: true, name: true } } },
      });
      for (const u of mynaviUsers) {
        let employeeId = u.employee?.id;
        let employeeName = u.employee?.name ?? u.name;

        // User→Employee リレーションが未リンクの場合、名前でEmployee検索
        if (!employeeId) {
          const emp = await prisma.employee.findFirst({
            where: { name: u.name, status: "active" },
            select: { id: true, name: true },
          });
          if (emp) {
            employeeId = emp.id;
            employeeName = emp.name;
          }
        }

        if (employeeId) {
          assignees.push({
            userId: u.id,
            employeeId,
            name: employeeName,
            lineworksId: u.lineworksId,
          });
        }
      }
    }

    if (assignees.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "マイナビ管理担当が設定されていません。社員管理画面で設定してください。",
        },
        { status: 400 }
      );
    }

    // 4. 「日程調整」カテゴリ取得
    const category = await prisma.taskCategory.findFirst({
      where: { name: "日程調整" },
      include: {
        fields: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: "「日程調整」カテゴリが見つかりません。シードを実行してください" },
        { status: 500 }
      );
    }

    // 5. フィールドマッピング
    const fieldMap: Record<string, string> = {
      "希望日時": preferredDates,
      "面談形式": meetingFormat,
    };
    // 備考: 既存の notes に加え、氏名を PDF由来に差し替えた場合はフォーム入力の元氏名を保全する
    //   （照合ミス疑い時に人が元の手入力値を確認できるようにするため）。
    const noteParts: string[] = [];
    if (notes) noteParts.push(notes);
    if (nameWasSwapped) noteParts.push(`フォーム入力氏名: ${candidateName}`);
    if (noteParts.length > 0) {
      fieldMap["備考"] = noteParts.join("\n\n");
    }

    const fieldValuesData = category.fields
      .filter((f) => fieldMap[f.label] !== undefined)
      .map((f) => ({
        fieldId: f.id,
        value: fieldMap[f.label],
      }));

    // 6. Task作成（completionType: "any" = 誰か1人が完了したらタスク完了）
    const createdByUserId = assignees[0].userId;

    const task = await prisma.task.create({
      data: {
        title: taskTitle,
        status: "NOT_STARTED",
        categoryId: category.id,
        // 実在が確認できた candidateId のみ紐付け（無効値は FK エラーを避けて null）。
        candidateId: validatedCandidateId,
        createdByUserId,
        completionType: "any",
        assignees: {
          create: assignees.map((a) => ({ employeeId: a.employeeId })),
        },
        fieldValues: {
          create: fieldValuesData,
        },
      },
    });

    // 6.5 T-194: フォーム送信時の自動仮確定（オプトイン）。
    //   - 走るのは autoReserve===true かつ type==="mynavi_new" のときだけ。それ以外は完全に従来どおり。
    //   - 判定・枠取り・予約後処理は日程調整AI（resolve モードA）と同じ autoReserveFromPreferences。
    //     土日祝・当日・翌営業日〜2週間以内・9:00〜20:00開始・同一枠の多重仮予約上限は
    //     すべて既存ルール（match-slot.ts / jst.ts）がそのまま効く＝ここで二重に書かない。
    //   - **絶対に throw しない**。失敗してもタスク作成とレスポンスは成功させる（従来の送信体験を壊さない）。
    let autoReserveResult: AutoReserveResponse | null = null;
    /** LINE通知に足す「9/14(月)19:00-20:00」。仮予約できたときだけ入る。 */
    let autoReserveWhenLabel: string | null = null;
    if (autoReserve === true && type === "mynavi_new") {
      const deadline = Date.now() + AUTO_RESERVE_BUDGET_MS;
      const now = new Date();
      const method = methodFromFormatField(meetingFormat);
      const windows = parseDesiredWindows(preferredDates);

      try {
        if (windows.length === 0) {
          // 定型パース0件（想定外の書式）。空振りとして扱い、タスクは従来どおり未着手で残す。
          console.warn(`[create-schedule-task] autoReserve: 希望日時をパースできませんでした task=${task.id}`);
          autoReserveResult = { result: "not_reserved", reason: "excluded_only" };
        } else {
          const outcome = await autoReserveFromPreferences({
            candidateName: effectiveName,
            candidateId: validatedCandidateId,
            method,
            windows,
            now,
            mode: "task",
            taskId: task.id,
            deadline,
          });

          if (outcome.kind === "reserved") {
            autoReserveWhenLabel = eventTitleWhen(
              outcome.slot.date,
              outcome.slot.startTime,
              outcome.slot.endTime
            );
            autoReserveResult = {
              result: "reserved",
              slot: {
                start: jstIso(outcome.slot.date, outcome.slot.startTime),
                end: jstIso(outcome.slot.date, outcome.slot.endTime),
                label: reservedRangeLabel(outcome.slot.date, outcome.slot.startTime, outcome.slot.endTime),
              },
              method: outcome.method,
            };

            // 仮予約が成立したタスクは、RPA経路でモードA返信成功後になる状態（IN_PROGRESS）に揃える。
            //   RPA は COMPLETED を送るが resolveStoredStatus で IN_PROGRESS に読み替えられる（T-177）。
            //   コメントは AI_COMMENT_PREFIX 付き＝GET の hasAiReplyComment が true になり、
            //   RPA 再開時の再処理対象から外れる（二重処理防止）。
            //   ここで失敗しても仮予約自体は成立済みなので result=reserved のまま返す。
            try {
              const systemUserId = await resolveSystemUserId();
              if (systemUserId) {
                await prisma.taskComment.create({
                  data: {
                    taskId: task.id,
                    userId: systemUserId,
                    content:
                      `${AI_COMMENT_PREFIX}フォーム送信時に自動仮確定: ` +
                      `${autoReserveWhenLabel} ${outcome.method}`,
                  },
                });
              } else {
                console.error(`[create-schedule-task] autoReserve: コメント作者を解決できません task=${task.id}`);
              }
              await prisma.task.update({
                where: { id: task.id },
                data: { status: resolveStoredStatus("COMPLETED") },
              });
            } catch (e) {
              console.error("[create-schedule-task] autoReserve: タスクのコメント/状態更新に失敗:", e);
              await sendAutoReserveErrorAlert({ candidateName: effectiveName, taskId: task.id, error: e });
            }
          } else if (outcome.kind === "timeout") {
            autoReserveResult = { result: "not_reserved", reason: "timeout" };
          } else if (outcome.kind === "no_reply") {
            if (outcome.reason === "no_config") {
              // staging 等（仮予約カレンダー env 未設定）。何もしない・通知もしない。
              autoReserveResult = { result: "not_reserved", reason: "no_config" };
            } else {
              autoReserveResult = { result: "not_reserved", reason: "error" };
              if (outcome.reason === "create_failed") {
                // カレンダー読み取り不能は連携切れアラート（probe）が別途飛ぶため、ここでは書き込み失敗のみ通知。
                await sendAutoReserveErrorAlert({
                  candidateName: effectiveName,
                  taskId: task.id,
                  error: new Error("仮予約イベントの作成に失敗しました（createReservation が null）"),
                });
              }
            }
          } else {
            // today_only ＝ 当日希望のみ、unavailable ＝ 空き無し／全希望が範囲外（土日祝・2週間超）。
            // 「対象になり得る希望が1つも無かった」か「対象は見たが空いていなかった」かで理由を分ける。
            const eligible = classifyWindows(windows, now).inRange.length > 0;
            autoReserveResult = {
              result: "not_reserved",
              reason: outcome.kind === "today_only" || !eligible ? "excluded_only" : "no_slot",
            };
          }
        }
      } catch (e) {
        console.error("[create-schedule-task] autoReserve failed:", e);
        autoReserveResult = { result: "not_reserved", reason: "error" };
        await sendAutoReserveErrorAlert({ candidateName: effectiveName, taskId: task.id, error: e });
      }
    }

    // 7. LINE WORKS通知
    try {
      const botId = process.env.LINEWORKS_TASK_BOT_ID;
      const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
      const baseUrl = process.env.PORTAL_BASE_URL;

      if (botId && channelId) {
        const assigneeNamesStr = assignees.map((a) => a.name).join("、");

        const lines = [
          "📋 タスクが自動生成されました",
          "",
          "■ タイトル",
          taskTitle,
          "",
          "■ カテゴリ",
          "日程調整",
          "",
          "■ 担当者",
          assigneeNamesStr,
          "",
          "■ ステータス",
          "未着手",
          "",
          "■ 希望日時",
          preferredDates,
          "",
          "■ 面談形式",
          meetingFormat,
        ];

        if (notes) {
          lines.push("", "■ 備考", notes);
        }

        // T-194: 自動仮確定を走らせたときだけ、その結果を1行足す（従来の通知本文は不変）。
        if (autoReserveResult) {
          lines.push(
            "",
            autoReserveWhenLabel
              ? `自動仮確定: ${autoReserveWhenLabel}`
              : "自動仮確定: なし（空きなし／対象外）"
          );
        }

        lines.push("", "🔗 タスク詳細", `${baseUrl}/tasks/${task.id}`);

        // メンション付き通知を試行
        const mentionLines = assignees
          .filter((a) => a.lineworksId)
          .map((a) => `<m userId="${a.lineworksId}">`);

        if (mentionLines.length > 0) {
          const mentionedLines = [
            ...mentionLines,
            " タスクが自動生成されました",
            "",
            ...lines.slice(2),
          ];
          try {
            await sendBotMessage(botId, channelId, mentionedLines.join("\n"));
          } catch {
            await sendBotMessage(botId, channelId, lines.join("\n"));
          }
        } else {
          await sendBotMessage(botId, channelId, lines.join("\n"));
        }
      }
    } catch (notifyError) {
      console.error("LINE WORKS通知の送信に失敗:", notifyError);
    }

    // 8. レスポンス（T-194: 既存キーは不変。autoReserve=true のときだけ結果を1キー足す）
    return NextResponse.json({
      success: true,
      taskId: task.id,
      taskTitle,
      ...(autoReserveResult ? { autoReserve: autoReserveResult } : {}),
    });
  } catch (error) {
    console.error("Failed to create schedule task:", error);
    return NextResponse.json(
      { success: false, error: "タスク作成に失敗しました" },
      { status: 500 }
    );
  }
}
