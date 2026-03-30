import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getCandidateContext } from "@/lib/advisor-context";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  try {
    const context = await getCandidateContext(candidateId);
    return NextResponse.json({ context });
  } catch (error) {
    console.error("[Context] Error:", error);
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
