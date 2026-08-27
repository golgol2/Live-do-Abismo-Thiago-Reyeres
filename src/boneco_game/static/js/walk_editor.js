const cfg = window.BONECO_WALK_EDITOR || { avatar: "BONECO_MAPA_2D", videos: [], presets: {} };

const sourceVideo = document.getElementById("sourceVideo");
const walkVideo = document.getElementById("walkVideo");
const loopGhostVideo = document.getElementById("loopGhostVideo");
const loopGhostCanvas = document.getElementById("loopGhostCanvas");
const loopGhostCtx = loopGhostCanvas?.getContext("2d", { willReadFrequently: true });
const currentTimeLabel = document.getElementById("currentTimeLabel");
const durationLabel = document.getElementById("durationLabel");
const loopBadge = document.getElementById("loopBadge");
const resultLog = document.getElementById("resultLog");
const timelineTrack = document.getElementById("timelineTrack");
const playhead = document.getElementById("playhead");
const segmentIntro = document.getElementById("segmentIntro");
const segmentAccel = document.getElementById("segmentAccel");
const segmentLoop = document.getElementById("segmentLoop");
const segmentDecel = document.getElementById("segmentDecel");
const segmentStop = document.getElementById("segmentStop");
const markers = Array.from(document.querySelectorAll(".timeline-marker"));
const showLoopGhost = document.getElementById("showLoopGhost");
const loopGhostOpacity = document.getElementById("loopGhostOpacity");

const fields = {
  start: document.getElementById("cutStart"),
  accel_end: document.getElementById("cutAccelEnd"),
  loop_start: document.getElementById("cutLoopStart"),
  loop_end: document.getElementById("cutLoopEnd"),
  decel_start: document.getElementById("cutDecelStart"),
  stop_end: document.getElementById("cutStopEnd"),
  key_color: document.getElementById("keyColor"),
  similarity: document.getElementById("similarity"),
  blend: document.getElementById("blend"),
  edge_px: document.getElementById("edgePx"),
  blur_px: document.getElementById("blurPx"),
  despill: document.getElementById("despill"),
  width: document.getElementById("outWidth"),
  height: document.getElementById("outHeight"),
  fit: document.getElementById("fitMode"),
  crf: document.getElementById("crf"),
};

let previewMode = "";
let previewEnd = 0;
let previewFrame = 0;
let draggingMarker = "";
let loopGhostSignature = "";

const defaults = {
  start: 1.7,
  accel_end: 3.0,
  loop_start: 3.25,
  loop_end: 7.8,
  decel_start: 8.4,
  stop_end: 14.6,
  key_color: "#08dd1d",
  similarity: 0.165,
  blend: 0.09,
  edge_px: 2,
  blur_px: 0.7,
  despill: 0.75,
  width: 832,
  height: 1472,
  fit: "cover",
  crf: 18,
};

function fileUrl(path) {
  return `/file?path=${encodeURIComponent(path)}&v=${Date.now()}`;
}

function selectedSource() {
  return sourceVideo.value || "";
}

function formatTime(value) {
  return `${Number(value || 0).toFixed(3)}s`;
}

function log(text) {
  resultLog.textContent = String(text || "");
}

function numberValue(key) {
  return Number(fields[key].value || 0);
}

function timelineDuration() {
  if (Number.isFinite(walkVideo.duration) && walkVideo.duration > 0) return walkVideo.duration;
  return Math.max(defaults.stop_end, numberValue("stop_end"), 1);
}

function percentForTime(seconds) {
  return Math.max(0, Math.min(100, (Number(seconds || 0) / timelineDuration()) * 100));
}

function timeForPointer(event) {
  const rect = timelineTrack.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
  return ratio * timelineDuration();
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function hexToRgb(value) {
  const clean = String(value || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return { r: 8, g: 221, b: 29 };
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function loopGhostKey(target) {
  return [
    selectedSource(),
    target.toFixed(3),
    fields.key_color.value,
    fields.similarity.value,
    fields.blend.value,
    fields.despill.value,
    loopGhostVideo.videoWidth,
    loopGhostVideo.videoHeight,
  ].join("|");
}

function drawLoopGhost(signature) {
  if (!loopGhostCtx || !loopGhostVideo.videoWidth || !loopGhostVideo.videoHeight) return;
  const width = loopGhostVideo.videoWidth;
  const height = loopGhostVideo.videoHeight;
  if (loopGhostCanvas.width !== width) loopGhostCanvas.width = width;
  if (loopGhostCanvas.height !== height) loopGhostCanvas.height = height;

  loopGhostCtx.clearRect(0, 0, width, height);
  loopGhostCtx.drawImage(loopGhostVideo, 0, 0, width, height);

  const key = hexToRgb(fields.key_color.value || defaults.key_color);
  const similarity = clamp01(fields.similarity.value || defaults.similarity);
  const blend = Math.max(0.001, clamp01(fields.blend.value || defaults.blend));
  const despill = clamp01(fields.despill.value || defaults.despill);
  const maxDist = Math.sqrt(3 * 255 * 255);

  const image = loopGhostCtx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const dist = Math.sqrt(
      ((red - key.r) ** 2) +
      ((green - key.g) ** 2) +
      ((blue - key.b) ** 2)
    ) / maxDist;

    let alphaScale = 1;
    if (dist <= similarity) alphaScale = 0;
    else if (dist < similarity + blend) alphaScale = (dist - similarity) / blend;

    if (alphaScale < 1) data[index + 3] = Math.round(data[index + 3] * alphaScale);
    if (alphaScale > 0 && green > red && green > blue) {
      data[index + 1] = Math.round(green * (1 - despill * 0.45));
    }
  }
  loopGhostCtx.putImageData(image, 0, 0);
  loopGhostSignature = signature;
}

function setFieldTime(key, seconds, seek = true) {
  if (!fields[key]) return;
  fields[key].value = Math.max(0, seconds).toFixed(3);
  if (seek) {
    stopPreview();
    walkVideo.currentTime = Math.max(0, Math.min(timelineDuration(), seconds));
    walkVideo.pause();
  }
  renderTimeline();
}

function placeSegment(node, start, end) {
  const left = percentForTime(start);
  const right = percentForTime(end);
  node.style.left = `${left}%`;
  node.style.width = `${Math.max(0, right - left)}%`;
}

function renderTimeline() {
  const start = numberValue("start");
  const accelEnd = numberValue("accel_end");
  const loopStart = numberValue("loop_start");
  const loopEnd = numberValue("loop_end");
  const decelStart = numberValue("decel_start");
  const stopEnd = numberValue("stop_end");
  placeSegment(segmentIntro, start, accelEnd);
  placeSegment(segmentAccel, accelEnd, loopStart);
  placeSegment(segmentLoop, loopStart, loopEnd);
  placeSegment(segmentDecel, loopEnd, decelStart);
  placeSegment(segmentStop, decelStart, stopEnd);
  playhead.style.left = `${percentForTime(walkVideo.currentTime)}%`;
  for (const marker of markers) {
    const key = marker.dataset.field;
    marker.style.left = `${percentForTime(numberValue(key))}%`;
  }
}

function syncLoopGhost(forceSeek = false) {
  if (!loopGhostVideo || !loopGhostCanvas) return;
  const visible = Boolean(showLoopGhost?.checked);
  loopGhostCanvas.classList.toggle("hidden", !visible);
  loopGhostCanvas.style.opacity = String(Number(loopGhostOpacity?.value || 0.35));
  if (!visible || !loopGhostVideo.src || !loopGhostCtx || !loopGhostVideo.readyState) return;
  const target = Math.max(0, Math.min(timelineDuration(), numberValue("loop_start")));
  const signature = loopGhostKey(target);
  if (!forceSeek && signature === loopGhostSignature) return;
  const needsSeek = forceSeek || Math.abs(Number(loopGhostVideo.currentTime || 0) - target) > 0.04;
  if (!needsSeek) {
    drawLoopGhost(signature);
    return;
  }
  try {
    loopGhostVideo.pause();
    loopGhostVideo.addEventListener("seeked", () => drawLoopGhost(signature), { once: true });
    loopGhostVideo.currentTime = target;
  } catch (err) {
    console.warn("loop ghost seek failed", err);
  }
}

function presetPayload() {
  return {
    source: selectedSource(),
    start: numberValue("start"),
    accel_end: numberValue("accel_end"),
    loop_start: numberValue("loop_start"),
    loop_end: numberValue("loop_end"),
    decel_start: numberValue("decel_start"),
    stop_end: numberValue("stop_end"),
    key_color: fields.key_color.value.trim() || defaults.key_color,
    similarity: numberValue("similarity"),
    blend: numberValue("blend"),
    edge_px: numberValue("edge_px"),
    blur_px: numberValue("blur_px"),
    despill: numberValue("despill"),
    width: Math.max(1, Math.round(numberValue("width"))),
    height: Math.max(1, Math.round(numberValue("height"))),
    fit: fields.fit.value,
    crf: Math.max(0, Math.round(numberValue("crf"))),
  };
}

function validateCuts(payload = presetPayload()) {
  if (!payload.source) throw new Error("Selecione um video.");
  if (!(payload.start >= 0 && payload.start < payload.loop_start && payload.loop_start < payload.loop_end && payload.loop_end < payload.stop_end)) {
    throw new Error("Cortes invalidos: inicio < loop inicio < loop fim < parada fim.");
  }
  if (!(payload.start <= payload.accel_end && payload.accel_end <= payload.loop_start)) {
    throw new Error("Aceleracao deve ficar entre o inicio do movimento e o primeiro passo do loop.");
  }
  if (!(payload.loop_end <= payload.decel_start && payload.decel_start <= payload.stop_end)) {
    throw new Error("Desaceleracao deve ficar entre o ultimo passo do loop e o fim da parada.");
  }
}

function applyPreset(preset = {}) {
  const merged = { ...defaults, ...preset };
  for (const [key, input] of Object.entries(fields)) {
    if (input.tagName === "SELECT") input.value = String(merged[key] ?? defaults[key]);
    else input.value = String(merged[key] ?? defaults[key]);
  }
  renderTimeline();
}

function loadSelectedVideo() {
  stopPreview();
  const source = selectedSource();
  if (!source) {
    walkVideo.removeAttribute("src");
    loopGhostVideo.removeAttribute("src");
    loopGhostSignature = "";
    loopGhostCtx?.clearRect(0, 0, loopGhostCanvas.width || 0, loopGhostCanvas.height || 0);
    walkVideo.load();
    loopGhostVideo.load();
    return;
  }
  walkVideo.src = fileUrl(source);
  loopGhostVideo.src = fileUrl(source);
  loopGhostSignature = "";
  walkVideo.load();
  loopGhostVideo.load();
  applyPreset(cfg.presets?.[source] || defaults);
  syncLoopGhost(true);
  log(`Video carregado: ${source}`);
}

function fillVideoSelect() {
  sourceVideo.replaceChildren();
  for (const item of cfg.videos || []) {
    const option = document.createElement("option");
    option.value = item.path;
    option.textContent = item.name;
    sourceVideo.appendChild(option);
  }
  if (!sourceVideo.options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhum video em ANDANDO";
    sourceVideo.appendChild(option);
  }
  const presetSource = Object.keys(cfg.presets || {}).find(source =>
    Array.from(sourceVideo.options).some(option => option.value === source)
  );
  if (presetSource) sourceVideo.value = presetSource;
  loadSelectedVideo();
}

function updateTimeLabels() {
  currentTimeLabel.textContent = formatTime(walkVideo.currentTime);
  durationLabel.textContent = Number.isFinite(walkVideo.duration) ? formatTime(walkVideo.duration) : "0.000s";
  renderTimeline();
  syncLoopGhost(false);
}

function stopPreview() {
  previewMode = "";
  previewEnd = 0;
  loopBadge.hidden = true;
  if (previewFrame) {
    cancelAnimationFrame(previewFrame);
    previewFrame = 0;
  }
}

function previewTick() {
  if (!previewMode) return;
  if (walkVideo.currentTime >= previewEnd) {
    if (previewMode === "loop") {
      walkVideo.currentTime = numberValue("loop_start");
      walkVideo.play().catch(() => {});
    } else {
      walkVideo.pause();
      stopPreview();
      return;
    }
  }
  previewFrame = requestAnimationFrame(previewTick);
}

function playSegment(start, end, mode = "once") {
  try {
    validateCuts();
  } catch (err) {
    log(err.message);
    return;
  }
  stopPreview();
  previewMode = mode;
  previewEnd = end;
  loopBadge.hidden = mode !== "loop";
  walkVideo.currentTime = start;
  walkVideo.play().catch(() => {});
  previewFrame = requestAnimationFrame(previewTick);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `Erro HTTP ${response.status}`);
  return data;
}

async function savePreset() {
  try {
    const payload = presetPayload();
    validateCuts(payload);
    const data = await postJson("/api/walk-editor/preset", payload);
    cfg.presets = data.presets || cfg.presets || {};
    log("Preset salvo.");
  } catch (err) {
    log(err.message);
  }
}

async function processWalk() {
  try {
    const payload = presetPayload();
    validateCuts(payload);
    log("Processando cortes. Aguarde...");
    const data = await postJson("/api/walk-editor/process", payload);
    cfg.presets = { ...(cfg.presets || {}), [data.source]: data.preset };
    log((data.logs || []).join("\n"));
  } catch (err) {
    log(err.message);
  }
}

document.querySelectorAll("[data-mark]").forEach(button => {
  button.addEventListener("click", () => {
    const id = button.dataset.mark;
    const input = document.getElementById(id);
    if (input) {
      input.value = walkVideo.currentTime.toFixed(3);
      renderTimeline();
      syncLoopGhost(true);
    }
  });
});

for (const input of [fields.start, fields.accel_end, fields.loop_start, fields.loop_end, fields.decel_start, fields.stop_end]) {
  input.addEventListener("input", () => {
    renderTimeline();
    syncLoopGhost(input === fields.loop_start);
  });
  input.addEventListener("change", () => {
    walkVideo.currentTime = Math.max(0, Math.min(timelineDuration(), Number(input.value || 0)));
    renderTimeline();
    syncLoopGhost(input === fields.loop_start);
  });
}

for (const input of [fields.key_color, fields.similarity, fields.blend, fields.despill]) {
  input.addEventListener("input", () => syncLoopGhost(true));
  input.addEventListener("change", () => syncLoopGhost(true));
}

timelineTrack.addEventListener("pointerdown", event => {
  const marker = event.target.closest?.(".timeline-marker");
  if (!marker) {
    stopPreview();
    walkVideo.currentTime = timeForPointer(event);
    walkVideo.pause();
    renderTimeline();
    return;
  }
  event.preventDefault();
  draggingMarker = marker.dataset.field || "";
  marker.setPointerCapture?.(event.pointerId);
  setFieldTime(draggingMarker, timeForPointer(event));
});

timelineTrack.addEventListener("pointermove", event => {
  if (!draggingMarker) return;
  event.preventDefault();
  setFieldTime(draggingMarker, timeForPointer(event));
});

timelineTrack.addEventListener("pointerup", () => {
  draggingMarker = "";
});

timelineTrack.addEventListener("pointercancel", () => {
  draggingMarker = "";
});

document.getElementById("previewStart").addEventListener("click", () => {
  playSegment(numberValue("start"), numberValue("loop_start"), "once");
});
document.getElementById("previewLoop").addEventListener("click", () => {
  playSegment(numberValue("loop_start"), numberValue("loop_end"), "loop");
});
document.getElementById("previewStop").addEventListener("click", () => {
  playSegment(numberValue("loop_end"), numberValue("stop_end"), "once");
});
document.getElementById("savePreset").addEventListener("click", savePreset);
document.getElementById("processWalk").addEventListener("click", processWalk);
document.getElementById("stopPreview").addEventListener("click", () => {
  walkVideo.pause();
  stopPreview();
});
document.getElementById("togglePlay").addEventListener("click", () => {
  stopPreview();
  if (walkVideo.paused) walkVideo.play().catch(() => {});
  else walkVideo.pause();
});
document.getElementById("stepBack").addEventListener("click", () => {
  stopPreview();
  walkVideo.pause();
  walkVideo.currentTime = Math.max(0, walkVideo.currentTime - 1 / 24);
});
document.getElementById("stepForward").addEventListener("click", () => {
  stopPreview();
  walkVideo.pause();
  walkVideo.currentTime = Math.min(walkVideo.duration || Infinity, walkVideo.currentTime + 1 / 24);
});

sourceVideo.addEventListener("change", loadSelectedVideo);
walkVideo.addEventListener("timeupdate", updateTimeLabels);
walkVideo.addEventListener("loadedmetadata", updateTimeLabels);
walkVideo.addEventListener("seeked", renderTimeline);
loopGhostVideo.addEventListener("loadedmetadata", () => syncLoopGhost(true));
showLoopGhost.addEventListener("change", () => syncLoopGhost(true));
loopGhostOpacity.addEventListener("input", () => syncLoopGhost(false));

fillVideoSelect();
