(() => {
  const openButton = document.getElementById("systemUpdateTop");
  const modal = document.getElementById("systemUpdateModal");
  const closeButton = document.getElementById("closeSystemUpdateModal");
  const checkButton = document.getElementById("checkSystemUpdate");
  const updateButton = document.getElementById("applySystemUpdate");
  const restartButton = document.getElementById("restartSystem");
  const badge = document.getElementById("systemUpdateBadge");
  const summary = document.getElementById("systemUpdateSummary");
  const versions = document.getElementById("systemUpdateVersions");
  const files = document.getElementById("systemUpdateFiles");
  const localChanges = document.getElementById("systemUpdateLocalChanges");
  const output = document.getElementById("systemUpdateOutput");
  if (!openButton || !modal) return;

  let latest = null;
  const liveRunning = () => Boolean(latestStatus?.live?.running || latestStatus?.transmission?.running);

  function render(data) {
    latest = data || {};
    versions.textContent = `Instalada: ${data.local_short || "?"} · GitHub: ${data.remote_short || "?"}`;

    if (!data.ok) summary.textContent = data.error || "Falha ao consultar atualização.";
    else if (data.dirty) summary.textContent = "Há alterações locais; atualização automática bloqueada.";
    else if (Number(data.ahead || 0) > 0) summary.textContent = "Existem commits locais ainda não enviados ao GitHub.";
    else if (data.update_available) summary.textContent = `${data.behind} atualização(ões) disponível(is).`;
    else summary.textContent = "Sistema atualizado.";

    const changed = Array.isArray(data.changed_files) ? data.changed_files : [];
    files.textContent = changed.length ? changed.join("\n") : "Nenhum arquivo remoto pendente listado.";
    const dirty = Array.isArray(data.dirty_files) ? data.dirty_files : [];
    localChanges.textContent = dirty.length ? dirty.join("\n") : "Nenhuma alteração local detectada.";

    const running = liveRunning();
    updateButton.disabled = !data.can_update || running;
    restartButton.disabled = running || data.restart_available === false;
    badge.hidden = !data.update_available;
    openButton.classList.toggle("update-available", Boolean(data.update_available));

    if (running) output.textContent = "A live está ativa. Atualização e reinicialização ficam bloqueadas até ela ser encerrada.";
  }

  async function checkUpdate(fetchRemote = true) {
    checkButton.disabled = true;
    output.textContent = "Consultando GitHub...";
    try {
      const response = await fetch(`/api/system-update/status?fetch_remote=${fetchRemote ? "1" : "0"}`, { cache: "no-store" });
      const data = await response.json();
      render(data);
      output.textContent = data.ok
        ? (data.update_available ? "Nova versão encontrada. Revise os arquivos antes de atualizar." : "Nenhuma atualização pendente.")
        : (data.error || `HTTP ${response.status}`);
    } catch (err) {
      output.textContent = `Erro ao consultar GitHub: ${err.message}`;
    } finally {
      checkButton.disabled = false;
    }
  }

  async function applyUpdate() {
    if (liveRunning()) return;
    if (!window.confirm("Baixar a nova versão do GitHub agora?")) return;
    updateButton.disabled = true;
    output.textContent = "Baixando atualização com git pull --ff-only...";
    try {
      const response = await fetch("/api/system-update/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      render(data);
      output.textContent = data.message || data.error || "Operação concluída.";
      if (data.restart_required) restartButton.disabled = false;
    } catch (err) {
      output.textContent = `Erro ao atualizar: ${err.message}`;
    }
  }

  async function restartSystem() {
    if (liveRunning()) return;
    if (!window.confirm("Reiniciar o Boneco Game agora?")) return;
    restartButton.disabled = true;
    output.textContent = "Agendando reinicialização...";
    try {
      const response = await fetch("/api/system-update/restart", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      output.textContent = data.message || "Reiniciando...";
      setTimeout(waitForServer, 1800);
    } catch (err) {
      output.textContent = `Erro ao reiniciar: ${err.message}`;
      restartButton.disabled = false;
    }
  }

  async function waitForServer() {
    const start = Date.now();
    while (Date.now() - start < 45000) {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (response.ok) {
          output.textContent = "Sistema reiniciado. Recarregando painel...";
          setTimeout(() => window.location.reload(), 500);
          return;
        }
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    output.textContent = "O servidor ainda não voltou. Recarregue a página manualmente.";
    restartButton.disabled = false;
  }

  openButton.addEventListener("click", async () => { modal.showModal(); await checkUpdate(true); });
  closeButton.addEventListener("click", () => modal.close());
  checkButton.addEventListener("click", () => checkUpdate(true));
  updateButton.addEventListener("click", applyUpdate);
  restartButton.addEventListener("click", restartSystem);
})();
