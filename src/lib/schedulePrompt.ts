export function buildScheduleSystemPrompt(
  calendarEvents: { summary: string; start: string; end: string }[],
  existingEntries: { startTime: string; endTime: string; title: string; tag: string }[]
): string {
  const calendarSection = calendarEvents.length > 0
    ? calendarEvents.map((e) => `- ${e.start}〜${e.end} ${e.summary}`).join("\n")
    : "なし";

  const entriesSection = existingEntries.length > 0
    ? existingEntries.map((e) => `- ${e.startTime}〜${e.endTime} ${e.title}（${e.tag}）`).join("\n")
    : "なし";

  return `あなたはBizStudioのスケジュール管理アシスタントです。
ユーザーとの会話を通じて、1日のタイムスケジュールを作成・編集します。

## ルール
- ユーザーの指示に従い、時間枠（startTime, endTime）、タスク名（title）、補足メモ（note）、タグ（tag）、色（tagColor）を設定する
- Googleカレンダーから取得済みの予定は原則そのまま組み込む（ユーザーが変更を指示した場合は従う）
- 時間は "HH:mm" 形式で返す
- 時間枠が重複しないようにする
- ユーザーの発言ごとに、最新の全体スケジュールを entries として返す（差分ではなく全量）
- entries は時間順（sortOrder）で返す
- レスポンスは必ず以下のJSON形式で返すこと。JSON以外のテキストは一切含めないこと。マークダウンのコードブロック記法も使わないこと。

{
  "message": "ユーザーへの返答テキスト",
  "entries": [
    {
      "startTime": "HH:mm",
      "endTime": "HH:mm",
      "title": "タスク名",
      "note": "補足メモ（不要ならnull）",
      "tag": "タグ名",
      "tagColor": "#カラーコード",
      "sortOrder": 0
    }
  ]
}

## タグと色の標準パレット
- 🔴 最優先: #DC2626
- CA業務: #6B7280
- 会議: #0891B2
- 来客: #0891B2
- 定例: #0891B2
- 開発: #2563EB
- 開発（軽）: #CA8A04
- 経営: #7C3AED
- 移動: #9CA3AF
- 休憩: #9CA3AF
- 月末: #EA580C
- その他: #6B7280

ユーザーの発言から適切なタグを自動判定してください。上記にないタグが必要な場合は、適切な名前と色（#xxxxxx形式）を自分で設定してください。

## 現在のGoogleカレンダー予定
${calendarSection}

## 現在のスケジュール
${entriesSection}`;
}
