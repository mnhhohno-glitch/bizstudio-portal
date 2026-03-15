import type { AttendanceStatus, PunchType } from "@prisma/client";

type StateTransition = {
  allowed: PunchType[];
  next: Partial<Record<PunchType, AttendanceStatus>>;
};

const STATE_TRANSITIONS: Record<AttendanceStatus, StateTransition> = {
  NOT_STARTED: {
    allowed: ["CLOCK_IN"],
    next: { CLOCK_IN: "WORKING" },
  },
  WORKING: {
    allowed: ["BREAK_START", "INTERRUPT_START", "CLOCK_OUT"],
    next: {
      BREAK_START: "ON_BREAK",
      INTERRUPT_START: "INTERRUPTED",
      CLOCK_OUT: "FINISHED",
    },
  },
  ON_BREAK: {
    allowed: ["BREAK_END"],
    next: { BREAK_END: "WORKING" },
  },
  INTERRUPTED: {
    allowed: ["INTERRUPT_END"],
    next: { INTERRUPT_END: "WORKING" },
  },
  FINISHED: {
    allowed: [],
    next: {},
  },
};

/** 現在のステートで押せるボタン一覧 */
export function getAvailableActions(status: AttendanceStatus): PunchType[] {
  return STATE_TRANSITIONS[status]?.allowed ?? [];
}

/** 遷移先ステートを返す。不正な操作なら null */
export function getNextStatus(
  current: AttendanceStatus,
  action: PunchType
): AttendanceStatus | null {
  return STATE_TRANSITIONS[current]?.next[action] ?? null;
}
