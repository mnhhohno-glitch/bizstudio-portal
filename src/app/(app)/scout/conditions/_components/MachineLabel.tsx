"use client";

// T-194: 号機の表示（号機番号＋担当者実名）。T-197 で絞り込みパネル廃止に伴い MachineChip は削除。担当者名は recruiterDisplay.ts の RC_ROSTER から導出し、独自の対応表を持たない。
import { splitRecruiterDisplay } from "@/lib/recruiterDisplay";
import { machineColor } from "@/lib/scout-conditions/constants";

export function machineRecruiterName(machineNo: number): string {
  const d = splitRecruiterDisplay(`${machineNo}号機`);
  return d.unit ? d.name : "";
}

export function MachineLabel({ machineNo, compact = false }: { machineNo: number; compact?: boolean }) {
  const name = machineRecruiterName(machineNo);
  const c = machineColor(machineNo);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${c.dot}`} />
      <span className="font-semibold text-[#374151]">{machineNo}号機</span>
      {!compact && name && <span className="text-[11px] text-[#6B7280]">{name}</span>}
    </span>
  );
}
