import { NextResponse } from "next/server";
import { fetchDasBackend, getDasApiUrl, readBackendError } from "@/lib/backend";

export const dynamic = "force-dynamic";

export async function GET() {
  const dasApiUrl = getDasApiUrl();

  try {
    const response = await fetchDasBackend("/");
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          dasApiUrl,
          error: await readBackendError(response),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      dasApiUrl,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        dasApiUrl,
        error: error instanceof Error ? error.message : "Falha ao consultar backend",
      },
      { status: 502 }
    );
  }
}
