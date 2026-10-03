// T-208 step2: 初回面談の台本モードの型。
// 台本の中身は script-v1.ts、欄への入れ方の決まりは apply.ts、差し込みは render.ts、自動計算は calc.ts。
// ここは「形」だけ（画面・API・確認スクリプトで共有する）。

export type PartId = "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7";

export type ScriptPart = { id: PartId; no: number; title: string };

/** 台本の答えを入れる先。detail = interview_details の欄 / wh = work_histories（場面の会社）の欄 / workStyle = 働き方のチェック */
export type FieldTarget =
  | { kind: "detail"; field: string; memo?: boolean }
  | { kind: "wh"; field: string; memo?: boolean }
  | { kind: "workStyle"; item: string };

export type ScriptWrite = { target: FieldTarget; value: string };

/** 1つの場面の答え（押したボタンの値・入力した文字）。キーはボタングループ／入力の key */
export type SceneAnswer = {
  choices?: Record<string, string | string[]>;
  inputs?: Record<string, string>;
  at?: string;
};

/** 場面の実行時キー（"s5-wh-reason#0" のように会社ごとに展開したもの）→ 答え */
export type AnswerMap = Record<string, SceneAnswer>;

/** 台本が入れた欄のパス（"d.jobChangeTimeline" / "wh.0.jobTypeMemo" / "ws.固定残業NG"）→ 入れた値 */
export type AppliedMap = Record<string, string>;

export type ScriptButton = {
  label: string;
  /** 保存する値（省略時は label そのもの） */
  value?: string;
  /** 押したあとに出す拾う一言 */
  pickup?: string;
  /** 押した値を入れる先（グループの target より優先） */
  target?: FieldTarget;
  /** 押したときに追加で入れるもの（Word・PowerPoint のように2欄に入れるなど） */
  writes?: ScriptWrite[];
  /** 次の場面の id（省略時は順番どおり） */
  next?: string;
  /** この場面の他の答えで出し分ける（小分類の候補など） */
  showIf?: (sa: SceneAnswer) => boolean;
};

export type ScriptButtonGroup = {
  key: string;
  label?: string;
  /** 複数選択（働き方） */
  multi?: boolean;
  buttons: ScriptButton[];
  /** グループ共通の入れ先（ボタンの value を入れる） */
  target?: FieldTarget;
  showIf?: (sa: SceneAnswer) => boolean;
};

export type ScriptInput = {
  key: string;
  label: string;
  type: "text" | "number" | "month" | "date" | "time";
  unit?: string;
  placeholder?: string;
  target?: FieldTarget;
  /** 欄に入れる文字の整え方（見出しを付けるなど）。省略時は入力そのまま */
  format?: (v: string) => string;
  showIf?: (sa: SceneAnswer) => boolean;
};

export type ScriptCompany = {
  index: number;
  name: string;
  hireDate: string;
  /** 退職年月（空白期間の間隔の判定に使う。無ければ ""） */
  leaveDate: string;
  jobDesc: string;
  isCurrent: boolean;
  /** 職歴の行がまだ無い（登録情報からの仮の会社）。欄には入れられない */
  placeholder?: boolean;
};

/**
 * T-208 不具合修正 #2: 空白期間（勤め先の名前が無い期間、または学校／会社と次の会社の間が6か月以上空いた期間）。
 * position は「この空白の次の会社の番号」（最後の会社の後なら companies.length）。会社ごとの場面の並びの中で、その会社の前に出す。
 */
export type ScriptGap = {
  index: number;
  position: number;
  /** 前の学校／会社の名前（無ければ ""。差し込みでは「ご卒業」「前の会社」に言い換える） */
  before: string;
  /** 次の会社の名前（無ければ ""＝今まで） */
  after: string;
  /** 期間の長さ（"1年6ヶ月"。分からなければ ""） */
  length: string;
  /** 面談準備の整理の時系列に項目があったときの中身と時期（"受験勉強"・"2021年4月〜2021年9月"）。間隔から出したときは "" */
  title: string;
  period: string;
  source: "timeline" | "interval";
};

/** 面談準備の質問（台本用）。index は整理の questions の添字（Q番号・「聞いた」のキー）。company は関わる会社名か「全体」（T-208 step3） */
export type PrepQuestionView = { index: number; question: string; why: string; mismatch: boolean; asked: boolean; company: string };

/** 差し込み・条件分岐に使う、この面談の実行時の情報 */
export type ScriptContext = {
  candidateName: string;
  caName: string;
  caFamilyName: string;
  /** 面談記録の開始時刻 "HH:MM"（空なら「本日〇時から」を省く） */
  startTime: string;
  /** 面談記録の手法（電話／オンライン／対面。空なら電話の版） */
  tool: string;
  latestCompany: string;
  school: string;
  department: string;
  gradYear: string;
  /** T-208 不具合修正 #3: 最終学歴が高校（高専・高等専修学校は含まない）。学部を聞く文を出さない */
  schoolIsHighSchool: boolean;
  companies: ScriptCompany[];
  /** T-208 不具合修正 #2: 空白期間（position 順） */
  gaps: ScriptGap[];
  /** 登録メールアドレスの先頭の文字 */
  emailHead: string;
  /** 在職状況（面談記録の欄。台本で答えたらそちらを優先） */
  employmentStatus: string;
  prepQuestions: PrepQuestionView[];
  /** 会社ごとにくり返す場面のときの会社番号（0始まり） */
  companyIndex?: number;
  /** 空白期間の場面のときの空白の番号（gaps の index） */
  gapIndex?: number;
  /** 今日（自動計算の基準。確認スクリプトで固定できる） */
  today?: Date;
};

export type ScriptScene = {
  id: string;
  part: PartId;
  title: string;
  /** 読むセリフ。〔差し込み〕と {{if:条件}}…{{else}}…{{/if}} を使える。段落は空行で分ける */
  say: string;
  groups?: ScriptButtonGroup[];
  inputs?: ScriptInput[];
  /** ［飛ばす］ボタンを出す */
  skippable?: boolean;
  /**
   * 会社ごとにくり返す／空白期間ごとにくり返す。
   * T-208 不具合修正 #1: 連続する repeat 付きの場面は1つのかたまりとして、会社を外側にして一周ずつ展開する（expandScenes）
   */
  repeat?: "company" | "gap";
  /** false のときはこの場面を飛ばす */
  when?: (ctx: ScriptContext, answers: AnswerMap) => boolean;
  /** 会社ごとにくり返す場面で、false の会社はその場面を出さない（T-208 step3: その会社の質問が無ければ出さない） */
  whenCompany?: (ctx: ScriptContext, companyIndex: number, answers: AnswerMap) => boolean;
  /** 新人向けの用語メモなど */
  notes?: string[];
  /** 自動計算の結果（行ごと） */
  calc?: (sa: SceneAnswer, ctx: ScriptContext, answers: AnswerMap) => string[];
  /** ボタンに無い動的な拾う一言（退職までの月数で変わる等） */
  pickup?: (sa: SceneAnswer, ctx: ScriptContext, answers: AnswerMap) => string | null;
  /** 入れ先の小さな表示 */
  targetsHint?: string;
  /** 特別な描画（面談準備の質問一覧／連絡方法＝案内メール） */
  kind?: "prep-questions" | "contact";
};

/** 会社ごと・空白期間ごとに展開した、画面で使う場面 */
export type RuntimeScene = {
  key: string;
  scene: ScriptScene;
  companyIndex?: number;
  gapIndex?: number;
};

/** answers の中に入れる進み具合（場面の答えとは別のキー） */
export const META_KEY = "__meta";
export type ScriptMeta = { currentKey?: string; doneParts?: PartId[] };
