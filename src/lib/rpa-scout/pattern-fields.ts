// パターンAPI（POST/PATCH）共用の条件フィールド取り出し
export function pickConditionFields(body: Record<string, unknown>) {
  const toIntOrNull = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
  const toStrOrNull = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const toStrArrayOrNull = (v: unknown) =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")
      ? (v as string[])
      : null;

  return {
    sendStatus: toStrOrNull(body.sendStatus),
    registDays: toIntOrNull(body.registDays),
    registDirection: toStrOrNull(body.registDirection),
    lastLoginDays: toIntOrNull(body.lastLoginDays),
    areaType: toStrOrNull(body.areaType),
    prefectures: toStrArrayOrNull(body.prefectures),
    education: toStrOrNull(body.education),
    gradYearFrom: toIntOrNull(body.gradYearFrom),
    gradYearTo: toIntOrNull(body.gradYearTo),
    companyCount: toIntOrNull(body.companyCount),
    jobCategories: toStrArrayOrNull(body.jobCategories),
    jobCategoryPriority: toStrOrNull(body.jobCategoryPriority),
    workLocations: toStrArrayOrNull(body.workLocations),
    workLocationPriority: toStrOrNull(body.workLocationPriority),
    transferTiming: toStrOrNull(body.transferTiming),
  };
}
