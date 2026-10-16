'use server';

import { DAS_API_URL } from "@/lib/backend";

export async function processCnpjs(cnpjs: string[], referenceMonth: string) {
  try {
    const response = await fetch(`${DAS_API_URL}/process-cnpjs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        cnpjs,
        referenceMonth,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Erro ao processar CNPJs");
    }

    return data;
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }

    throw new Error(String(error));
  }
}
