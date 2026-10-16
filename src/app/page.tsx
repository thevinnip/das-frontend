"use client";

import { useState, useEffect } from "react";
import { processCnpjs } from "./actions";

interface TaskProgress {
  cnpj: string;
  nome: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

interface Task {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  cnpjs: string[];
  referenceMonth: string;
  startDate: Date;
  endDate?: Date;
  error?: string;
  progress: TaskProgress[];
  totalProcessed: number;
  totalSuccess: number;
  totalError: number;
}

const STORAGE_KEY = "das-session";

interface StoredSession {
  taskId: string;
  month: string;
  year: string;
  cnpjList: string[];
  task: Task | null;
  downloadPending: boolean;
}

const downloadsStarted = new Set<string>();

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.taskId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function updateSession(patch: Partial<StoredSession>) {
  const current = readSession();
  if (!current) return;
  writeSession({ ...current, ...patch });
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

async function downloadTaskZip(taskId: string, month: string, year: string) {
  const response = await fetch(`/api/download/${encodeURIComponent(taskId)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    let message = "Erro ao baixar arquivo";
    try {
      const body = await response.json();
      if (body?.error) message = String(body.error);
    } catch {
      // a resposta de erro nem sempre vem em JSON
    }
    throw new Error(message);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("O arquivo recebido não é um ZIP válido");
  }

  const blob = new Blob([bytes], { type: "application/zip" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `das_${month}_${year}.zip`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export default function Home() {
//  const [cnpjs, setCnpjs] = useState<string>("");
  const [cnpjList, setCnpjList] = useState<string[]>([]);
  const [currentCnpj, setCurrentCnpj] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [year, setYear] = useState<string>(new Date().getFullYear().toString());
  const [taskId, setTaskId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [vencimento, setVencimento] = useState<string>("");
  const [diasRestantes, setDiasRestantes] = useState<number>(0);
  const [task, setTask] = useState<Task | null>(null);
  const [reconnecting, setReconnecting] = useState<boolean>(false);
  const [pollGeneration, setPollGeneration] = useState<number>(0);
  const [restoredSession, setRestoredSession] = useState<StoredSession | null>(null);

  const months = [
    { value: "01", label: "Janeiro" },
    { value: "02", label: "Fevereiro" },
    { value: "03", label: "Março" },
    { value: "04", label: "Abril" },
    { value: "05", label: "Maio" },
    { value: "06", label: "Junho" },
    { value: "07", label: "Julho" },
    { value: "08", label: "Agosto" },
    { value: "09", label: "Setembro" },
    { value: "10", label: "Outubro" },
    { value: "11", label: "Novembro" },
    { value: "12", label: "Dezembro" },
  ];

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  useEffect(() => {
    if (month && year) {
      const mesAtual = parseInt(month);
      const anoAtual = parseInt(year);
      
      let mesVencimento = mesAtual + 1;
      let anoVencimento = anoAtual;

      if (mesVencimento > 12) {
        mesVencimento = 1;
        anoVencimento++;
      }

      const mesVencimentoFormatado = months.find(m => m.value === mesVencimento.toString().padStart(2, '0'))?.label;
      
      // Calcula dias restantes até o vencimento
      const dataVencimento = new Date(anoVencimento, mesVencimento - 1, 20);
      const hoje = new Date();
      const diffTime = dataVencimento.getTime() - hoje.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      setDiasRestantes(diffDays);
      setVencimento(`Este DAS vence no dia 20 de ${mesVencimentoFormatado} de ${anoVencimento}`);
    } else {
      setVencimento("");
      setDiasRestantes(0);
    }
  }, [month, year]);

  useEffect(() => {
    const session = readSession();
    if (!session?.taskId) return;

    setRestoredSession(session);
    setTaskId(session.taskId);
    if (session.month) setMonth(session.month);
    if (session.year) setYear(session.year);
    if (session.cnpjList?.length) setCnpjList(session.cnpjList);
    if (session.task) setTask(session.task);
  }, []);

  useEffect(() => {
    if (!taskId) return;

    let cancelled = false;
    let stopped = false;
    let timer = 0;
    let inFlight = false;
    let delay = 2000;

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void tick();
      }, ms);
    };

    const tick = async () => {
      if (cancelled || stopped || inFlight) return;
      const session = readSession();
      if (!session || session.taskId !== taskId) return;
      inFlight = true;

      try {
        const response = await fetch(`/api/task/${encodeURIComponent(taskId)}`, {
          cache: "no-store",
        });

        if (cancelled) return;

        if (response.status === 404) {
          clearSession();
          setReconnecting(false);
          setTaskId("");
          setError("Esse processamento não está mais no servidor. Os CNPJs continuam na lista para você gerar de novo.");
          return;
        }

        if (!response.ok) {
          throw new Error("Falha ao consultar status");
        }

        const data = (await response.json()) as Task;
        if (cancelled) return;

        delay = 2000;
        setReconnecting(false);
        setError("");
        setTask(data);
        updateSession({ task: data });

        if (data.status === "completed" || data.status === "error") {
          stopped = true;
          const session = readSession();
          if (data.status === "completed" && data.totalSuccess > 0 && session?.downloadPending && !downloadsStarted.has(taskId)) {
            downloadsStarted.add(taskId);
            try {
              await downloadTaskZip(taskId, session.month, session.year);
              updateSession({ downloadPending: false });
              setError("");
            } catch (err: unknown) {
              downloadsStarted.delete(taskId);
              setError(err instanceof Error ? err.message : "Erro ao baixar arquivo");
            }
          }
          return;
        }

        schedule(delay);
      } catch {
        if (cancelled) return;
        setReconnecting(true);
        delay = Math.min(Math.max(delay * 2, 2000), 15000);
        schedule(delay);
      } finally {
        inFlight = false;
      }
    };

    const wake = () => {
      if (cancelled || stopped || document.hidden) return;
      delay = 2000;
      window.clearTimeout(timer);
      void tick();
    };

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);

    void tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [taskId, pollGeneration]);

  const handleAddCnpj = () => {
    if (!currentCnpj.trim()) return;
    
    // Suporta múltiplos CNPJs separados por vírgula, espaço ou quebra de linha
    const cnpjsToAdd = currentCnpj
      .split(/[\n,;\s]+/)
      .map(cnpj => cnpj.replace(/\D/g, ''))
      .filter(cnpj => cnpj.length === 14);

    if (cnpjsToAdd.length === 0) {
      setError("Nenhum CNPJ válido encontrado. Deve conter 14 dígitos.");
      return;
    }

    // Filtra duplicatas
    const newCnpjs = cnpjsToAdd.filter(cnpj => !cnpjList.includes(cnpj));
    
    if (newCnpjs.length === 0) {
      setError("Todos os CNPJs já foram adicionados.");
      return;
    }

    setCnpjList([...cnpjList, ...newCnpjs]);
    setCurrentCnpj("");
    setError("");
  };

  const handleRemoveCnpj = (cnpjToRemove: string) => {
    setCnpjList(cnpjList.filter(cnpj => cnpj !== cnpjToRemove));
  };

//  const handleKeyPress = (e: React.KeyboardEvent) => {
  //  if (e.key === 'Enter') {
//      e.preventDefault();
  //    handleAddCnpj();
   // }
//  };

  const discardCurrentTask = (options?: { confirmIfRunning?: boolean; keepForm?: boolean }) => {
    const confirmIfRunning = options?.confirmIfRunning ?? true;
    const isRunning =
      task?.status === "processing" ||
      task?.status === "pending" ||
      Boolean(taskId && !task);

    if (
      confirmIfRunning &&
      isRunning &&
      !window.confirm(
        "O processamento continua no servidor, mas você deixa de acompanhar nesta tela. Descartar mesmo assim?"
      )
    ) {
      return false;
    }

    const previousTaskId = taskId || readSession()?.taskId;
    if (previousTaskId) {
      downloadsStarted.delete(previousTaskId);
    }

    clearSession();
    setPollGeneration((current) => current + 1);
    setTaskId("");
    setTask(null);
    setReconnecting(false);
    setRestoredSession(null);
    setSuccess("");
    setError("");

    if (!options?.keepForm) {
      setCnpjList([]);
      setMonth("");
      setCurrentCnpj("");
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cnpjList.length === 0) {
      setError("Adicione pelo menos um CNPJ");
      return;
    }

    if (taskId) {
      discardCurrentTask({ confirmIfRunning: false, keepForm: true });
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const referenceMonth = `${month}/${year}`;
      const data = await processCnpjs(cnpjList, referenceMonth);
      writeSession({
        taskId: data.taskId,
        month,
        year,
        cnpjList,
        task: null,
        downloadPending: true,
      });
      downloadsStarted.delete(data.taskId);
      setRestoredSession(null);
      setTask(null);
      setReconnecting(false);
      setTaskId(data.taskId);
      setSuccess(`Processamento iniciado! Total de CNPJs: ${data.totalCnpjs}`);
    } catch (err: unknown) {
  if (err instanceof Error) {
    setError(err.message);
  } else {
    setError(String(err)); // caso seja outro tipo de erro
  }
} finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    const session = readSession();
    const id = taskId || session?.taskId;
    if (!id) return;

    try {
      await downloadTaskZip(id, session?.month || month, session?.year || year);
      updateSession({ downloadPending: false });
      downloadsStarted.add(id);
      setError("");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  };

  const handleDismiss = () => {
    discardCurrentTask({ keepForm: true });
  };

  const handleDismissAll = () => {
    discardCurrentTask({ keepForm: false });
  };

  const taskStatusLabel =
    task?.status === "completed"
      ? "Concluída"
      : task?.status === "error"
        ? "Finalizada com erros"
        : task?.status === "processing"
          ? "Em andamento"
          : taskId
            ? "Aguardando status"
            : "";

  const handleCopyErrorCnpjs = () => {
    if (!task) return;
    
    const errorCnpjs = task.progress
      .filter(item => item.status === 'error')
      .map(item => item.cnpj)
      .join('\n');
    
    navigator.clipboard.writeText(errorCnpjs);
    
    // Criar e baixar arquivo com CNPJs com erro
    const blob = new Blob([errorCnpjs], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cnpjs_com_erro_${month}_${year}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white p-8">
      <main className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">
            Gerador de DAS
          </h1>
          <p className="text-gray-400">Gere seus DAS de forma rápida e simples</p>
        </div>
        
        {restoredSession && taskId && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 bg-blue-900/20 border border-blue-500/40 rounded-xl">
            <div>
              <p className="text-blue-100 font-medium">Processamento salvo neste navegador</p>
              <p className="text-sm text-blue-200/80">
                Referência {restoredSession.month}/{restoredSession.year} · {restoredSession.cnpjList.length} CNPJ(s)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRestoredSession(null)}
                className="px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm"
              >
                Ok, entendi
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
              >
                Descartar task
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 bg-gray-800/50 backdrop-blur-sm p-8 rounded-xl shadow-2xl border border-gray-700">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">
              Adicionar CNPJs
            </label>
            <div className="flex gap-2">
              <textarea
                value={currentCnpj}
                onChange={(e) => setCurrentCnpj(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    handleAddCnpj();
                  }
                }}
                className="flex-1 px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all min-h-[100px]"
                placeholder="Digite os CNPJs (separados por vírgula, espaço ou quebra de linha)"
              />
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleAddCnpj}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-all whitespace-nowrap"
                >
                  Adicionar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentCnpj("");
                    setError("");
                  }}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-all whitespace-nowrap"
                >
                  Limpar
                </button>
              </div>
            </div>
            <p className="mt-2 text-sm text-gray-400">
              Dica: Você pode colar vários CNPJs de uma vez. Use Ctrl+Enter para adicionar rapidamente.
            </p>
          </div>

          {cnpjList.length > 0 && (
            <div className="bg-gray-900/50 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-medium text-gray-300">CNPJs Adicionados ({cnpjList.length})</h3>
                <button
                  type="button"
                  onClick={() => setCnpjList([])}
                  className="text-sm text-red-400 hover:text-red-300"
                >
                  Limpar Todos
                </button>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-gray-400 border-b border-gray-700">
                      <th className="pb-2">CNPJ</th>
                      <th className="pb-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cnpjList.map((cnpj, index) => (
                      <tr key={index} className="border-b border-gray-800">
                        <td className="py-2">
                          {cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}
                        </td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => handleRemoveCnpj(cnpj)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">
                Mês de Referência
              </label>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                required
              >
                <option value="">Selecione o mês</option>
                {months.map((m) => (
                  <option 
                    key={m.value} 
                    value={m.value}
                    disabled={parseInt(m.value) > currentMonth - 1 && year === currentYear.toString()}
                  >
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">
                Ano
              </label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                required
              >
                <option value={(currentYear-2).toString()}>{currentYear-2}</option>
                <option value={(currentYear-1).toString()}>{currentYear-1}</option>
                <option value={currentYear.toString()}>{currentYear}</option>
              </select>
            </div>
          </div>

          {vencimento && (
            <div className="p-6 bg-gradient-to-r from-blue-900/30 to-blue-800/30 border border-blue-500/30 rounded-xl backdrop-blur-sm">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-blue-200 font-medium text-lg">{vencimento}</p>
                  {diasRestantes > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-blue-400 text-sm">
                        {diasRestantes === 1 
                          ? "Vence amanhã!" 
                          : diasRestantes < 7
                            ? `Atenção! Vence em ${diasRestantes} dias`
                            : `Faltam ${diasRestantes} dias para o vencimento`}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium py-3 px-4 rounded-lg transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-lg"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processando...
              </span>
            ) : "Iniciar Processamento"}
          </button>
        </form>

        {(task || taskId) && (
          <div className="mt-8 bg-gray-800/50 backdrop-blur-sm p-6 rounded-xl shadow-2xl border border-gray-700">
            <div className="flex flex-wrap justify-between items-start mb-6 gap-4">
              <div>
                <h2 className="text-xl font-semibold">Progresso do Processamento</h2>
                {taskStatusLabel && (
                  <p className="mt-1 text-sm text-gray-400">Status: {taskStatusLabel}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                >
                  Descartar task (manter CNPJs)
                </button>
                <button
                  type="button"
                  onClick={handleDismissAll}
                  className="px-4 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-200 rounded-lg text-sm border border-red-500/30"
                >
                  Descartar tudo
                </button>
              </div>
              <div className="flex gap-4 w-full sm:w-auto sm:ml-auto">
                <div className="text-center">
                  <p className="text-sm text-gray-400">Processados</p>
                  <p className="text-lg font-semibold">{task ? `${task.totalProcessed}/${task.cnpjs.length}` : "..."}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-400">Sucesso</p>
                  <p className="text-lg font-semibold text-green-400">{task?.totalSuccess ?? 0}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-400">Erros</p>
                  <p className="text-lg font-semibold text-red-400">{task?.totalError ?? 0}</p>
                </div>
              </div>
            </div>

            {reconnecting && (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 bg-amber-900/20 border border-amber-500/40 rounded-lg">
                <p className="text-amber-200 text-sm">
                  A conexão caiu. O acompanhamento continua e o status volta sozinho.
                </p>
                <button
                  type="button"
                  onClick={() => setPollGeneration((current) => current + 1)}
                  className="px-3 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-sm"
                >
                  Atualizar agora
                </button>
              </div>
            )}

            {task && task.totalError > 0 && (
              <div className="mb-6">
                <button
                  onClick={handleCopyErrorCnpjs}
                  className="flex items-center gap-2 bg-red-900/30 hover:bg-red-900/40 text-red-400 px-4 py-2 rounded-lg transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  Copiar CNPJs com erro
                </button>
              </div>
            )}

            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
              {!task && (
                <p className="text-sm text-gray-400">Buscando o andamento...</p>
              )}
              {task?.progress.map((item, index) => (
                <div 
                  key={index}
                  className={`p-3 rounded-lg border ${
                    item.status === 'completed' 
                      ? 'bg-green-900/20 border-green-500/30' 
                      : item.status === 'error'
                        ? 'bg-red-900/20 border-red-500/30'
                        : item.status === 'processing'
                          ? 'bg-blue-900/20 border-blue-500/30'
                          : 'bg-gray-900/20 border-gray-500/30'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">
                        {item.status === 'completed' 
                          ? 'Concluído' 
                          : item.status === 'error'
                            ? 'Erro'
                            : item.status === 'processing'
                              ? 'Processando...'
                              : 'Aguardando...'}
                      </p>
                      <p className="text-sm text-gray-400">{item.cnpj}</p>
                      {item.nome && <p className="text-sm text-gray-400">{item.nome}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.status === 'completed' && (
                        <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {item.status === 'error' && (
                        <div className="text-red-400 text-sm">
                          {item.error}
                        </div>
                      )}
                      {item.status === 'processing' && (
                        <svg className="animate-spin h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg backdrop-blur-sm">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {success && (
          <div className="mt-6 p-4 bg-green-900/20 border border-green-500/50 rounded-lg backdrop-blur-sm">
            <p className="text-green-300">{success}</p>
          </div>
        )}

        {task?.status === 'completed' && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleDownload}
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-medium py-3 px-6 rounded-lg transition-all transform hover:scale-[1.02] shadow-lg"
            >
              Baixar DAS
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
            >
              Descartar task
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
