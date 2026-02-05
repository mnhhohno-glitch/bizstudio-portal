import { prisma } from "@/lib/prisma";
import type { AuditTargetType } from "@prisma/client";

type WriteAuditArgs = {
  actorUserId: string | null;
  action: string;
  targetType: AuditTargetType;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAudit(args: WriteAuditArgs) {
  const { actorUserId, action, targetType, targetId = null, metadata } = args;
  // actorUserIdが無いケース（ログイン失敗など）は anonymous ユーザーを使う
  let actor = actorUserId;
  if (!actor) {
    const anon = await prisma.user.findUnique({ where: { email: "anonymous@local" } });
    actor = anon?.id ?? "anonymous";
  }
  await prisma.auditLog.create({
    data: {
      actorUserId: actor,
      action,
      targetType,
      targetId,
      metadata: metadata ?? undefined,
    },
  });
}
