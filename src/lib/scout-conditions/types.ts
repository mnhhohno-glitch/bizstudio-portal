// T-194: API ↔ 画面で共有する DTO（クライアントから import できるよう Prisma 型に依存しない）

export type MachineDto = {
  id: string;
  machineNo: number;
  isActive: boolean;
  defaultTemplateId: string | null;
  /** T-195: 予約切れで起票した「スカウト配信」タスクのうち未完了のもの（無ければ null）。警告帯のリンク先 */
  queueEmptyTask: { id: string; title: string } | null;
};

export type TemplateDto = {
  id: string;
  seqNo: number | null; // T-207: テンプレート番号（デプロイ中の窓で作られた直後だけ null になり得る）
  templateNo: string | null; // T-207: 表示用「T-001」
  kind: string; // UNSENT / SENT / INDIVIDUAL
  name: string;
  subject: string;
  body: string;
  sortOrder: number;
  isActive: boolean;
};

// T-207: テンプレート管理画面（/scout/templates）の一覧レスポンス
export type TemplatesResponse = {
  templates: TemplateDto[];
  /** そのテンプレートを使っている配信条件の件数。1件以上なら削除できない */
  usageById: Record<string, number>;
};

// T-207: CSV 取り込みのプレビュー（execute=false）と実行（execute=true）の結果
export type TemplateImportRowDto = {
  lineNo: number; // CSV の行番号（ヘッダーを1行目とした人が数える番号）
  name: string;
  kind: string;
  subject: string;
  body: string;
  action: "CREATE" | "UPDATE";
  templateNo: string | null; // 上書きのとき維持される番号（新規は取り込み時に採番するので null）
};
export type TemplateImportErrorDto = { lineNo: number; name: string; reason: string };
export type TemplateImportResponse = {
  executed: boolean;
  rows: TemplateImportRowDto[];
  errors: TemplateImportErrorDto[];
  createCount: number;
  updateCount: number;
  /** executed=true のときだけ入る実績 */
  created: number | null;
  updated: number | null;
};

export type HolidayDto = { date: string; name: string }; // date = "YYYY-MM-DD"

export type RunDto = {
  id: string;
  executedAt: string; // ISO（真のUTC instant）
  extractedCount: number;
  sentCount: number;
  /** T-206: マイナビの検索結果件数（母数）。RPA 未改修の間は null */
  searchResultCount: number | null;
  isDry: boolean;
  rawNotification: string | null;
};

export type ConditionDto = {
  id: string;
  machineId: string;
  machineNo: number;
  seqNo: number | null; // T-197: 号機ごとの通し番号（旧コードで作られた直後だけ null になり得る）
  recordNo: string | null; // T-197: 表示用「1-001」
  status: string; // RUNNING / QUEUED / DRY / DONE
  queueOrder: number;
  searchTarget: string; // EXCLUDE / ONLY / INCLUDE
  registDateMode: string; // PERIOD / DATE
  registDays: number | null;
  registDateFrom: string | null; // "YYYY-MM-DD"
  registDateTo: string | null;
  lastLoginDays: number;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
  residenceMode: string; // 居住地: NATIONWIDE / EAST / WEST / PREFECTURE（T-196 で areaMode から改名）
  residencePrefectures: string[];
  workPrefMode: string; // 希望勤務地: ALL / SELECTED（T-196）
  workPrefectures: string[];
  templateId: string | null;
  templateKind: string | null;
  templateName: string | null;
  plannedCount: number | null;
  deliveryDate: string | null; // "YYYY-MM-DD"
  createdById: string | null;
  createdByName: string | null;
  createdAt: string; // ISO（予約登録日時）
  updatedAt: string;
  // T-214: 人が最後に保存した日時・操作者（自動処理・▲▼では動かない）。未更新なら null（画面は "-"）
  editedAt: string | null;
  editedById: string | null;
  editedByName: string | null;
  // T-214: 同日の他号機（稼働中）の有効・予約の条件で 7 軸すべてが交わるもののレコード番号（一覧の「重なり」印用。
  //   一覧 GET でサーバーが付ける。単件の POST/PATCH のレスポンスでは空配列）
  overlapRecordNos: string[];
  latestRun: RunDto | null;
  runs: RunDto[]; // 新しい順
  // T-203: この条件の全実行の合計（一覧の「抽出 / 送信」列。実行が1件も無ければ null＝画面は "-"）
  //   枯渇回（isDry）も実際に配信しているので合計に含める。dryRun の検証リクエストは DB に書かれないため元から入らない。
  totalExtractedCount: number | null;
  totalSentCount: number | null;
  // T-213: 検索結果件数は「初回の値」（値を持つ実行のうち executed_at が最も古いもの）。
  //   T-206 までは実行回数分を合算していたため、1日に何回も走る条件で 26859 のような母数になっていた。
  //   マイナビの検索結果件数はその条件の母数なので、最初に測った値を代表値にする（1件も無ければ null＝画面は "-"）。
  firstSearchResultCount: number | null;
  // T-213: 実行回数（runs.length と同じ。一覧の「実行日時」下段に「3回」と出す）
  runCount: number;
};

export type ConditionsResponse = {
  machines: MachineDto[];
  templates: TemplateDto[];
  holidays: HolidayDto[];
  conditions: ConditionDto[];
};

// 作成・更新の入力（PATCH は部分更新可）。
// T-197: 作成（POST）では status / queueOrder はサーバーが自動決定するため無視される（編集＝PATCH でのみ有効）
export type ConditionInput = {
  machineId: string;
  status: string;
  queueOrder: number;
  searchTarget: string;
  registDateMode: string;
  registDays: number | null;
  registDateFrom: string | null;
  registDateTo: string | null;
  lastLoginDays: number;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
  residenceMode: string;
  residencePrefectures: string[];
  workPrefMode: string;
  workPrefectures: string[];
  templateId: string | null;
  plannedCount: number | null;
  deliveryDate: string | null;
};

// ---- T-213: 実行履歴タブ（GET /api/scout/runs） ----
// 1行＝scout_runs 1件。条件側の表示項目は「その条件に現在設定されているもの」（実行時の値は RPA から届かない）。
export type RunHistoryRowDto = {
  id: string;
  executedAt: string; // ISO（真のUTC instant）
  extractedCount: number;
  sentCount: number;
  searchResultCount: number | null;
  isDry: boolean;
  machineId: string;
  machineNo: number;
  /** 号機の担当者名（RC_ROSTER 由来。無ければ ""） */
  recruiterName: string;
  conditionId: string;
  recordNo: string | null;
  /** 条件の現在の状態（RUNNING / QUEUED / DRY / DONE） */
  status: string;
  searchTarget: string;
  registDateMode: string;
  registDays: number | null;
  registDateFrom: string | null;
  registDateTo: string | null;
  lastLoginDays: number;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
  residenceMode: string;
  residencePrefectures: string[];
  workPrefMode: string;
  workPrefectures: string[];
  templateKind: string | null;
  templateName: string | null;
};

export type RunHistoryQuery = {
  from: string | null; // "YYYY-MM-DD"（実行日時の JST 日付・含む）
  to: string | null;
  machineNos: number[]; // 空＝絞り込みなし
  dryOnly: boolean;
  q: string; // 部分一致（レコード番号／条件の要約／テンプレート名／担当者名）
  page: number; // 1始まり
};

export type RunHistoryResponse = {
  rows: RunHistoryRowDto[];
  total: number;
  page: number;
  pageSize: number;
};
