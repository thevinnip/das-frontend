const DEFAULT_DAS_API_URL = "http://192.99.145.94:4031";

export function getDasApiUrl(): string {
  const configured = process.env.DAS_API_URL?.trim();
  const url = configured || DEFAULT_DAS_API_URL;
  return url.replace(/\/+$/, "");
}

export async function readBackendError(response: Response): Promise<string> {
  const text = await response.text();

  try {
    const json = JSON.parse(text) as { error?: string };
    if (json?.error) return json.error;
  } catch {
    // resposta não veio em JSON
  }

  if (text.trim()) {
    return text.trim().slice(0, 300);
  }

  return `Erro HTTP ${response.status} ao falar com o backend DAS`;
}

export async function fetchDasBackend(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const baseUrl = getDasApiUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
    });
  } catch {
    throw new Error(
      `Não foi possível conectar ao servidor DAS (${baseUrl}). Verifique se o das-backend está no ar na porta 4031. No Docker no mesmo VPS, use DAS_API_URL=http://host.docker.internal:4031.`
    );
  }
}
