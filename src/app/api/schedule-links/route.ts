import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { customAlphabet } from "nanoid";

const generateToken = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  7
);

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { candidateName, advisorName, interviewMethod, type = "interview" } = body;

  if (!candidateName || !advisorName) {
    return NextResponse.json(
      { error: "必須パラメータが不足しています" },
      { status: 400 }
    );
  }

  if (type === "interview" && !interviewMethod) {
    return NextResponse.json(
      { error: "面接方式を指定してください" },
      { status: 400 }
    );
  }

  const token = generateToken();

  await prisma.scheduleLink.create({
    data: {
      token,
      candidateName,
      advisorName,
      interviewMethod: interviewMethod || "",
      type,
    },
  });

  const prefix = type === "consultation" ? "c" : "i";
  const url = `https://schedule.bizstudio.co.jp/${prefix}/${token}`;

  return NextResponse.json({ token, url });
}
