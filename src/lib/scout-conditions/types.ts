// T-194: API ↔ 画面で共有する DTO（クライアントから import できるよう Prisma 型に依存しない）

export type MachineDto = {
  id: string;
  machineNo: number;
  isActive: boolean;
  defaultTemplateId: string | null;
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
  areaMode: string; // NATIONWIDE / EAST / WEST / PREFECTURE
  prefectures: string[];
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
};

export type ConditionsResponse = {
  machines: MachineDto[];
  templates: TemplateDto[];
  holidays: HolidayDto[];
  conditions: ConditionDto[];
};

// 作成・更新の入力（PATCH は部分更新可）
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
  areaMode: string;
  prefectures: string[];
  templateId: string | null;
  plannedCount: number | null;
  deliveryDate: string | null;
};
