(() => {
  const button = document.getElementById("backgroundRemovalTop");
  const modal = document.getElementById("backgroundRemovalModal");
  const closeButton = document.getElementById("closeBackgroundRemovalModal");
  const startButton = document.getElementById("startBackgroundRemoval");
  const refreshButton = document.getElementById("refreshBackgroundRemoval");
  const progress = document.getElementById("backgroundRemovalProgress");
  const percent = document.getElementById("backgroundRemovalPercent");
  const summary = document.getElementById("backgroundRemovalSummary");
  const current = document.getElementById("backgroundRemovalCurrent");
  const log = document.getElementById("backgroundRemovalLog");

  if (!button || !modal) return;

  let pollTimer = 0;

  function setStatus(data) {
    const value = Math.max(0, Math.min(100, Number(data.progress || 0)));
    progress.value = value;
    percent.textContent = `${Math.round(value)}%`;

    const total = Number(data.total || 0);
    const completed = Number(data.completed || 0);
    const pending = Number(data.pending || 0);
    summary.textContent = data.running
      ? `${completed} de ${total} concluído(s) · ${pending} pendente(s)`
      : `${pending} vídeo(s) pendente(s)`;

    current.textContent = data.current_file
      ? `Processando agora: ${data.current_file}`
      : (data.message || "Pronto.");

    log.textContent = Array.isArray(data.log_tail) && data.log_tail.length
      ? data.log_tail.join("\n")
      : "Sem mensagens de processamento.";

    startButton.disabled = Boolean(data.running);
    startButton.textContent = data.running ? "Processando..." : "Processar pendentes";
    button.classList.toggle("processing", Boolean(data.running));

    clearTimeout(pollTimer);
    if (data.running) {
      pollTimer = setTimeout(loadStatus, 900);
    }
  }

  async function loadStatus() {
    try {
      const response = await fetch("/api/background-removal/status", { cache: "no-store" });
      const data = await response.json();
      setStatus(data);
    } catch (err) {
      current.textContent = `Erro ao consultar processamento: ${err.message}`;
    }
  }

  async function startProcessing() {
    startButton.disabled = true;
    current.textContent = "Iniciando processamento...";
    try {
      const response = await fetch("/api/background-removal/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: "BONECO_MAPA_2D" }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || data.message || `HTTP ${response.status}`);
      }
      setStatus(data);
      await loadStatus();
    } catch (err) {
      current.textContent = `Erro: ${err.message}`;
      startButton.disabled = false;
    }
  }

  button.addEventListener("click", async () => {
    modal.showModal();
    await loadStatus();
  });
  closeButton.addEventListener("click", () => {
    clearTimeout(pollTimer);
    modal.close();
  });
  refreshButton.addEventListener("click", loadStatus);
  startButton.addEventListener("click", startProcessing);
})();
