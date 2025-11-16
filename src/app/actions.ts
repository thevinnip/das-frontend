'use server';

export async function processCnpjs(cnpjs: string[], referenceMonth: string) {
  try {
    const response = await fetch("http://localhost:4030/process-cnpjs", {
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
  } catch (error: any) {
    throw new Error(error.message);
  }
}

export async function getTaskStatus(taskId: string) {
  try {
    const response = await fetch(`http://localhost:4030/task/${taskId}`, {
      credentials: "include"
    });
    
    if (!response.ok) {
      throw new Error("Erro ao buscar status da task");
    }

    return await response.json();
  } catch (error: any) {
    throw new Error(error.message);
  }
}

export async function downloadDas(taskId: string, referenceMonth: string) {
  try {
    const response = await fetch(`http://localhost:4030/download/${taskId}`, {
      credentials: "include"
    });
    
    if (!response.ok) {
      throw new Error("Erro ao baixar arquivo");
    }

    const blob = await response.blob();
    return blob;
  } catch (error: any) {
    throw new Error(error.message);
  }
} 