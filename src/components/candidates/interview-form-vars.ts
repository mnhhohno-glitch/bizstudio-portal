// 面談記録画面（InterviewForm）と面談スクリプトタブ（InterviewScriptTab）で共有する配色（CSS 変数）。
// T-208 step4 で InterviewForm.tsx から移した（中身は同じ）。ルートの style に広げて当てる。

export const INTERVIEW_FORM_CSS_VARS: React.CSSProperties & Record<string, string> = {
  "--im-bg": "#ffffff",
  "--im-bg2": "#f7f7f5",
  "--im-bg3": "#f1efe8",
  "--im-bg-info": "#e6f1fb",
  "--im-bg-ok": "#e1f5ee",
  "--im-bg-warn": "#faeeda",
  "--im-fg": "#1a1a19",
  "--im-fg2": "#5f5e5a",
  "--im-fg3": "#888780",
  "--im-fg-info": "#0c447c",
  "--im-fg-ok": "#0f6e56",
  "--im-fg-warn": "#854f0b",
  "--im-fg-err": "#791f1f",
  "--im-bdr": "rgba(0,0,0,0.08)",
  "--im-bdr2": "rgba(0,0,0,0.15)",
  "--im-bdr-info": "#85b7eb",
};

export const INTERVIEW_FORM_ROOT_STYLE: React.CSSProperties = {
  ...INTERVIEW_FORM_CSS_VARS,
  fontFamily: '-apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--im-fg)",
  background: "var(--im-bg2)",
};
