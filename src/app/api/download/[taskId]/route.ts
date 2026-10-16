import { NextResponse } from "next/server";
import { fetchDasBackend } from "@/lib/backend";

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
    const response = await fetchDasBackend(`/download/${encodeURIComponent(taskId)}`);

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
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Falha ao baixar o arquivo";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
