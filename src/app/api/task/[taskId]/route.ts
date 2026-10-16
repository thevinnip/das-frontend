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
    const response = await fetch(`${DAS_API_URL}/task/${encodeURIComponent(taskId)}`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error || "Erro ao buscar status da task" },
        { status: response.status }
      );
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Falha ao consultar o servidor" },
      { status: 502 }
    );
  }
}
