const DEFAULT_DAS_API_URL = "http://127.0.0.1:4031";

export function getDasApiUrl(): string {
  const configured = process.env.DAS_API_URL?.trim();
  const url = configured || DEFAULT_DAS_API_URL;
  return url.replace(/\/+$/, "");
}

export const DAS_API_URL = getDasApiUrl();

export async function fetchDasBackend(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${DAS_API_URL}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
    });
  } catch {
    throw new Error(
      `Não foi possível conectar ao servidor DAS (${DAS_API_URL}). Defina a variável DAS_API_URL no ambiente do frontend (ex.: http://127.0.0.1:4031 no mesmo VPS).`
    );
  }
}
