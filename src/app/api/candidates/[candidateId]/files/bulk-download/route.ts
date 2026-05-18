import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";
import archiver from "archiver";
import { PassThrough } from "stream";

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const { fileIds } = (await req.json()) as { fileIds: string[] };

  if (!fileIds?.length) {
    return NextResponse.json({ error: "fileIds is required" }, { status: 400 });
  }

  const files = await prisma.candidateFile.findMany({
    where: { id: { in: fileIds }, candidateId },
    select: { driveFileId: true, fileName: true },
  });

  if (files.length === 0) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }

  // Single file: direct download without zipping
  if (files.length === 1) {
    try {
      const { base64, mimeType } = await downloadFileFromDrive(files[0].driveFileId);
      const buffer = Buffer.from(base64, "base64");
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(files[0].fileName)}"`,
        },
      });
    } catch {
      return NextResponse.json({ error: "ダウンロードに失敗しました" }, { status: 502 });
    }
  }

  // Multiple files: stream ZIP response
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  // 別フォルダの同名ファイルは ZIP 内で衝突するため、自動連番を付与する
  // （例: 履歴書.pdf → 履歴書 (2).pdf）。フォルダ名はファイル名に含めない仕様。
  const usedNames = new Set<string>();
  const renamed: { original: string; renamedTo: string }[] = [];
  const uniqueEntryName = (fileName: string): string => {
    if (!usedNames.has(fileName)) {
      usedNames.add(fileName);
      return fileName;
    }
    const dot = fileName.lastIndexOf(".");
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";
    let n = 2;
    let candidate = `${stem} (${n})${ext}`;
    while (usedNames.has(candidate)) {
      n += 1;
      candidate = `${stem} (${n})${ext}`;
    }
    usedNames.add(candidate);
    renamed.push({ original: fileName, renamedTo: candidate });
    return candidate;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const passthrough = new PassThrough();
      const archive = archiver("zip", { zlib: { level: 5 } });
      archive.pipe(passthrough);

      passthrough.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      passthrough.on("end", () => {
        controller.close();
      });
      passthrough.on("error", (err) => {
        console.error("[BulkDownload] Stream error:", err);
        controller.error(err);
      });

      for (const file of files) {
        try {
          const { base64 } = await downloadFileFromDrive(file.driveFileId);
          const buffer = Buffer.from(base64, "base64");
          archive.append(buffer, { name: uniqueEntryName(file.fileName) });
        } catch (e) {
          console.error(`[BulkDownload] Failed to download ${file.fileName}:`, e);
        }
      }

      // 同名衝突でリネームが発生した場合は README.txt を同梱して通知
      if (renamed.length > 0) {
        const readme = [
          "【ご注意】同名ファイルの自動リネームについて",
          "",
          "別フォルダに同じ名前のファイルが存在したため、",
          "ZIP 内では以下のファイル名を自動で変更しています。",
          "",
          ...renamed.map((r) => `・${r.original}  →  ${r.renamedTo}`),
          "",
          "※ ファイルの中身は変更されていません。",
        ].join("\r\n");
        archive.append(Buffer.from(readme, "utf-8"), { name: "README.txt" });
      }

      await archive.finalize();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="bookmarks_${date}.zip"`,
    },
  });
}
