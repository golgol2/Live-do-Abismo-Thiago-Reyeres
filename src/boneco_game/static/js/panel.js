async function post(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.live?.message || data?.message || data?.error || `HTTP ${response.status}`);
  }
  return data;
}

let latestStatus = {};
let latestLayoutConfig = null;
let latestLiveConfig = null;

async function refreshStatus() {
  const response = await fetch("/api/status/compact", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }

  latestStatus = payload;
  document.getElementById("currentMode").textContent = payload.state?.mode || "preview";
  applyVisualControls(payload.state || {});
  applyCameraControls(payload.state || {});
  applyLipSyncControls(payload.runtime || {});
  applyMusicVolumeControls(payload.runtime || {});
  updateLiveToggle(payload);
  updateLayoutSummary(payload.layout || null);
  updateScheduleSummary(payload.schedule || null);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}min`;
  if (minutes > 0) return `${minutes}min ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

function updateScheduleSummary(schedule) {
  const element = document.getElementById("scheduleSummary");
  if (!element) return;
  if (!schedule || !schedule.enabled) {
    element.textContent = "Desativada.";
    return;
  }
  const action = String(schedule.scheduled_action || "");
  const remaining = formatDuration(schedule.remaining_seconds || 0);
  if (action === "start") {
    element.textContent = `Ativada: inicia automaticamente em ${remaining}.`;
  } else if (action === "stop") {
    element.textContent = `Ativada: finaliza automaticamente em ${remaining}.`;
  } else {
    element.textContent = "Ativada: aguardando próximo ciclo.";
  }
}

function setDiagnosticCopyStatus(message, error = false) {
  const element = document.getElementById("diagnosticCopyStatus");
  if (!element) return;

  element.textContent = message;
  element.style.color = error ? "#ff8f8f" : "";
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("O navegador não permitiu copiar para o clipboard.");
  }
}

async function fetchDiagnosticJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }

  return payload;
}

async function copyDiagnosticStatus() {
  const button = document.getElementById("copyDiagnosticStatus");
  if (button) button.disabled = true;

  setDiagnosticCopyStatus("Buscando diagnóstico atual...");

  try {
    const payload = await fetchDiagnosticJson("/api/diagnostics/status");

    const text = [
      "=== BONECO GAME - DIAGNÓSTICO ===",
      `gerado_em=${new Date().toISOString()}`,
      "",
      JSON.stringify(payload, null, 2)
    ].join("\n");

    await copyTextToClipboard(text);

    setDiagnosticCopyStatus("Diagnóstico copiado.");
  } catch (err) {
    setDiagnosticCopyStatus(`Erro ao copiar diagnóstico: ${err.message}`, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function copyErrorLogs() {
  const button = document.getElementById("copyErrorLogs");
  if (button) button.disabled = true;

  setDiagnosticCopyStatus("Buscando logs recentes...");

  try {
    const payload = await fetchDiagnosticJson("/api/diagnostics/logs");

    const text = [
      "=== BONECO GAME - LOGS DE ERRO ===",
      `gerado_em=${new Date().toISOString()}`,
      "",
      JSON.stringify(payload, null, 2)
    ].join("\n");

    await copyTextToClipboard(text);

    setDiagnosticCopyStatus("Logs de erro copiados.");
  } catch (err) {
    setDiagnosticCopyStatus(`Erro ao copiar logs: ${err.message}`, true);
  } finally {
    if (button) button.disabled = false;
  }
}


function layoutCatalog(payload = latestLayoutConfig) {
  return Array.isArray(payload?.catalog)
    ? payload.catalog
    : [];
}

function layoutName(layoutId, payload = latestLayoutConfig) {
  const cleanId = String(layoutId || "");

  const item = layoutCatalog(payload).find(
    entry => String(entry?.id || "") === cleanId
  );

  return String(
    item?.name
    || cleanId
    || "nenhum"
  );
}

function updateLayoutSummary(payload) {
  const summary =
    document.getElementById("layoutSummary");

  if (!summary || !payload) return;

  latestLayoutConfig = {
    ...(latestLayoutConfig || {}),
    ...payload,
    catalog:
      Array.isArray(payload.catalog)
        ? payload.catalog
        : layoutCatalog()
  };

  const activeId =
    String(payload.active_layout || "");

  const activeName =
    layoutName(activeId, latestLayoutConfig);

  const mode =
    String(payload.layout_mode || "random");

  const manualId =
    String(payload.manual_layout || "");

  if (mode === "manual") {
    summary.textContent =
      `Forçado: ${layoutName(manualId, latestLayoutConfig)} | `
      + `ativo nesta sessão: ${activeName}`;

    return;
  }

  const remaining =
    Array.isArray(payload.rotation_remaining)
      ? payload.rotation_remaining
      : [];

  summary.textContent =
    `Aleatório sem repetição | ativo: ${activeName} | `
    + `restantes no ciclo: ${remaining.length}`;
}

function updatePreviewLayoutLink() {
  const select =
    document.getElementById("layoutManualSelect");

  const link =
    document.getElementById("previewLayoutLink");

  if (!select || !link) return;

  const selected =
    String(select.value || "classic");

  link.href =
    `/renderer?preview=1&layout=${encodeURIComponent(selected)}`;
}

function renderLayoutSettings(payload) {
  if (!payload || typeof payload !== "object") return;

  latestLayoutConfig = payload;

  const force =
    document.getElementById("layoutForceManual");

  const select =
    document.getElementById("layoutManualSelect");

  const enabledList =
    document.getElementById("layoutEnabledList");

  const catalog =
    layoutCatalog(payload);

  const enabled = new Set(
    Array.isArray(payload.enabled_layouts)
      ? payload.enabled_layouts.map(String)
      : []
  );

  if (force) {
    force.checked =
      String(payload.layout_mode || "random")
      === "manual";
  }

  if (select) {
    select.replaceChildren();

    for (const item of catalog) {
      const option =
        document.createElement("option");

      option.value =
        String(item.id || "");

      option.textContent =
        String(item.name || item.id || "");

      select.appendChild(option);
    }

    const preferred =
      String(payload.manual_layout || "")
      || String(payload.active_layout || "")
      || String(catalog[0]?.id || "classic");

    select.value = preferred;

    if (
      !select.value
      && select.options.length
    ) {
      select.selectedIndex = 0;
    }
  }

  if (enabledList) {
    enabledList.replaceChildren();

    for (const item of catalog) {
      const label =
        document.createElement("label");

      label.className = "checkline";

      const checkbox =
        document.createElement("input");

      checkbox.type = "checkbox";
      checkbox.className =
        "layout-enabled-option";

      checkbox.value =
        String(item.id || "");

      checkbox.checked =
        enabled.has(checkbox.value);

      label.appendChild(checkbox);

      label.appendChild(
        document.createTextNode(
          ` ${String(item.name || item.id || "")}`
        )
      );

      enabledList.appendChild(label);
    }
  }

  updateLayoutSummary(payload);
  updatePreviewLayoutLink();
}

async function loadLayoutSettings() {
  const response = await fetch(
    "/api/layouts",
    {
      cache: "no-store"
    }
  );

  const payload =
    await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload?.error
      || `HTTP ${response.status}`
    );
  }

  renderLayoutSettings(payload);

  return payload;
}

async function saveLayoutSettings() {
  const force =
    document.getElementById("layoutForceManual");

  const select =
    document.getElementById("layoutManualSelect");

  const status =
    document.getElementById("layoutSettingsStatus");

  const enabled = Array.from(
    document.querySelectorAll(
      ".layout-enabled-option:checked"
    )
  ).map(
    input => String(input.value || "")
  );

  if (!enabled.length) {
    throw new Error(
      "Habilite pelo menos um layout."
    );
  }

  const layoutMode =
    force?.checked
      ? "manual"
      : "random";

  const manualLayout =
    String(select?.value || "");

  if (
    layoutMode === "manual"
    && !enabled.includes(manualLayout)
  ) {
    throw new Error(
      "O layout forçado precisa estar habilitado."
    );
  }

  if (status) {
    status.textContent =
      "Salvando configuração de layouts...";
  }

  const result = await post(
    "/api/layouts/config",
    {
      layout_mode: layoutMode,
      manual_layout: manualLayout,
      enabled_layouts: enabled
    }
  );

  const payload =
    result.layout || result;

  renderLayoutSettings(payload);

  if (status) {
    status.textContent =
      layoutMode === "manual"
        ? "Layout forçado salvo. A fila aleatória foi preservada."
        : "Rotação aleatória sem repetição ativada.";
  }

  return payload;
}


const cameraRangeMap = [
  ["cameraFarZoomMinRange", "cameraFarZoomMin", "cameraFarZoomMinOutput", 2, ""],
  ["cameraMediumZoomMaxRange", "cameraMediumZoomMax", "cameraMediumZoomMaxOutput", 2, ""],
  ["cameraCloseZoomMaxRange", "cameraCloseZoomMax", "cameraCloseZoomMaxOutput", 2, ""],
  ["cameraXMaxRange", "cameraXMax", "cameraXMaxOutput", 0, " px"],
  ["cameraCloseYMaxRange", "cameraCloseYMax", "cameraCloseYMaxOutput", 0, " px"],
  ["cameraTransitionMinRange", "cameraTransitionMin", "cameraTransitionMinOutput", 1, " s"],
  ["cameraTransitionMaxRange", "cameraTransitionMax", "cameraTransitionMaxOutput", 1, " s"],
  ["cameraResponsesMinRange", "cameraResponsesMin", "cameraResponsesMinOutput", 0, ""],
  ["cameraResponsesMaxRange", "cameraResponsesMax", "cameraResponsesMaxOutput", 0, ""],
];

function syncCameraRange(rangeId, valueId, outputId, digits, suffix) {
  const range = document.getElementById(rangeId);
  const value = document.getElementById(valueId);
  const output = document.getElementById(outputId);
  if (!range || !value || !output) return;
  const parsed = Number(value.value);
  const safe = Number.isFinite(parsed) ? parsed : Number(range.min || 0);
  range.value = String(safe);
  output.textContent = `${digits ? safe.toFixed(digits) : Math.round(safe)}${suffix}`;
}

function syncAllCameraRanges() {
  for (const args of cameraRangeMap) syncCameraRange(...args);
}

function initCameraModalControls() {
  for (const [rangeId, valueId, outputId, digits, suffix] of cameraRangeMap) {
    const range = document.getElementById(rangeId);
    const value = document.getElementById(valueId);
    if (!range || !value) continue;
    range.addEventListener("input", () => {
      value.value = range.value;
      syncCameraRange(rangeId, valueId, outputId, digits, suffix);
    });
    value.addEventListener("input", () => {
      range.value = value.value;
      syncCameraRange(rangeId, valueId, outputId, digits, suffix);
    });
  }
  syncAllCameraRanges();
}

function openCameraModal() {
  const modal = document.getElementById("cameraModal");
  if (!modal) return;
  applyCameraControls(latestStatus?.state || {});
  syncAllCameraRanges();
  modal.showModal();
}

function closeCameraModal() {
  const modal = document.getElementById("cameraModal");
  if (modal?.open) modal.close();
}

function applyCameraControls(state) {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = value;
  };
  const enabled = document.getElementById("dynamicCameraEnabled");
  if (enabled && document.activeElement !== enabled) enabled.checked = state.dynamic_camera_enabled !== false;
  setValue("cameraFarZoomMin", Number(state.camera_far_zoom_min ?? 0.82).toFixed(2));
  setValue("cameraMediumZoomMax", Number(state.camera_medium_zoom_max ?? 1.22).toFixed(2));
  setValue("cameraCloseZoomMax", Number(state.camera_close_zoom_max ?? 1.40).toFixed(2));
  setValue("cameraXMax", Math.round(Number(state.camera_x_max ?? 22)));
  setValue("cameraCloseYMax", Math.round(Number(state.camera_close_y_max ?? 175)));
  setValue("cameraTransitionMin", Number(state.camera_transition_min ?? 3).toFixed(1));
  setValue("cameraTransitionMax", Number(state.camera_transition_max ?? 7).toFixed(1));
  setValue("cameraResponsesMin", Math.round(Number(state.camera_responses_min ?? 2)));
  setValue("cameraResponsesMax", Math.round(Number(state.camera_responses_max ?? 5)));
  const status = document.getElementById("cameraSettingsStatus");
  if (status) {
    const mode = String(state.camera_manual_shot || "auto");
    status.textContent = mode === "auto" ? "Automático ativo." : `Override manual: ${mode}.`;
  }
}

function readCameraControls() {
  const far = clampNumber(document.getElementById("cameraFarZoomMin")?.value, 0.68, 0.98, 0.82);
  const medium = clampNumber(document.getElementById("cameraMediumZoomMax")?.value, 1.08, 1.30, 1.22);
  const close = Math.max(medium + 0.03, clampNumber(document.getElementById("cameraCloseZoomMax")?.value, 1.18, 1.48, 1.40));
  const tmin = clampNumber(document.getElementById("cameraTransitionMin")?.value, 1.5, 12, 3);
  const tmax = Math.max(tmin, clampNumber(document.getElementById("cameraTransitionMax")?.value, tmin, 15, 7));
  const rmin = Math.round(clampNumber(document.getElementById("cameraResponsesMin")?.value, 1, 8, 2));
  const rmax = Math.max(rmin, Math.round(clampNumber(document.getElementById("cameraResponsesMax")?.value, rmin, 12, 5)));
  return {
    dynamic_camera_enabled: Boolean(document.getElementById("dynamicCameraEnabled")?.checked),
    camera_far_zoom_min: Number(far.toFixed(2)),
    camera_medium_zoom_max: Number(medium.toFixed(2)),
    camera_close_zoom_max: Number(close.toFixed(2)),
    camera_x_max: Math.round(clampNumber(document.getElementById("cameraXMax")?.value, 0, 60, 22)),
    camera_close_y_max: Math.round(clampNumber(document.getElementById("cameraCloseYMax")?.value, 40, 260, 175)),
    camera_transition_min: Number(tmin.toFixed(1)),
    camera_transition_max: Number(tmax.toFixed(1)),
    camera_responses_min: rmin,
    camera_responses_max: rmax,
  };
}

async function saveCameraControls(extra = {}) {
  await post("/api/state", { ...readCameraControls(), ...extra });
  await refreshStatus();
}

async function setCameraShot(mode) {
  try { await saveCameraControls({ camera_manual_shot: mode }); }
  catch (err) { alert(`Erro ao controlar câmera: ${err.message}`); }
}

const lipSyncControls = [
  { key: "micro_pause_rate", rangeId: "lipPauseRateRange", valueId: "lipPauseRate", outputId: "lipPauseRateOutput", min: 0.10, max: 1.00, fallback: 0.58, digits: 2, suffix: "×" },
  { key: "micro_pause_freeze_max", rangeId: "lipFreezeMaxRange", valueId: "lipFreezeMax", outputId: "lipFreezeMaxOutput", min: 0.35, max: 1.50, fallback: 0.35, digits: 2, suffix: " s" },
  { key: "pause_to_mute_min", rangeId: "lipMuteMinRange", valueId: "lipMuteMin", outputId: "lipMuteMinOutput", min: 0.50, max: 4.00, fallback: 2.00, digits: 2, suffix: " s" },
  { key: "mute_switch_advance", rangeId: "lipMuteAdvanceRange", valueId: "lipMuteAdvance", outputId: "lipMuteAdvanceOutput", min: 0.000, max: 0.200, fallback: 0.025, digits: 3, suffix: " s" },
];

let lipSyncSaveTimer = 0;
const musicVolumeControls = [
  { key: "music_idle_volume", rangeId: "musicIdleVolumeRange", valueId: "musicIdleVolume", fallback: 0.16 },
  { key: "music_speech_volume", rangeId: "musicSpeechVolumeRange", valueId: "musicSpeechVolume", fallback: 0.055 },
];
let musicVolumeSaveTimer = 0;

function syncLipSyncControl(control, rawValue) {
  const parsed = clampNumber(rawValue, control.min, control.max, control.fallback);
  const formatted = parsed.toFixed(control.digits);
  const range = document.getElementById(control.rangeId);
  const value = document.getElementById(control.valueId);
  const output = document.getElementById(control.outputId);
  if (range) range.value = formatted;
  if (value) value.value = formatted;
  if (output) output.textContent = `${formatted}${control.suffix}`;
}

function applyLipSyncControls(runtime = {}) {
  for (const control of lipSyncControls) {
    const range = document.getElementById(control.rangeId);
    const value = document.getElementById(control.valueId);
    if (document.activeElement === range || document.activeElement === value) continue;
    syncLipSyncControl(control, runtime?.[control.key] ?? control.fallback);
  }
}

function readLipSyncControls() {
  const payload = {};
  for (const control of lipSyncControls) {
    const raw = document.getElementById(control.valueId)?.value ??
      document.getElementById(control.rangeId)?.value;
    const parsed = clampNumber(raw, control.min, control.max, control.fallback);
    payload[control.key] = Number(parsed.toFixed(control.digits));
  }
  return payload;
}

async function saveLipSyncControls({ quiet = false } = {}) {
  const payload = readLipSyncControls();
  const status = document.getElementById("lipSyncSettingsStatus");
  if (status && !quiet) status.textContent = "Aplicando na live...";
  const result = await post("/api/live/runtime", payload);
  latestStatus.runtime = result.runtime || payload;
  applyLipSyncControls(latestStatus.runtime);
  if (status) {
    status.textContent =
      `Aplicado: boca ${payload.micro_pause_rate.toFixed(2)}× · ` +
      `pausas até ${payload.micro_pause_freeze_max.toFixed(2)} s · ` +
      `mudo em ${payload.pause_to_mute_min.toFixed(2)} s`;
  }
}

function queueLipSyncSave() {
  const status = document.getElementById("lipSyncSettingsStatus");
  if (status) status.textContent = "Ajuste detectado; aplicando em tempo real...";
  clearTimeout(lipSyncSaveTimer);
  lipSyncSaveTimer = window.setTimeout(() => {
    saveLipSyncControls({ quiet: true }).catch((err) => {
      if (status) status.textContent = `Erro: ${err.message}`;
    });
  }, 180);
}

function initLipSyncModalControls() {
  for (const control of lipSyncControls) {
    const range = document.getElementById(control.rangeId);
    const value = document.getElementById(control.valueId);
    if (!range || !value) continue;
    range.addEventListener("input", () => {
      syncLipSyncControl(control, range.value);
      queueLipSyncSave();
    });
    value.addEventListener("input", () => {
      syncLipSyncControl(control, value.value);
    });
    value.addEventListener("change", () => {
      syncLipSyncControl(control, value.value);
      queueLipSyncSave();
    });
  }
  applyLipSyncControls(latestStatus?.runtime || {});
}

function syncMusicVolumeControl(control, rawValue) {
  const parsed = clampNumber(rawValue, 0, 1, control.fallback);
  const formatted = parsed.toFixed(3);
  const range = document.getElementById(control.rangeId);
  const value = document.getElementById(control.valueId);
  if (range) range.value = formatted;
  if (value) value.value = formatted;
}

function applyMusicVolumeControls(runtime = {}) {
  for (const control of musicVolumeControls) {
    const range = document.getElementById(control.rangeId);
    const value = document.getElementById(control.valueId);
    if (document.activeElement === range || document.activeElement === value) continue;
    syncMusicVolumeControl(control, runtime?.[control.key] ?? control.fallback);
  }
}

function readMusicVolumeControls() {
  const payload = {};
  for (const control of musicVolumeControls) {
    const raw = document.getElementById(control.valueId)?.value ??
      document.getElementById(control.rangeId)?.value;
    const parsed = clampNumber(raw, 0, 1, control.fallback);
    payload[control.key] = Number(parsed.toFixed(3));
  }
  return payload;
}

async function saveMusicVolumeControls({ quiet = false } = {}) {
  const payload = readMusicVolumeControls();
  const status = document.getElementById("musicVolumeStatus");
  if (status && !quiet) status.textContent = "Aplicando na live...";
  const result = await post("/api/live/runtime", payload);
  latestStatus.runtime = result.runtime || {
    ...(latestStatus.runtime || {}),
    ...payload,
  };
  applyMusicVolumeControls(latestStatus.runtime);
  if (status) {
    status.textContent =
      `Fundo ${payload.music_idle_volume.toFixed(3)} · ` +
      `falando ${payload.music_speech_volume.toFixed(3)}`;
  }
}

function queueMusicVolumeSave() {
  const status = document.getElementById("musicVolumeStatus");
  if (status) status.textContent = "Ajuste detectado; aplicando...";
  clearTimeout(musicVolumeSaveTimer);
  musicVolumeSaveTimer = window.setTimeout(() => {
    saveMusicVolumeControls({ quiet: true }).catch((err) => {
      if (status) status.textContent = `Erro: ${err.message}`;
    });
  }, 180);
}

function initMusicVolumeControls() {
  for (const control of musicVolumeControls) {
    const range = document.getElementById(control.rangeId);
    const value = document.getElementById(control.valueId);
    if (!range || !value) continue;
    range.addEventListener("input", () => {
      syncMusicVolumeControl(control, range.value);
      queueMusicVolumeSave();
    });
    value.addEventListener("input", () => {
      syncMusicVolumeControl(control, value.value);
      queueMusicVolumeSave();
    });
    syncMusicVolumeControl(control, control.fallback);
  }
}

async function loadManualSpeechMusicOptions() {
  const select = document.getElementById("manualSpeechMusic");
  if (!select) return;
  const current = select.value;
  const response = await fetch("/api/speech/manual/music", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
  select.innerHTML = "";
  const normal = document.createElement("option");
  normal.value = "";
  normal.textContent = "Usar música normal da live";
  select.appendChild(normal);
  for (const track of tracks) {
    const option = document.createElement("option");
    option.value = String(track.path || "");
    option.textContent = String(track.name || track.file || track.path || "Música");
    select.appendChild(option);
  }
  if ([...select.options].some(option => option.value === current)) {
    select.value = current;
  }
}

function openLipSyncModal() {
  const modal = document.getElementById("lipSyncModal");
  if (!modal) return;
  applyLipSyncControls(latestStatus?.runtime || {});
  modal.showModal();
}

function closeLipSyncModal() {
  const modal = document.getElementById("lipSyncModal");
  if (modal?.open) modal.close();
}

async function resetLipSyncDefaults() {
  const defaults = {
    micro_pause_rate: 0.58,
    micro_pause_freeze_max: 0.35,
    pause_to_mute_min: 2.00,
    mute_switch_advance: 0.025,
  };
  for (const control of lipSyncControls) {
    syncLipSyncControl(control, defaults[control.key]);
  }
  const result = await post("/api/live/runtime", defaults);
  latestStatus.runtime = result.runtime || defaults;
  applyLipSyncControls(latestStatus.runtime);
  const status = document.getElementById("lipSyncSettingsStatus");
  if (status) status.textContent = "Valores padrão restaurados e aplicados.";
}

async function testLipSyncSpeech() {
  const status = document.getElementById("lipSyncSettingsStatus");
  if (status) status.textContent = "Enviando frase de teste para o Boneco...";
  await saveLipSyncControls({ quiet: true });
  await post("/api/speech/manual", {
    actor: "main",
    text: "Eu vou falar uma frase curta. Depois eu faço uma pequena pausa. E continuo falando normalmente.",
  });
  if (status) status.textContent = "Frase de teste enviada. Observe a boca nas separações.";
}

function updateLiveToggle(payload) {
  const running = Boolean(payload.live?.running || payload.transmission?.running);
  const button = document.getElementById("liveToggleTop");
  button.textContent = running ? "Parar live" : "Iniciar live";
  button.classList.toggle("running", running);
  button.dataset.running = running ? "1" : "0";
}

function minutesToSeconds(value, fallbackMinutes) {
  const parsed = Number(value);
  return Math.max(60, Math.round((Number.isFinite(parsed) ? parsed : fallbackMinutes) * 60));
}

function secondsToMinutes(value, fallbackSeconds) {
  const parsed = Number(value);
  return Math.round((Number.isFinite(parsed) ? parsed : fallbackSeconds) / 60);
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const bellyProfileControls = {
  scale: {
    rangeId: "bellyProfileScaleRange",
    valueId: "bellyProfileScaleValue",
    stateKey: "belly_profile_scale",
    min: 0.45,
    max: 2.00,
    fallback: 0.82,
    digits: 2,
  },
  offsetX: {
    rangeId: "bellyProfileOffsetXRange",
    valueId: "bellyProfileOffsetXValue",
    stateKey: "belly_profile_offset_x",
    min: -120,
    max: 120,
    fallback: 0,
    digits: 0,
  },
  offsetY: {
    rangeId: "bellyProfileOffsetYRange",
    valueId: "bellyProfileOffsetYValue",
    stateKey: "belly_profile_offset_y",
    min: -120,
    max: 120,
    fallback: 0,
    digits: 0,
  },
};

function formatControlValue(value, digits) {
  return Number(value).toFixed(digits);
}

function applyVisualControls(state) {
  for (const control of Object.values(bellyProfileControls)) {
    const parsed = clampNumber(state[control.stateKey], control.min, control.max, control.fallback);
    const formatted = formatControlValue(parsed, control.digits);
    const range = document.getElementById(control.rangeId);
    const value = document.getElementById(control.valueId);
    if (range && document.activeElement !== range) range.value = formatted;
    if (value && document.activeElement !== value) value.value = formatted;
  }
}

let bellyProfileScaleTimer = 0;
let bellyProfileControlsDirty = false;
function readBellyProfileControls() {
  const payload = {};
  for (const control of Object.values(bellyProfileControls)) {
    const valueElement = document.getElementById(control.valueId);
    const rangeElement = document.getElementById(control.rangeId);
    const raw = valueElement?.value || rangeElement?.value;
    const parsed = clampNumber(raw, control.min, control.max, control.fallback);
    payload[control.stateKey] = control.digits > 0 ? Number(parsed.toFixed(control.digits)) : Math.round(parsed);
  }
  return payload;
}

function syncBellyProfileControl(controlKey, rawValue) {
  const control = bellyProfileControls[controlKey];
  if (!control) return;
  const parsed = clampNumber(rawValue, control.min, control.max, control.fallback);
  const formatted = formatControlValue(parsed, control.digits);
  document.getElementById(control.rangeId).value = formatted;
  document.getElementById(control.valueId).value = formatted;
}

async function saveBellyProfileControls() {
  const payload = readBellyProfileControls();
  const status = document.getElementById("bellyProfileScaleStatus");
  if (status) status.textContent = "Salvando e aplicando na live...";
  await post("/api/state", payload);
  bellyProfileControlsDirty = false;
  if (status) {
    status.textContent = `Aplicado: tamanho ${payload.belly_profile_scale.toFixed(2)}, X ${payload.belly_profile_offset_x}, Y ${payload.belly_profile_offset_y}`;
  }
  await refreshStatus();
}

function queueBellyProfileControlSave(controlKey, value) {
  syncBellyProfileControl(controlKey, value);
  bellyProfileControlsDirty = true;
  const status = document.getElementById("bellyProfileScaleStatus");
  if (status) status.textContent = "Ajuste detectado; aplicando em tempo real...";
  clearTimeout(bellyProfileScaleTimer);
  bellyProfileScaleTimer = setTimeout(async () => {
    try {
      await saveBellyProfileControls();
    } catch (err) {
      alert(`Erro ao salvar ajuste da foto: ${err.message}`);
    }
  }, 180);
}

function flushBellyProfileControlsBeforeUnload() {
  if (!bellyProfileControlsDirty) return;
  clearTimeout(bellyProfileScaleTimer);
  const payload = JSON.stringify(readBellyProfileControls());
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/state", new Blob([payload], { type: "application/json" }));
    return;
  }
  fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

initCameraModalControls();
initLipSyncModalControls();
initMusicVolumeControls();
document.getElementById("openCameraModal")?.addEventListener("click", openCameraModal);
document.getElementById("closeCameraModal")?.addEventListener("click", closeCameraModal);
document.getElementById("closeCameraModalBottom")?.addEventListener("click", closeCameraModal);
document.getElementById("saveCameraSettings")?.addEventListener("click", () => saveCameraControls().catch(err => alert(err.message)));
document.getElementById("dynamicCameraEnabled")?.addEventListener("change", () => saveCameraControls().catch(err => alert(err.message)));
document.getElementById("cameraDistantShot")?.addEventListener("click", () => setCameraShot("distant"));
document.getElementById("cameraFullShot")?.addEventListener("click", () => setCameraShot("full"));
document.getElementById("cameraMediumShot")?.addEventListener("click", () => setCameraShot("medium"));
document.getElementById("cameraCloseShot")?.addEventListener("click", () => setCameraShot("close"));
document.getElementById("cameraAutoShot")?.addEventListener("click", () => setCameraShot("auto"));

document.getElementById("openLipSyncModal")?.addEventListener("click", openLipSyncModal);
document.getElementById("closeLipSyncModal")?.addEventListener("click", closeLipSyncModal);
document.getElementById("closeLipSyncModalBottom")?.addEventListener("click", closeLipSyncModal);
document.getElementById("saveLipSyncSettings")?.addEventListener("click", () => {
  clearTimeout(lipSyncSaveTimer);
  saveLipSyncControls().catch((err) => alert(`Erro ao salvar sincronia: ${err.message}`));
});
document.getElementById("lipSyncDefaults")?.addEventListener("click", () => {
  clearTimeout(lipSyncSaveTimer);
  resetLipSyncDefaults().catch((err) => alert(`Erro ao restaurar sincronia: ${err.message}`));
});
document.getElementById("lipSyncTestSpeech")?.addEventListener("click", () => {
  testLipSyncSpeech().catch((err) => alert(`Erro no teste de fala: ${err.message}`));
});

document.getElementById("refreshStatus").addEventListener("click", refreshStatus);

document.getElementById("copyDiagnosticStatus")?.addEventListener(
  "click",
  copyDiagnosticStatus
);

document.getElementById("copyErrorLogs")?.addEventListener(
  "click",
  copyErrorLogs
);

document.getElementById("saveLayoutSettings")?.addEventListener(
  "click",
  () => {
    saveLayoutSettings().catch(err => {
      const status =
        document.getElementById("layoutSettingsStatus");

      if (status) {
        status.textContent =
          `Erro: ${err.message}`;
      }
    });
  }
);

document.getElementById("layoutManualSelect")?.addEventListener(
  "change",
  updatePreviewLayoutLink
);

document.getElementById("layoutForceManual")?.addEventListener(
  "change",
  updatePreviewLayoutLink
);

document.getElementById("resetCamera").addEventListener("click", async () => {
  await post("/api/state", { camera: { x: 0, y: 0, zoom: 1 } });
  refreshStatus();
});
document.getElementById("setNormalMode").addEventListener("click", async () => {
  await post("/api/state", { mode: "normal", current_actor: "main", camera: { x: 0, y: 0, zoom: 1 } });
  refreshStatus();
});
document.getElementById("setBattleMode").addEventListener("click", async () => {
  await post("/api/state", { mode: "battle", current_actor: "main", camera: { x: 0, y: 0, zoom: 1.06 } });
  refreshStatus();
});
for (const [controlKey, control] of Object.entries(bellyProfileControls)) {
  document.getElementById(control.rangeId).addEventListener("input", (event) => {
    queueBellyProfileControlSave(controlKey, event.target.value);
  });
  document.getElementById(control.valueId).addEventListener("change", (event) => {
    queueBellyProfileControlSave(controlKey, event.target.value);
  });
}
document.getElementById("applyBellyProfileScale").addEventListener("click", async () => {
  clearTimeout(bellyProfileScaleTimer);
  try {
    await saveBellyProfileControls();
  } catch (err) {
    alert(`Erro ao aplicar ajuste da foto: ${err.message}`);
  }
});
window.addEventListener("beforeunload", flushBellyProfileControlsBeforeUnload);
document.getElementById("startMonitor").addEventListener("click", async () => {
  const username = document.getElementById("monitorUser").value;
  const server_url = document.getElementById("monitorServer").value;
  await post("/api/monitor/start", { username, server_url });
  refreshStatus();
});
document.getElementById("stopMonitor").addEventListener("click", async () => {
  await post("/api/monitor/stop", {});
  refreshStatus();
});
function rendererWindowPayload() {
  return {
    url: document.getElementById("rendererUrl").value,
    width: Number(document.getElementById("rendererWidth").value || 720),
    height: Number(document.getElementById("rendererHeight").value || 1280),
    x: Number(document.getElementById("rendererX").value || 0),
    y: Number(document.getElementById("rendererY").value || 0),
    display: document.getElementById("rendererDisplay").value,
    fullscreen: document.getElementById("rendererFullscreen").checked,
    pulse_sink: latestStatus?.transmission?.audio_sink || latestStatus?.renderer_window?.pulse_sink || ""
  };
}
function transmissionPayload() {
  const renderer = rendererWindowPayload();
  return {
    rtmp_url: document.getElementById("streamRtmpUrl").value,
    output_file: document.getElementById("streamOutputFile").value,
    title: document.getElementById("streamTitle").value,
    game: document.getElementById("streamGame").value,
    audience_type: document.getElementById("streamAudience").value,
    auto_streamlabs: document.getElementById("streamAutoStreamlabs").checked,
    video_bitrate: Number(document.getElementById("streamBitrate").value || 3100),
    video_encoder: document.getElementById("streamEncoder").value,
    mode: document.getElementById("streamMode").value,
    rtmp_sink: document.getElementById("streamSink").value,
    display: document.getElementById("streamDisplay").value,
    audio_source: document.getElementById("streamAudioSource").value,
    renderer_url: renderer.url,
    renderer_width: renderer.width,
    renderer_height: renderer.height,
    renderer_x: renderer.x,
    renderer_y: renderer.y,
    renderer_fullscreen: renderer.fullscreen,
  };
}

function liveConfigFromMainForm() {
  const renderer = rendererWindowPayload();
  const transmission = transmissionPayload();
  return {
    username: document.getElementById("monitorUser").value,
    monitor_server: document.getElementById("monitorServer").value,
    mode: transmission.mode,
    title: transmission.title,
    game: transmission.game,
    audience_type: transmission.audience_type,
    auto_streamlabs: transmission.auto_streamlabs,
    rtmp_url: transmission.rtmp_url,
    output_file: transmission.output_file,
    video_bitrate: transmission.video_bitrate,
    video_encoder: transmission.video_encoder,
    rtmp_sink: transmission.rtmp_sink,
    display: transmission.display,
    audio_source: transmission.audio_source,
    renderer_url: renderer.url,
    renderer_width: renderer.width,
    renderer_height: renderer.height,
    renderer_x: renderer.x,
    renderer_y: renderer.y,
    renderer_fullscreen: renderer.fullscreen,
  };
}

function applyConfigToMainForm(config) {
  if (!config) return;
  document.getElementById("monitorUser").value = config.username || "bonecodoabismo";
  document.getElementById("monitorServer").value = config.monitor_server || "http://127.0.0.1:2618";
  document.getElementById("streamMode").value = config.mode || "normal";
  document.getElementById("streamTitle").value = config.title || "Live Do Boneco do Abismo";
  document.getElementById("streamGame").value = config.game || "Others";
  document.getElementById("streamAudience").value = config.audience_type || "0";
  document.getElementById("streamAutoStreamlabs").checked = config.auto_streamlabs !== false;
  document.getElementById("streamRtmpUrl").value = config.rtmp_url || "";
  document.getElementById("streamOutputFile").value = config.output_file || "";
  document.getElementById("streamBitrate").value = config.video_bitrate || 3100;
  document.getElementById("streamEncoder").value = config.video_encoder || "nvenc";
  document.getElementById("streamSink").value = config.rtmp_sink || "rtmp2sink";
  document.getElementById("streamDisplay").value = config.display || "";
  document.getElementById("streamAudioSource").value = config.audio_source || "";
  document.getElementById("rendererUrl").value = config.renderer_url || "http://127.0.0.1:9292/renderer";
  document.getElementById("rendererWidth").value = config.renderer_width || 720;
  document.getElementById("rendererHeight").value = config.renderer_height || 1280;
  document.getElementById("rendererX").value = config.renderer_x || 0;
  document.getElementById("rendererY").value = config.renderer_y || 0;
  document.getElementById("rendererDisplay").value = config.display || "";
  document.getElementById("rendererFullscreen").checked = Boolean(config.renderer_fullscreen);
}

function applyConfigToSchedule(config) {
  if (!config) return;
  document.getElementById("scheduleUsername").value = config.username || "bonecodoabismo";
  document.getElementById("scheduleMonitorServer").value = config.monitor_server || "http://127.0.0.1:2618";
  document.getElementById("scheduleMode").value = config.mode || "normal";
  document.getElementById("scheduleTitle").value = config.title || "Live Do Boneco do Abismo";
  document.getElementById("scheduleGame").value = config.game || "Others";
  document.getElementById("scheduleAudience").value = config.audience_type || "0";
  document.getElementById("scheduleAutoStreamlabs").checked = config.auto_streamlabs !== false;
  document.getElementById("scheduleRtmpUrl").value = config.rtmp_url || "";
  document.getElementById("scheduleOutputFile").value = config.output_file || "";
  document.getElementById("scheduleBitrate").value = config.video_bitrate || 3100;
  document.getElementById("scheduleEncoder").value = config.video_encoder || "nvenc";
  document.getElementById("scheduleSink").value = config.rtmp_sink || "rtmp2sink";
  document.getElementById("scheduleDisplay").value = config.display || "";
  document.getElementById("scheduleAudioSource").value = config.audio_source || "";
  document.getElementById("scheduleStartMin").value = secondsToMinutes(config.start_min_seconds, 3600);
  document.getElementById("scheduleStartMax").value = secondsToMinutes(config.start_max_seconds, 5400);
  document.getElementById("scheduleStopMin").value = secondsToMinutes(config.stop_min_seconds, 3000);
  document.getElementById("scheduleStopMax").value = secondsToMinutes(config.stop_max_seconds, 4200);
  document.getElementById("scheduleAutoEnabled").checked = Boolean(config.auto_start_enabled);
}

function liveConfigFromSchedule() {
  return {
    ...liveConfigFromMainForm(),
    username: document.getElementById("scheduleUsername").value,
    monitor_server: document.getElementById("scheduleMonitorServer").value,
    mode: document.getElementById("scheduleMode").value,
    title: document.getElementById("scheduleTitle").value,
    game: document.getElementById("scheduleGame").value,
    audience_type: document.getElementById("scheduleAudience").value,
    auto_streamlabs: document.getElementById("scheduleAutoStreamlabs").checked,
    rtmp_url: document.getElementById("scheduleRtmpUrl").value,
    output_file: document.getElementById("scheduleOutputFile").value,
    video_bitrate: Number(document.getElementById("scheduleBitrate").value || 3100),
    video_encoder: document.getElementById("scheduleEncoder").value,
    rtmp_sink: document.getElementById("scheduleSink").value,
    display: document.getElementById("scheduleDisplay").value,
    audio_source: document.getElementById("scheduleAudioSource").value,
    auto_start_enabled: document.getElementById("scheduleAutoEnabled").checked,
    start_min_seconds: minutesToSeconds(document.getElementById("scheduleStartMin").value, 60),
    start_max_seconds: minutesToSeconds(document.getElementById("scheduleStartMax").value, 90),
    stop_min_seconds: minutesToSeconds(document.getElementById("scheduleStopMin").value, 50),
    stop_max_seconds: minutesToSeconds(document.getElementById("scheduleStopMax").value, 70),
  };
}

async function loadLiveConfig() {
  const response = await fetch("/api/live/config", { cache: "no-store" });
  const config = await response.json();
  latestLiveConfig = config;
  applyConfigToMainForm(config);
  applyConfigToSchedule(config);
  document.getElementById("scheduleStatus").textContent = JSON.stringify(config, null, 2);
  return config;
}

async function saveLiveConfigFromSchedule() {
  const config = liveConfigFromSchedule();
  const saved = await post("/api/live/config", config);
  const schedule = await post("/api/live/schedule/check", {});
  latestLiveConfig = saved;
  applyConfigToMainForm(saved);
  applyConfigToSchedule(saved);
  document.getElementById("scheduleStatus").textContent = JSON.stringify({
    config: saved,
    schedule: schedule.schedule || {},
  }, null, 2);
  return saved;
}

async function toggleLiveFromTop() {
  const button = document.getElementById("liveToggleTop");
  const running = button.dataset.running === "1";
  button.disabled = true;
  try {
    if (running) {
      await post("/api/live/stop", {});
    } else {
      await post("/api/live/start", liveConfigFromMainForm());
    }
    await loadLiveConfig();
    await refreshStatus();
  } catch (err) {
    alert(`Erro na live: ${err.message}`);
    await refreshStatus();
  } finally {
    button.disabled = false;
  }
}

async function openScheduleModal() {
  const modal = document.getElementById("scheduleModal");
  const saved = latestLiveConfig || await loadLiveConfig();
  applyConfigToSchedule({
    ...saved,
    ...liveConfigFromMainForm(),
    auto_start_enabled: saved.auto_start_enabled,
    start_min_seconds: saved.start_min_seconds,
    start_max_seconds: saved.start_max_seconds,
    stop_min_seconds: saved.stop_min_seconds,
    stop_max_seconds: saved.stop_max_seconds,
  });
  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "open");
}

function closeScheduleModal() {
  const modal = document.getElementById("scheduleModal");
  if (typeof modal.close === "function") modal.close();
  else modal.removeAttribute("open");
}

document.getElementById("liveToggleTop").addEventListener("click", toggleLiveFromTop);
document.getElementById("openScheduleModal").addEventListener("click", openScheduleModal);
document.getElementById("openScheduleModalInline")?.addEventListener("click", openScheduleModal);
document.getElementById("closeScheduleModal").addEventListener("click", closeScheduleModal);
document.getElementById("saveScheduleConfig").addEventListener("click", async () => {
  try {
    await saveLiveConfigFromSchedule();
    await refreshStatus();
  } catch (err) {
    document.getElementById("scheduleStatus").textContent = `Erro: ${err.message}`;
  }
});
document.getElementById("saveScheduleAndStart").addEventListener("click", async () => {
  try {
    const config = await saveLiveConfigFromSchedule();
    await post("/api/live/start", config);
    closeScheduleModal();
    await refreshStatus();
  } catch (err) {
    document.getElementById("scheduleStatus").textContent = `Erro: ${err.message}`;
  }
});
document.getElementById("startRendererWindow").addEventListener("click", async () => {
  await post("/api/renderer-window/start", rendererWindowPayload());
  refreshStatus();
});
document.getElementById("startBattleRendererWindow").addEventListener("click", async () => {
  await post("/api/state", { mode: "battle", current_actor: "main", camera: { x: 0, y: 0, zoom: 1.06 } });
  const payload = { ...rendererWindowPayload(), url: "http://127.0.0.1:9292/renderer?mode=battle", fullscreen: true };
  await post("/api/renderer-window/start", payload);
  refreshStatus();
});
document.getElementById("restartRendererWindow").addEventListener("click", async () => {
  await post("/api/renderer-window/restart", rendererWindowPayload());
  refreshStatus();
});
document.getElementById("stopRendererWindow").addEventListener("click", async () => {
  await post("/api/renderer-window/stop", {});
  refreshStatus();
});
document.getElementById("startTransmission").addEventListener("click", async () => {
  const payload = transmissionPayload();
  await post("/api/state", { mode: payload.mode, current_actor: "main" });
  await post("/api/transmission/start", payload);
  refreshStatus();
});
document.getElementById("stopTransmission").addEventListener("click", async () => {
  await post("/api/transmission/stop", {});
  refreshStatus();
});
document.getElementById("sendSpeech").addEventListener("click", async () => {
  const text = document.getElementById("manualText").value;
  const actor = document.getElementById("actor").value;
  const manual_music_path =
    document.getElementById("manualSpeechMusic")?.value || "";
  const payload = await post("/api/speech/manual", {
    text,
    actor,
    manual_music_path,
  });
  if (payload.ok) document.getElementById("manualText").value = "";
  refreshStatus();
});
document.getElementById("sendCommentEvent").addEventListener("click", async () => {
  const username = document.getElementById("eventUser").value;
  const display_name = document.getElementById("eventDisplay").value;
  const text = document.getElementById("eventComment").value;
  const payload = await post("/api/events/comment", { username, display_name, text });
  if (payload.ok) document.getElementById("eventComment").value = "";
  refreshStatus();
});
document.getElementById("sendGiftEvent").addEventListener("click", async () => {
  const username = document.getElementById("eventUser").value;
  const display_name = document.getElementById("eventDisplay").value;
  const gift_name = document.getElementById("eventGift").value;
  const count = Number(document.getElementById("eventGiftCount").value || 1);
  await post("/api/events/gift", { username, display_name, gift_name, count });
  refreshStatus();
});

document.getElementById("previewCommentEvent").addEventListener("click", async () => {
  const username = document.getElementById("eventUser").value;
  const display_name = document.getElementById("eventDisplay").value;
  const text = document.getElementById("eventComment").value;
  const status = document.getElementById("previewEventStatus");

  if (!String(text || "").trim()) {
    if (status) status.textContent = "Digite um comentário para testar.";
    return;
  }

  const payload = await post(
    "/api/preview/events/comment",
    {
      username,
      display_name,
      text,
    }
  );

  if (status) {
    status.textContent = payload.ok
      ? "Comentário enviado somente ao preview visual."
      : "Falha ao enviar comentário ao preview.";
  }
});

document.getElementById("previewGiftEvent").addEventListener("click", async () => {
  const username = document.getElementById("eventUser").value;
  const display_name = document.getElementById("eventDisplay").value;
  const gift_name = document.getElementById("eventGift").value;
  const count = Number(
    document.getElementById("eventGiftCount").value || 1
  );
  const status = document.getElementById("previewEventStatus");

  const payload = await post(
    "/api/preview/events/gift",
    {
      username,
      display_name,
      gift_name,
      count,
    }
  );

  if (status) {
    status.textContent = payload.ok
      ? "Presente enviado somente ao preview visual."
      : "Falha ao enviar presente ao preview.";
  }
});
Promise.allSettled([
  loadLiveConfig(),
  loadLayoutSettings(),
  loadManualSpeechMusicOptions()
]).finally(refreshStatus);
setInterval(refreshStatus, 2500);
