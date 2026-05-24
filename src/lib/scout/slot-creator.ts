import { createDailySlots, parseSlotDate } from "@/lib/scout/slot-helpers";

export interface SlotCreationResult {
  status: "CREATED" | "SKIPPED";
  createdCount: number;
  targetDate: string;
}

export async function createSlotsForDate(
  targetDate: string,
): Promise<SlotCreationResult> {
  const date = parseSlotDate(targetDate);
  const result = await createDailySlots(date);
  return {
    status: result.skipped ? "SKIPPED" : "CREATED",
    createdCount: result.created,
    targetDate: date.toISOString().slice(0, 10),
  };
}
