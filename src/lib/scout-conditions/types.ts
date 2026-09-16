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
  kind: string; // UNSENT / SENT / INDIVIDUAL
  name: string;
  subject: string;
  body: string;
  sortOrder: number;
  isActive: boolean;
};

export type HolidayDto = { date: string; name: string }; // date = "YYYY-MM-DD"

export type RunDto = {
  id: string;
  executedAt: string; // ISO（真のUTC instant）
  extractedCount: number;
  sentCount: number;
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
  latestRun: RunDto | null;
  runs: RunDto[]; // 新しい順
  // T-203: この条件の全実行の合計（一覧の「抽出 / 送信」列。実行が1件も無ければ null＝画面は "-"）
  //   枯渇回（isDry）も実際に配信しているので合計に含める。dryRun の検証リクエストは DB に書かれないため元から入らない。
  totalExtractedCount: number | null;
  totalSentCount: number | null;
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
