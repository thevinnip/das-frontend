import { NextResponse } from "next/server";
import { DAS_API_URL } from "@/lib/backend";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;

  if (!taskId) {
    return NextResponse.json({ error: "Task inválida" }, { status: 400 });
  }

  try {
    const response = await fetch(`${DAS_API_URL}/download/${encodeURIComponent(taskId)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      return NextResponse.json(
        { error: data?.error || "Erro ao baixar arquivo" },
        { status: response.status }
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const disposition =
      response.headers.get("content-disposition") || 'attachment; filename="das.zip"';

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": disposition,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Falha ao baixar o arquivo" },
      { status: 502 }
    );
  }
}
