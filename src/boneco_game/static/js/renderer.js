const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 1280;
const MICRO_PAUSE_RATE = 0.58;
const SHORT_PAUSE_LIMIT = 0.35;
const DEFAULT_MICRO_PAUSE_MAX = 0.35;
const DEFAULT_PAUSE_TO_MUTE_MIN = 2.0;
const DEFAULT_MUTE_SWITCH_ADVANCE = 0.025;
const STALLED_VIDEO_PLAY_RETRY_MS = 2500;
const STALLED_VIDEO_SWITCH_MS = 4000;
const STALLED_VIDEO_RELOAD_MS = 8000;
const GENERAL_VIDEO_PLAY_RETRY_MS = 1200;
const GENERAL_VIDEO_RESTART_MS = 4500;
const GENERAL_VIDEO_RELOAD_MS = 12000;
const SPEECH_STUCK_TIMEOUT_MS = 18000;
const MUSIC_IDLE_VOLUME = 0.16;
const MUSIC_SPEECH_VOLUME = 0.055;
const MUSIC_REACTION_VOLUME = 0.006;
const LAYOUT_W = 360;
const LAYOUT_H = 640;
const BELLY_PROFILE_BASE_SIZE = 92;
const RENDERER_ASSET_VERSION = "94";

const stage = document.getElementById("stage");
const cameraLayer = document.getElementById("cameraLayer");
const layoutCanvas = document.getElementById("layoutCanvas");
const layoutOverlayCanvas = document.getElementById("layoutOverlayCanvas");
const layoutCtx = layoutCanvas ? layoutCanvas.getContext("2d", { alpha: false }) : null;
const layoutOverlayCtx = layoutOverlayCanvas ? layoutOverlayCanvas.getContext("2d", { alpha: true }) : null;
const skyLayer = document.getElementById("skyLayer");
const world = document.getElementById("world");
const actorLayer = document.getElementById("actorLayer");
const mapBack = document.getElementById("mapBack");
const mapFront = document.getElementById("mapFront");
const videoA = document.getElementById("actorVideoA");
const videoB = document.getElementById("actorVideoB");
const sceneAudio = document.getElementById("sceneAudio");
const musicAudio = document.getElementById("musicAudio");
const audioUnlock = document.getElementById("audioUnlock");
const messageCard = document.getElementById("messageCard");
const avatarImage = document.getElementById("avatarImage");
const avatarLetter = document.getElementById("avatarLetter");
const messageTitle = document.getElementById("messageTitle");
const messageText = document.getElementById("messageText");
const bellyProfile = document.getElementById("bellyProfile");
const bellyProfileImage = document.getElementById("bellyProfileImage");
const bellyProfileLetter = document.getElementById("bellyProfileLetter");
const rendererUrlParams = new URLSearchParams(window.location.search);
const urlMode = rendererUrlParams.get("mode") || "";
const rendererPreviewMode = rendererUrlParams.get("preview") === "1";
const rendererPreviewLayout = String(
  rendererUrlParams.get("layout") || ""
).trim();

function reportRendererBootError(payload = {}) {
  fetch(
    "/api/renderer/heartbeat",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phase: "error",
        location: window.location.href,
        ...payload,
      }),
      cache: "no-store",
    }
  ).catch(() => {});
}

window.addEventListener("error", event => {
  reportRendererBootError({
    error: String(event.message || "renderer error"),
    source: String(event.filename || ""),
    lineno: Number(event.lineno || 0),
    colno: Number(event.colno || 0),
  });
});

window.addEventListener("unhandledrejection", event => {
  reportRendererBootError({
    error: String(event.reason?.message || event.reason || "renderer rejection"),
    source: "unhandledrejection",
  });
});

let previewEventCursor = 0;
let previewVisualQueue = [];
let previewVisualBusy = false;
let previewGiftLeaderboard = [];
const loadedLayoutAssets = new Set();
const loadingLayoutAssets = new Map();
let layoutActivationToken = 0;

let activeVideo = videoA;
let standbyVideo = videoB;
let currentVideo = "";
let currentScene = "";
let currentMap = null;
let visualMode = "layout";
let activeLayout = "classic";
let mapSignature = "";
let mapRuntimeKey = "";
let skyRuntimeKey = "";
let lastGameLoopAt = 0;
let lastLayoutDrawAt = 0;
let mapEntries = [];
let musicTracks = [];
let manualMusicTracks = [];
let musicCurrent = "";
let manualSpeechMusicActive = false;
let manualSpeechMusicTrack = "";
let manualSpeechMusicPrevious = "";
let musicAudioContext = null;
let musicAnalyser = null;
let musicFreqData = null;
let musicEnergy = 0;
let musicBass = 0;
let visualHue = 144;
let visualPeople = [];
let visualPeopleSignature = "";
const visualImageCache = new Map();
let mediaState = {
  idle: [],
  manual_idle: [],
  talking: [],
  reactions: [],
};
let mediaCacheVersion = "";
let activeSpeechToken = 0;
let speechBusy = false;
let speechFetchBusy = false;
let speechStartedAt = 0;
let speechDeadlineAt = 0;
let activeSpeechJob = null;
let reactionBusy = false;
let answeredInteractionCount = 0;
let lastReactionVideo = "";
const REACTION_EVERY_RESPONSES = 20;
let runtimeConfig = {
  micro_pause_rate: MICRO_PAUSE_RATE,
  micro_pause_freeze_max: DEFAULT_MICRO_PAUSE_MAX,
  pause_to_mute_min: DEFAULT_PAUSE_TO_MUTE_MIN,
  mute_switch_advance: DEFAULT_MUTE_SWITCH_ADVANCE,
  music_idle_volume: MUSIC_IDLE_VOLUME,
  music_speech_volume: MUSIC_SPEECH_VOLUME,
};
let timelineFrame = 0;
let timelineFinishTimer = 0;
let videoWatchdogFrame = 0;
let videoWatchdogState = {
  src: "",
  time: 0,
  wallAt: 0,
  lastPresentedFrameAt: 0,
  presentedFrames: 0,
  callbackVideo: null,
};
let videoRecoveryBusy = false;
let videoFrameCallbackToken = 0;
let generalVideoWatchdogState = {
  src: "",
  time: 0,
  wallAt: 0,
  retryAt: 0,
  recovering: false,
};
const bellyTrackCanvas = document.createElement("canvas");
bellyTrackCanvas.width = 144;
bellyTrackCanvas.height = 256;
const bellyTrackCtx = bellyTrackCanvas.getContext("2d", { willReadFrequently: true });
const bellyMaskCanvas = document.createElement("canvas");
bellyMaskCanvas.width = bellyTrackCanvas.width;
bellyMaskCanvas.height = bellyTrackCanvas.height;
const bellyMaskCtx = bellyMaskCanvas.getContext("2d", { willReadFrequently: true });
let bellyTrackFrame = 0;
let bellyTrackLastScan = 0;
let bellyTrackMisses = 0;
let bellyProfileScale = 0.82;
let bellyProfileOffsetX = 0;
let bellyProfileOffsetY = 0;
let bellyTrackPosition = { x: 360, y: 640, size: 92, holeRadius: 46 };
let videoSwitchToken = 0;
let idleFullPlay = false;
let idleFullPlayStartedAt = 0;
let liveCameraConfig = {
  enabled: true,
  manualShot: "auto",
  farZoomMin: 0.82,
  mediumZoomMax: 1.22,
  closeZoomMax: 1.40,
  xMax: 22,
  closeYMax: 175,
  transitionMin: 3,
  transitionMax: 7,
  responsesMin: 2,
  responsesMax: 5,
};

let liveCamera = {
  currentZoom: 1,
  targetZoom: 1,
  currentX: 0,
  targetX: 0,
  currentY: 0,
  targetY: 0,
  shot: "full",
  responsesLeft: 3,
  transitionSeconds: 5,
  lastFrameAt: 0,
  lastManualShot: "auto",
  initialized: false,
};


function fitStage() {
  const scale = Math.max(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
  const left = (window.innerWidth - STAGE_WIDTH * scale) * 0.5;
  const top = (window.innerHeight - STAGE_HEIGHT * scale) * 0.5;
  stage.style.setProperty("--stage-scale", String(scale));
  stage.style.setProperty("--stage-left", `${left}px`);
  stage.style.setProperty("--stage-top", `${top}px`);
}

window.addEventListener("resize", fitStage, { passive: true });
fitStage();

audioUnlock.addEventListener("click", () => {
  sceneAudio.muted = false;
  sceneAudio.volume = 1;
  if (musicAudio) {
    musicAudio.muted = false;
    musicAudio.playbackRate = 1;
    musicAudio.play().catch(() => {});
    if (musicAudioContext?.state === "suspended") musicAudioContext.resume().catch(() => {});
  }
  audioUnlock.hidden = true;
});

function fileUrl(path) {
  if (!path) return "";
  const version = mediaCacheVersion || "dev";
  return `/file?path=${encodeURIComponent(path)}&v=${encodeURIComponent(version)}`;
}

function mediaImageUrl(path) {
  const clean = String(path || "").trim();
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean) || clean.startsWith("data:") || clean.startsWith("/assets/") || clean.startsWith("/static/")) {
    return clean;
  }
  return fileUrl(clean);
}


function syncVisualPeople(people) {
  const seen = new Set();
  const next = [];
  for (const item of Array.isArray(people) ? people : []) {
    const profile = String(item.profile_image || item.avatar_url || item.avatarUrl || "").trim();
    const username = String(item.username || "").trim();
    const displayName = String(item.display_name || username).trim();
    if (!profile || (!username && !displayName)) continue;
    const key = (username || displayName || profile).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({
      key,
      username,
      displayName,
      profile,
      weight: Number(item.weight || 1),
    });
    if (next.length >= 18) break;
  }
  const signature = next.map((item) => `${item.key}:${item.profile}`).join("|");
  if (signature === visualPeopleSignature) return;
  visualPeopleSignature = signature;
  visualPeople = next;
  for (const person of visualPeople) preloadVisualImage(person.profile);
}

function preloadVisualImage(path) {
  const url = mediaImageUrl(path);
  if (!url || visualImageCache.has(url)) return null;
  const img = new Image();
  const entry = { img, loaded: false, failed: false };
  img.onload = () => {
    entry.loaded = true;
  };
  img.onerror = () => {
    entry.failed = true;
  };
  img.decoding = "async";
  img.src = url;
  visualImageCache.set(url, entry);
  return entry;
}

function visualImageEntry(path) {
  const url = mediaImageUrl(path);
  if (!url) return null;
  const entry = visualImageCache.get(url) || preloadVisualImage(path);
  if (!entry || entry.failed) return null;
  if (entry.loaded || (entry.img.complete && entry.img.naturalWidth > 0)) {
    entry.loaded = true;
    return entry;
  }
  return null;
}


function drawVisualProfile(ctx, person, x, y, radius, hue, alpha) {
  const entry = visualImageEntry(person.profile);
  if (!entry) return false;
  const img = entry.img;
  const size = radius * 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = Math.max(0.2, Math.min(0.9, alpha));
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  const sourceSize = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const sx = ((img.naturalWidth || img.width) - sourceSize) * 0.5;
  const sy = ((img.naturalHeight || img.height) - sourceSize) * 0.5;
  ctx.drawImage(img, sx, sy, sourceSize, sourceSize, x - radius, y - radius, size, size);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `hsla(${hue}, 100%, 68%, ${0.35 + alpha * 0.45})`;
  ctx.lineWidth = Math.max(1.2, radius * 0.16);
  ctx.beginPath();
  ctx.arc(x, y, radius + 1.1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${0.18 + alpha * 0.2})`;
  ctx.lineWidth = Math.max(0.7, radius * 0.06);
  ctx.beginPath();
  ctx.arc(x, y, radius - 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  return true;
}

function assetUrl(path) {
  if (!path) return "";
  return path.startsWith("/") ? fileUrl(path) : `/assets/${path}`;
}

function pick(list, avoid = "") {
  const source = (list || []).filter(Boolean);
  if (!source.length) return "";
  const filtered = source.filter(item => item !== avoid);
  const pool = filtered.length ? filtered : source;
  return pool[Math.floor(Math.random() * pool.length)];
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sameStringList(left, right) {
  const a = Array.isArray(left) ? left.map(String) : [];
  const b = Array.isArray(right) ? right.map(String) : [];
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function isLayoutVisualMode() {
  return visualMode !== "map";
}


function normalizeLiveCameraConfig(state = {}) {
  const farZoomMin = clampNumber(state.camera_far_zoom_min, 0.68, 0.98, 0.82);
  const mediumMax = clampNumber(state.camera_medium_zoom_max, 1.08, 1.30, 1.22);
  const closeMax = Math.max(mediumMax + 0.03, clampNumber(state.camera_close_zoom_max, 1.18, 1.48, 1.40));
  const transitionMin = clampNumber(state.camera_transition_min, 1.5, 12, 3);
  const transitionMax = Math.max(transitionMin, clampNumber(state.camera_transition_max, transitionMin, 15, 7));
  const responsesMin = Math.round(clampNumber(state.camera_responses_min, 1, 8, 2));
  const responsesMax = Math.max(responsesMin, Math.round(clampNumber(state.camera_responses_max, responsesMin, 12, 5)));
  liveCameraConfig = {
    enabled: state.dynamic_camera_enabled !== false,
    manualShot: ["auto", "distant", "full", "medium", "close"].includes(String(state.camera_manual_shot || "auto"))
      ? String(state.camera_manual_shot || "auto") : "auto",
    farZoomMin,
    mediumZoomMax: mediumMax,
    closeZoomMax: closeMax,
    xMax: clampNumber(state.camera_x_max, 0, 60, 22),
    closeYMax: clampNumber(state.camera_close_y_max, 40, 260, 175),
    transitionMin, transitionMax, responsesMin, responsesMax,
  };
}

function cameraShotTarget(kind) {
  const cfg = liveCameraConfig;
  const x = randomBetween(-cfg.xMax, cfg.xMax);
  if (kind === "distant") {
    return {
      kind,
      zoom: randomBetween(
        cfg.farZoomMin,
        Math.min(0.98, cfg.farZoomMin + 0.08)
      ),
      x: x * 0.28,
      y: randomBetween(-22, 18),
    };
  }
  if (kind === "close") {
    return {
      kind,
      zoom: randomBetween(Math.max(1.20, cfg.mediumZoomMax + 0.03), cfg.closeZoomMax),
      x,
      y: randomBetween(cfg.closeYMax * 0.66, cfg.closeYMax),
    };
  }
  if (kind === "medium") {
    return {
      kind,
      zoom: randomBetween(1.08, cfg.mediumZoomMax),
      x: x * 0.82,
      y: randomBetween(cfg.closeYMax * 0.10, cfg.closeYMax * 0.26),
    };
  }
  return { kind: "full", zoom: randomBetween(1.0, 1.05), x: x * 0.45, y: randomBetween(-10, 14) };
}

function chooseNextCameraShot(forceKind = "") {
  let kind = String(forceKind || "").trim().toLowerCase();
  if (!["distant", "full", "medium", "close"].includes(kind)) {
    const choices = liveCamera.shot === "close"
      ? ["full", "medium", "distant", "full"]
      : liveCamera.shot === "medium"
        ? ["full", "close", "distant", "full", "close"]
        : liveCamera.shot === "distant"
          ? ["full", "medium", "close", "full", "medium"]
          : ["medium", "close", "distant", "medium", "close", "full"];
    kind = choices[Math.floor(Math.random() * choices.length)] || "full";
  }
  const target = cameraShotTarget(kind);
  liveCamera.shot = target.kind;
  liveCamera.targetZoom = target.zoom;
  liveCamera.targetX = target.x;
  liveCamera.targetY = target.y;
  liveCamera.transitionSeconds = randomBetween(liveCameraConfig.transitionMin, liveCameraConfig.transitionMax);
  liveCamera.responsesLeft = randomIntInclusive(liveCameraConfig.responsesMin, liveCameraConfig.responsesMax);
}

function resetDynamicLiveCamera() {
  Object.assign(liveCamera, {
    currentZoom: 1, targetZoom: 1,
    currentX: 0, targetX: 0,
    currentY: 0, targetY: 0,
    shot: "full",
    responsesLeft: randomIntInclusive(liveCameraConfig.responsesMin, liveCameraConfig.responsesMax),
    transitionSeconds: Math.max(2, liveCameraConfig.transitionMin),
    lastFrameAt: 0,
    initialized: true,
  });
  if (cameraLayer) {
    cameraLayer.style.transform = "translate3d(0px,0px,0) scale(1)";
  }
  if (world) {
    world.style.removeProperty("--layout-world-transform");
  }
  if (stage) {
    stage.dataset.cameraDistance = "normal";
  }
}

function onSpeechCompletedForCamera() {
  if (!isLayoutVisualMode() || !liveCameraConfig.enabled || liveCameraConfig.manualShot !== "auto") return;
  liveCamera.responsesLeft -= 1;
  if (liveCamera.responsesLeft <= 0) chooseNextCameraShot();
}

function updateDynamicLiveCamera(now) {
  if (!cameraLayer) return;
  if (!isLayoutVisualMode() || !liveCameraConfig.enabled) {
    liveCamera.targetZoom = 1; liveCamera.targetX = 0; liveCamera.targetY = 0;
  } else {
    if (!liveCamera.initialized) resetDynamicLiveCamera();
    if (liveCameraConfig.manualShot !== liveCamera.lastManualShot) {
      liveCamera.lastManualShot = liveCameraConfig.manualShot;
      chooseNextCameraShot(liveCameraConfig.manualShot === "auto" ? "" : liveCameraConfig.manualShot);
    }
  }
  if (!liveCamera.lastFrameAt) liveCamera.lastFrameAt = now;
  const dt = Math.min(0.08, Math.max(0.001, (now - liveCamera.lastFrameAt) / 1000));
  liveCamera.lastFrameAt = now;
  const smoothing = 1 - Math.exp(-dt * (4.2 / Math.max(1.5, Number(liveCamera.transitionSeconds || 5))));
  liveCamera.currentZoom += (liveCamera.targetZoom - liveCamera.currentZoom) * smoothing;
  liveCamera.currentX += (liveCamera.targetX - liveCamera.currentX) * smoothing;
  liveCamera.currentY += (liveCamera.targetY - liveCamera.currentY) * smoothing;
  const cameraZoom = Number(liveCamera.currentZoom || 1);
  const cameraX = Number(liveCamera.currentX || 0);
  const cameraY = Number(liveCamera.currentY || 0);

  if (isLayoutVisualMode() && cameraZoom < 0.999) {
    // DISTANTE = camera recua dentro do mundo, nao reduz a tela.
    cameraLayer.style.transform =
      "translate3d(0px, 0px, 0) scale(1)";

    if (world) {
      world.style.setProperty(
        "--layout-world-transform",
        `translate3d(${cameraX.toFixed(2)}px, ${(cameraY * 0.35).toFixed(2)}px, 0) scale(${cameraZoom.toFixed(5)})`
      );
    }

    stage.dataset.cameraDistance = "distant";
  } else {
    if (world) {
      world.style.removeProperty("--layout-world-transform");
    }

    cameraLayer.style.transform =
      `translate3d(${cameraX.toFixed(2)}px, ${cameraY.toFixed(2)}px, 0) scale(${cameraZoom.toFixed(5)})`;

    stage.dataset.cameraDistance = "normal";
  }
}


function clearMapForLayout() {
  if (!mapEntries.length && mapSignature === "__layout__") return;
  mapEntries = [];
  mapSignature = "__layout__";
  mapBack.replaceChildren();
  mapFront.replaceChildren();
}

function positionLayoutActor() {
  if (world) world.style.transform = "none";
  actorLayer.style.setProperty("--actor-x", "0px");
  actorLayer.style.setProperty("--actor-y", "0px");
  actorLayer.style.setProperty("--actor-scale", "1");
}

function maintainLiveAvatarScene() {
  currentMap = null;
  clearMapForLayout();
  positionLayoutActor();

  if (speechBusy || reactionBusy) return;

  if (currentScene === "idle" && idleFullPlay && activeVideo?.ended) {
    currentScene = "";
    currentVideo = "";
    idleFullPlay = false;
  }

  if (!currentVideo || currentScene !== "idle") {
    setScene("idle").catch(console.warn);
  }
}

function syncMusicTracks(tracks) {
  const next = (Array.isArray(tracks) ? tracks : []).map(String).filter(Boolean);
  if (sameStringList(next, musicTracks)) return;
  musicTracks = next;
  if (!musicTracks.length) {
    if (musicAudio && !manualSpeechMusicActive) musicAudio.pause();
    musicCurrent = "";
    return;
  }
  if (!manualSpeechMusicActive && !musicTracks.includes(musicCurrent)) {
    playNextMusic(true);
  }
}

function syncManualMusicTracks(tracks) {
  manualMusicTracks = (Array.isArray(tracks) ? tracks : [])
    .map(String)
    .filter(Boolean);
}

function runtimeVolume(key, fallback) {
  return Math.max(0, Math.min(1, runtimeNumber(key, fallback)));
}

function targetMusicVolume() {
  if (reactionBusy) return MUSIC_REACTION_VOLUME;
  return speechBusy
    ? runtimeVolume("music_speech_volume", MUSIC_SPEECH_VOLUME)
    : runtimeVolume("music_idle_volume", MUSIC_IDLE_VOLUME);
}

function ensureMusicAnalyser() {
  if (!musicAudio || musicAnalyser) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    musicAudioContext = new AudioContextClass();
    const source = musicAudioContext.createMediaElementSource(musicAudio);
    musicAnalyser = musicAudioContext.createAnalyser();
    musicAnalyser.fftSize = 128;
    musicAnalyser.smoothingTimeConstant = 0.72;
    musicFreqData = new Uint8Array(musicAnalyser.frequencyBinCount);
    source.connect(musicAnalyser);
    musicAnalyser.connect(musicAudioContext.destination);
  } catch (err) {
    console.warn("music analyser unavailable", err);
    musicAnalyser = null;
    musicFreqData = null;
  }
}

function playNextMusic(force = false) {
  if (!musicAudio) return;
  if (manualSpeechMusicActive && manualSpeechMusicTrack) {
    playMusicTrack(manualSpeechMusicTrack, { loop: true, restart: false });
    return;
  }
  if (!musicTracks.length) return;
  const next = pick(musicTracks, force ? "" : musicCurrent);
  if (!next) return;
  playMusicTrack(next, { loop: musicTracks.length < 2, restart: next !== musicCurrent });
}

function playMusicTrack(track, { loop = false, restart = false } = {}) {
  if (!musicAudio || !track) return;
  if (track !== musicCurrent) {
    musicCurrent = track;
    musicAudio.src = fileUrl(track);
    restart = true;
  }
  if (restart) {
    try {
      musicAudio.currentTime = 0;
    } catch (err) {
      console.warn("music rewind failed", err);
    }
  }
  musicAudio.loop = Boolean(loop);
  musicAudio.playbackRate = 1;
  musicAudio.volume = targetMusicVolume();
  musicAudio.muted = false;
  ensureMusicAnalyser();
  musicAudio.play().catch(() => {
    audioUnlock.hidden = false;
  });
}

if (musicAudio) {
  musicAudio.addEventListener("ended", () => playNextMusic(false));
}

function updateMusicVolume() {
  if (!musicAudio || (!musicTracks.length && !manualSpeechMusicTrack)) return;
  if (musicAudio.paused) {
    if (manualSpeechMusicActive && manualSpeechMusicTrack) {
      playMusicTrack(manualSpeechMusicTrack, { loop: true, restart: false });
      return;
    }
    playNextMusic(false);
    return;
  }
  const target = targetMusicVolume();
  musicAudio.volume += (target - musicAudio.volume) * 0.055;
}

function updateMusicEnergy(nowSeconds) {
  if (musicAnalyser && musicFreqData) {
    if (musicAudioContext?.state === "suspended") {
      musicAudioContext.resume().catch(() => {});
    }
    musicAnalyser.getByteFrequencyData(musicFreqData);
    let bassTotal = 0;
    let fullTotal = 0;
    const bassBins = Math.min(8, musicFreqData.length);
    for (let i = 0; i < musicFreqData.length; i += 1) {
      const value = musicFreqData[i] / 255;
      fullTotal += value;
      if (i < bassBins) bassTotal += value;
    }
    const nextBass = bassTotal / Math.max(1, bassBins);
    const nextEnergy = fullTotal / Math.max(1, musicFreqData.length);
    musicBass += (nextBass - musicBass) * 0.24;
    musicEnergy += (nextEnergy - musicEnergy) * 0.18;
    return;
  }
  const fallback = 0.28 + Math.sin(nowSeconds * 2.2) * 0.12 + Math.sin(nowSeconds * 5.6) * 0.05;
  musicBass += (fallback - musicBass) * 0.08;
  musicEnergy += (fallback * 0.75 - musicEnergy) * 0.08;
}


function clearLayoutOverlay() {
  if (!layoutOverlayCtx || !layoutOverlayCanvas) return;
  layoutOverlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  layoutOverlayCtx.clearRect(0, 0, LAYOUT_W, LAYOUT_H);
}

















function drawActiveLayout(now) {
  lastLayoutDrawAt = performance.now();
  if (!layoutCtx) return;

  updateMusicVolume();

  if (!isLayoutVisualMode()) {
    clearLayoutOverlay();
    requestAnimationFrame(
      drawActiveLayout
    );
    return;
  }

  const time = now * 0.001;

  updateMusicEnergy(time);

  visualHue =
    (
      visualHue
      + 0.18
      + musicEnergy * 1.6
    ) % 360;

  const registry =
    window.BonecoLayoutRegistry;

  let rendered = false;

  try {
    rendered =
      registry?.render(
        now,
        {
          musicEnergy,
          musicBass,
          visualHue,
          visualPeople,
          visualMode,
          activeLayout,
        }
      ) === true;
  } catch (err) {
    console.warn(
      "layout render failed",
      activeLayout,
      err
    );
  }

  if (!rendered) {
    clearLayoutOverlay();

    layoutCtx.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );

    layoutCtx.globalCompositeOperation =
      "source-over";

    layoutCtx.fillStyle =
      "#02030a";

    layoutCtx.fillRect(
      0,
      0,
      LAYOUT_W,
      LAYOUT_H
    );
  }

  requestAnimationFrame(
    drawActiveLayout
  );
}

function randomBetween(min, max) {
  return Number(min) + Math.random() * Math.max(0, Number(max) - Number(min));
}

function randomIntInclusive(min, max) {
  return Math.round(
    randomBetween(
      Math.ceil(Number(min)),
      Math.floor(Number(max))
    )
  );
}

function gameLoop(now) {
  lastGameLoopAt = performance.now();
  maintainLiveAvatarScene();
  recoverStalledActiveVideo(now);
  updateDynamicLiveCamera(now);
  try {
    window.BonecoLayoutRegistry?.update(
      now,
      {
        musicEnergy,
        musicBass,
        visualHue,
        visualPeople,
        visualMode,
        activeLayout,
      }
    );
  } catch (err) {
    console.warn(
      "layout update failed",
      activeLayout,
      err
    );
  }
  requestAnimationFrame(gameLoop);
}

function applyCamera(next) {
  const x = Number(next?.x || 0);
  const y = Number(next?.y || 0);
  const zoom = Math.max(1, Number(next?.zoom || 1));
  world.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${zoom.toFixed(5)})`;
}

function waitVideoReady(video, timeoutMs = 1800) {
  return new Promise(resolve => {
    if (!video || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve(Boolean(video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA));
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("canplay", finish);
      resolve(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    };
    const timer = setTimeout(finish, timeoutMs);
    video.addEventListener("loadeddata", finish, { once: true });
    video.addEventListener("canplay", finish, { once: true });
  });
}

function waitForPresentedVideoFrame(video, timeoutMs = 1800) {
  return new Promise(resolve => {
    if (!video) {
      resolve(false);
      return;
    }
    let finished = false;
    let timeout = 0;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(Boolean(ok));
    };
    timeout = window.setTimeout(() => done(false), timeoutMs);

    if (typeof video.requestVideoFrameCallback === "function") {
      try {
        video.requestVideoFrameCallback(() => done(true));
        return;
      } catch (err) {
        console.warn("requestVideoFrameCallback failed", err);
      }
    }

    const onTimeUpdate = () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      done(true);
    };
    video.addEventListener("timeupdate", onTimeUpdate, { once: true });
    window.setTimeout(() => {
      if (video.readyState >= 2 && !video.paused) done(true);
    }, 120);
  });
}

function armPresentedFrameTracker(video, token) {
  if (!video || typeof video.requestVideoFrameCallback !== "function") return;
  const localToken = ++videoFrameCallbackToken;

  const watch = () => {
    if (
      localToken !== videoFrameCallbackToken ||
      token !== activeSpeechToken ||
      !speechBusy ||
      video !== activeVideo
    ) return;

    try {
      video.requestVideoFrameCallback(() => {
        if (
          localToken !== videoFrameCallbackToken ||
          token !== activeSpeechToken ||
          !speechBusy ||
          video !== activeVideo
        ) return;

        videoWatchdogState.lastPresentedFrameAt = performance.now();
        videoWatchdogState.presentedFrames += 1;
        videoWatchdogState.src = video.currentSrc || video.src || "";
        videoWatchdogState.time = Number(video.currentTime || 0);
        watch();
      });
    } catch (err) {
      console.warn("video frame tracker failed", err);
    }
  };

  watch();
}

async function switchVideo(path, options = {}) {
  if (!path) return false;
  const force = Boolean(options.force);
  if (path === currentVideo && !force) return true;
  if (path === currentVideo && force && activeVideo) {
    const token = ++videoSwitchToken;
    idleFullPlay = Boolean(options.fullPlay);
    idleFullPlayStartedAt = idleFullPlay ? performance.now() : 0;
    activeVideo.loop = Boolean(options.fullPlay) ? false : options.loop !== false;
    activeVideo.muted = options.muted !== false;
    activeVideo.volume = options.muted === false ? 1 : activeVideo.volume;
    activeVideo.playbackRate = Number(options.playbackRate || 1);
    try {
      activeVideo.currentTime = Number(options.startAt || 0);
      await activeVideo.play().catch(() => {});
    } catch (err) {
      console.warn("video restart failed", err);
    }
    return token === videoSwitchToken;
  }
  const token = ++videoSwitchToken;
  currentVideo = path;

  const previous = activeVideo;
  standbyVideo.src = fileUrl(path);
  idleFullPlay = Boolean(options.fullPlay);
  idleFullPlayStartedAt = idleFullPlay ? performance.now() : 0;
  standbyVideo.loop = Boolean(options.fullPlay) ? false : options.loop !== false;
  standbyVideo.muted = options.muted !== false;
  standbyVideo.volume = options.muted === false ? 1 : standbyVideo.volume;
  standbyVideo.preload = "auto";
  standbyVideo.playbackRate = Number(options.playbackRate || 1);
  standbyVideo.currentTime = Number(options.startAt || 0);
  standbyVideo.load();

  const ready = await waitVideoReady(standbyVideo);
  if (!ready) {
    console.warn("video not ready; keeping current layer", path);
    standbyVideo.pause();
    standbyVideo.removeAttribute("src");
    standbyVideo.load();
    return false;
  }
  await standbyVideo.play().catch(() => {});
  if (token !== videoSwitchToken) return false;

  const presented = await waitForPresentedVideoFrame(standbyVideo, 1800);
  if (!presented) {
    console.warn("video first presented frame timeout", path);
  }
  if (token !== videoSwitchToken) return false;

  standbyVideo.classList.add("active");
  await nextFrame();
  previous.classList.remove("active");
  activeVideo = standbyVideo;
  standbyVideo = previous;
  clearBellyVideoMask(standbyVideo);

  try {
    standbyVideo.pause();
    standbyVideo.currentTime = 0;
    standbyVideo.playbackRate = 1;
  } catch (err) {
    console.warn("standby cleanup failed", err);
  }
  return true;
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function fileNameFromPath(path) {
  return String(path || "").split(/[\\/]/).pop() || "";
}

function isDanceIdleVideo(path) {
  const file = fileNameFromPath(path);
  const stem = file.replace(/\.[^.]+$/, "");
  return /(^|[_\-\s])d($|[_\-\s])/i.test(stem);
}

function isManualSpeechJob(job) {
  const metadata = job?.metadata && typeof job.metadata === "object" ? job.metadata : {};
  return String(metadata.source || "").trim().toLowerCase() === "manual";
}

function speechSafeIdleMedia() {
  const idle = Array.isArray(mediaState.idle) ? mediaState.idle : [];
  return idle;
}

function manualSpeechMedia() {
  const manualIdle = Array.isArray(mediaState.manual_idle) ? mediaState.manual_idle.filter(Boolean) : [];
  return manualIdle;
}

function mediaForScene(scene) {
  if (scene === "talking") return mediaState.talking;
  if (isManualSpeechJob(activeSpeechJob) && scene === "idle") {
    return manualSpeechMedia();
  }
  if (speechBusy || activeSpeechJob) return speechSafeIdleMedia();
  return mediaState.idle;
}

function shouldHoldSpeechForIdleFullPlay() {
  if (currentScene !== "idle" || !idleFullPlay || !activeVideo || activeVideo.ended) return false;
  const durationMs = Number.isFinite(activeVideo.duration) && activeVideo.duration > 0 ? activeVideo.duration * 1000 : 0;
  const maxHoldMs = Math.max(2500, Math.min(15000, durationMs + 900));
  if (idleFullPlayStartedAt && performance.now() - idleFullPlayStartedAt > maxHoldMs) {
    idleFullPlay = false;
    idleFullPlayStartedAt = 0;
    return false;
  }
  return true;
}

async function setScene(scene, options = {}) {
  if (reactionBusy && scene !== "reaction" && !options.allowDuringReaction) {
    return false;
  }
  if (currentScene === scene && currentVideo && !options.force) return true;
  const list = mediaForScene(scene);
  const fallbackList =
    isManualSpeechJob(activeSpeechJob)
      ? (scene === "talking" ? mediaState.talking : manualSpeechMedia())
      : (
          speechBusy || activeSpeechJob || scene === "talking"
            ? speechSafeIdleMedia()
            : mediaState.idle
        );
  const path = pick(list, currentVideo) || pick(fallbackList, currentVideo);
  if (!path) return false;
  currentScene = scene;
  const fullPlay = scene === "idle" && isDanceIdleVideo(path) && !isManualSpeechJob(activeSpeechJob);
  return switchVideo(path, { ...options, loop: !fullPlay, fullPlay });
}


function rendererLayoutContext() {
  return {
    stage,
    cameraLayer,
    layoutCanvas,
    layoutOverlayCanvas,
    layoutCtx,
    layoutOverlayCtx,
    skyLayer,
    world,
    actorLayer,
    mapBack,
    mapFront,
    layoutWidth: LAYOUT_W,
    layoutHeight: LAYOUT_H,
    clearLayoutOverlay,
    drawVisualProfile,
    mediaImageUrl,
    visualImageEntry,
    isLayoutVisualMode,
    getActiveLayout: () => activeLayout,
    getVisualMode: () => visualMode,
    getVisualPeople: () => visualPeople,
    getMusicState: () => ({
      musicEnergy,
      musicBass,
      visualHue,
    }),
    getCameraState: () => ({
      currentZoom: liveCamera.currentZoom,
    }),
  };
}

function layoutCatalogFromPayload(payload) {
  const catalog =
    payload?.layout?.catalog;

  return Array.isArray(catalog)
    ? catalog
    : [];
}

function normalizeLayoutId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function layoutDefinition(payload, layoutId) {
  const cleanId =
    normalizeLayoutId(layoutId);

  if (!cleanId) return null;

  return (
    layoutCatalogFromPayload(payload)
      .find(
        item =>
          normalizeLayoutId(item?.id)
          === cleanId
      )
    || null
  );
}

function versionedStaticAsset(url) {
  const clean =
    String(url || "")
      .trim();

  if (!clean) return "";

  const version =
    encodeURIComponent(
      `${mediaCacheVersion || "dev"}-${RENDERER_ASSET_VERSION}`
    );

  return clean.includes("?")
    ? `${clean}&v=${version}`
    : `${clean}?v=${version}`;
}

function setActiveLayoutStylesheet(layoutId) {
  const active =
    normalizeLayoutId(layoutId);

  document
    .querySelectorAll("link[data-layout-css-id]")
    .forEach(link => {
      link.disabled =
        normalizeLayoutId(link.dataset.layoutCssId)
        !== active;
    });
}

function loadLayoutStylesheet(url, layoutId = "") {
  const href =
    versionedStaticAsset(url);

  if (!href) return Promise.resolve();

  const key = `css:${url}`;
  const ownerId = normalizeLayoutId(layoutId);

  if (loadedLayoutAssets.has(key)) {
    setActiveLayoutStylesheet(ownerId);
    return Promise.resolve();
  }

  if (loadingLayoutAssets.has(key)) {
    return loadingLayoutAssets.get(key);
  }

  const pending =
    new Promise((resolve, reject) => {
      const link =
        document.createElement("link");

      link.rel = "stylesheet";
      link.href = href;
      link.dataset.layoutAsset = key;
      link.dataset.layoutCssId = ownerId;
      link.disabled = ownerId !== normalizeLayoutId(activeLayout);

      link.onload = () => {
        loadedLayoutAssets.add(key);
        loadingLayoutAssets.delete(key);
        setActiveLayoutStylesheet(activeLayout);
        resolve();
      };

      link.onerror = () => {
        loadingLayoutAssets.delete(key);
        reject(
          new Error(
            `Falha ao carregar CSS do layout: ${url}`
          )
        );
      };

      document.head.appendChild(link);
    });

  loadingLayoutAssets.set(key, pending);
  return pending;
}

function loadLayoutScript(url) {
  const src =
    versionedStaticAsset(url);

  if (!src) return Promise.resolve();

  const key = `js:${url}`;

  if (loadedLayoutAssets.has(key)) {
    return Promise.resolve();
  }

  if (loadingLayoutAssets.has(key)) {
    return loadingLayoutAssets.get(key);
  }

  const pending =
    new Promise((resolve, reject) => {
      const script =
        document.createElement("script");

      script.src = src;
      script.async = false;
      script.dataset.layoutAsset = key;

      script.onload = () => {
        loadedLayoutAssets.add(key);
        loadingLayoutAssets.delete(key);
        resolve();
      };

      script.onerror = () => {
        loadingLayoutAssets.delete(key);
        reject(
          new Error(
            `Falha ao carregar JS do layout: ${url}`
          )
        );
      };

      document.body.appendChild(script);
    });

  loadingLayoutAssets.set(key, pending);
  return pending;
}

async function ensureRendererLayoutAssets(layoutId, payload) {
  const registry =
    window.BonecoLayoutRegistry;

  if (registry?.has(layoutId)) {
    return true;
  }

  const definition =
    layoutDefinition(payload, layoutId);

  if (!definition) {
    return false;
  }

  await loadLayoutStylesheet(
    definition.css,
    layoutId
  );

  await loadLayoutScript(
    definition.frontend_module
  );

  return registry?.has(layoutId) === true;
}

function resolveRendererLayout(payload) {
  const requested =
    rendererPreviewMode && rendererPreviewLayout
      ? rendererPreviewLayout
      : String(
          payload?.layout?.active_layout
          || payload?.state?.active_layout
          || "classic"
        ).trim();

  const registry = window.BonecoLayoutRegistry;

  if (registry?.has(requested)) {
    return requested;
  }

  if (layoutDefinition(payload, requested)) {
    return requested;
  }

  return "classic";
}

async function applyRendererLayout(payload) {
  const activationToken = ++layoutActivationToken;
  const nextLayout = normalizeLayoutId(resolveRendererLayout(payload));

  activeLayout = nextLayout;

  stage.dataset.layout = nextLayout;

  const registry = window.BonecoLayoutRegistry;

  if (!registry) return;

  try {
    const loaded =
      await ensureRendererLayoutAssets(
        nextLayout,
        payload
      );

    if (activationToken !== layoutActivationToken) {
      return;
    }

    if (!loaded) {
      throw new Error(
        `Layout sem módulo registrado: ${nextLayout}`
      );
    }

    setActiveLayoutStylesheet(nextLayout);

    await registry.activate(
      nextLayout,
      rendererLayoutContext()
    );

    if (activationToken !== layoutActivationToken) {
      return;
    }
  } catch (err) {
    console.warn(
      "layout activation failed",
      nextLayout,
      err
    );
  }
}

function notifyActiveLayoutState(payload) {
  const registry =
    window.BonecoLayoutRegistry;

  if (!registry) return;

  registry.onState(payload);
}

function previewEventJob(event) {
  const safeEvent =
    event && typeof event === "object"
      ? event
      : {};

  return {
    id: `preview-${safeEvent.id || safeEvent.sequence || Date.now()}`,
    actor: "main",
    text: String(safeEvent.text || ""),
    metadata: {
      source: "preview_visual",
      event: safeEvent,
    },
  };
}

function updatePreviewGiftLeaderboard(event) {
  if (!event || String(event.kind || "") !== "gift") {
    return;
  }

  const username =
    String(event.username || "teste").trim()
    || "teste";

  const displayName =
    String(
      event.display_name
      || username
    ).trim()
    || username;

  const metadata =
    event.metadata
    && typeof event.metadata === "object"
      ? event.metadata
      : {};

  const count =
    Math.max(
      1,
      Number(metadata.count || 1)
    );

  const key =
    username.toLowerCase();

  const next =
    previewGiftLeaderboard.map(
      item => ({ ...item })
    );

  let entry =
    next.find(
      item =>
        String(item.username || "")
          .toLowerCase() === key
    );

  if (!entry) {
    entry = {
      username,
      display_name: displayName,
      total_count: 0,
      count: 0,
      gift_events: 0,
      profile_image: "",
      avatar_url: "",
      updated_at: Date.now() / 1000,
    };

    next.push(entry);
  }

  entry.display_name = displayName;
  entry.total_count =
    Number(entry.total_count || 0)
    + count;

  entry.count =
    entry.total_count;

  entry.gift_events =
    Number(entry.gift_events || 0)
    + 1;

  entry.updated_at =
    Date.now() / 1000;

  next.sort(
    (a, b) =>
      Number(b.total_count || 0)
      - Number(a.total_count || 0)
  );

  previewGiftLeaderboard =
    next.slice(0, 181);
}

function refreshPreviewGiftVisuals() {
  if (
    !rendererPreviewMode
    || !previewGiftLeaderboard.length
  ) {
    return;
  }

  const leader =
    previewGiftLeaderboard[0]
    || null;

  notifyActiveLayoutState({
    gift_leaderboard: previewGiftLeaderboard,
    top_gifter: leader,
    visual_people: visualPeople,
    state: {
      active_layout: activeLayout,
      visual_mode: visualMode,
    },
  });
}

async function playPreviewVisualEvent(event) {
  if (!rendererPreviewMode) return;

  const job =
    previewEventJob(event);

  if (
    String(event?.kind || "")
    === "gift"
  ) {
    updatePreviewGiftLeaderboard(
      event
    );

    refreshPreviewGiftVisuals();
  }

  try {
    showMessageCard(job);
  } catch (err) {
    console.warn("message card failed", err);
    hideMessageCard();
  }

  await setScene(
    "talking",
    {
      force: true,
    }
  ).catch(() => false);

  if (activeVideo) {
    activeVideo.muted = true;
    activeVideo.volume = 0;
  }

  const duration =
    String(event?.kind || "")
      === "gift"
      ? 2800
      : 2300;

  await new Promise(
    resolve =>
      window.setTimeout(
        resolve,
        duration
      )
  );

  hideMessageCard();

  await setScene(
    "idle",
    {
      force: true,
    }
  ).catch(() => false);

  if (activeVideo) {
    activeVideo.muted = true;
  }
}

async function drainPreviewVisualQueue() {
  if (
    !rendererPreviewMode
    || previewVisualBusy
  ) {
    return;
  }

  previewVisualBusy = true;

  try {
    while (
      previewVisualQueue.length
    ) {
      const event =
        previewVisualQueue.shift();

      await playPreviewVisualEvent(
        event
      );
    }
  } finally {
    previewVisualBusy = false;
  }
}

async function pollPreviewEvents() {
  if (!rendererPreviewMode) return;

  try {
    const response =
      await fetch(
        `/api/renderer/preview-events?preview=1&after=${encodeURIComponent(previewEventCursor)}`,
        {
          cache: "no-store",
        }
      );

    if (!response.ok) return;

    const payload =
      await response.json();

    const events =
      Array.isArray(payload.events)
        ? payload.events
        : [];

    for (const event of events) {
      const sequence =
        Number(event?.sequence || 0);

      if (
        sequence
        > previewEventCursor
      ) {
        previewEventCursor =
          sequence;
      }

      previewVisualQueue.push(
        event
      );
    }

    const latest =
      Number(
        payload.latest_sequence
        || 0
      );

    if (
      latest
      > previewEventCursor
    ) {
      previewEventCursor =
        latest;
    }

    void drainPreviewVisualQueue();
  } catch (err) {
    console.warn(
      "preview event polling failed",
      err
    );
  }
}


async function pollState() {
  try {
    const response = await fetch("/api/renderer/state", { cache: "no-store" });
    const payload = await response.json();
    const nextMediaVersion = String(payload.media_version || "");
    if (nextMediaVersion && mediaCacheVersion && nextMediaVersion !== mediaCacheVersion) {
      currentVideo = "";
      currentScene = "";
      videoA.removeAttribute("src");
      videoB.removeAttribute("src");
      videoA.load();
      videoB.load();
    }
    if (nextMediaVersion) mediaCacheVersion = nextMediaVersion;
    mediaState = payload.media || mediaState;
    runtimeConfig = {
      ...runtimeConfig,
      ...(payload.runtime || {}),
    };
    bellyProfileScale = clampNumber(payload.state?.belly_profile_scale, 0.45, 2.0, 0.82);
    bellyProfileOffsetX = clampNumber(payload.state?.belly_profile_offset_x, -120, 120, 0);
    bellyProfileOffsetY = clampNumber(payload.state?.belly_profile_offset_y, -120, 120, 0);
    normalizeLiveCameraConfig(payload.state || {});
    await applyRendererLayout(payload);
    visualMode = "layout";
    stage.dataset.visual = visualMode;
    stage.dataset.mode = String(urlMode || payload.state?.mode || "normal");
    syncMusicTracks(payload.music || []);
    syncManualMusicTracks(payload.manual_music || []);
    syncVisualPeople(payload.visual_people || []);
    const stateGiftLeaderboard =
      rendererPreviewMode
      && previewGiftLeaderboard.length
        ? previewGiftLeaderboard
        : (
            payload.gift_leaderboard
            || []
          );

    const stateTopGifter =
      rendererPreviewMode
      && previewGiftLeaderboard.length
        ? (
            previewGiftLeaderboard[0]
            || null
          )
        : (
            payload.top_gifter
            || null
          );

    notifyActiveLayoutState({
      ...payload,
      gift_leaderboard: stateGiftLeaderboard,
      top_gifter: stateTopGifter,
      visual_people: visualPeople,
    });
    currentMap = null;
    clearMapForLayout();
    positionLayoutActor();
    if (!currentVideo) await setScene("idle");
  } catch (err) {
    console.warn("state failed", err);
  }
}


function countsForNaturalReaction(job) {
  const metadata = job?.metadata && typeof job.metadata === "object" ? job.metadata : {};
  if (metadata.counts_as_reaction_response === true) return true;
  if (String(metadata.source || "") !== "event_decision") return false;
  const event = metadata.event && typeof metadata.event === "object" ? metadata.event : {};
  const kind = String(event.kind || "").trim().toLowerCase();
  return kind === "comment" || kind === "gift";
}

function waitForVideoEnd(video, maxMs = 30000) {
  return new Promise(resolve => {
    if (!video) {
      resolve();
      return;
    }

    let done = false;
    let timer = 0;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener("ended", finish);
      video.removeEventListener("error", finish);
      resolve();
    };

    const durationMs = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(maxMs, Math.max(2500, video.duration * 1000 + 1500))
      : maxMs;

    timer = setTimeout(finish, durationMs);
    video.addEventListener("ended", finish, { once: true });
    video.addEventListener("error", finish, { once: true });
  });
}

async function maybePlayNaturalReaction(job) {
  if (!countsForNaturalReaction(job)) return false;

  answeredInteractionCount += 1;
  console.info("[reaction] resposta contabilizada", answeredInteractionCount, "/", REACTION_EVERY_RESPONSES);
  if (answeredInteractionCount < REACTION_EVERY_RESPONSES) return false;
  answeredInteractionCount = 0;

  const list = Array.isArray(mediaState.reactions) ? mediaState.reactions.filter(Boolean) : [];
  if (!list.length) return false;

  const path = pick(list, lastReactionVideo) || pick(list);
  if (!path) return false;

  reactionBusy = true;
  lastReactionVideo = path;
  hideMessageCard();

  try {
    currentScene = "reaction";
    const switched = await switchVideo(path, {
      force: true,
      loop: false,
      fullPlay: true,
      playbackRate: 1,
      startAt: 0,
      muted: false,
    });
    if (!switched) return false;

    activeVideo.muted = false;
    activeVideo.volume = 1;
    await activeVideo.play().catch(() => {});
    await waitForVideoEnd(activeVideo);

    activeVideo.muted = true;
    reactionBusy = false;
    await setScene("idle", { force: true, allowDuringReaction: true });
    return true;
  } catch (err) {
    console.warn("natural reaction failed", err);
    if (activeVideo) activeVideo.muted = true;
    await setScene("idle", { force: true }).catch(() => {});
    return false;
  } finally {
    if (activeVideo) activeVideo.muted = true;
    reactionBusy = false;
  }
}


async function pollSpeech() {
  // Preview é estritamente visual e nunca toca na fila oficial.
  if (rendererPreviewMode) return false;

  if (
    speechBusy
    && speechDeadlineAt
    && performance.now() > speechDeadlineAt
  ) {
    console.warn(
      "speech watchdog releasing stuck job",
      activeSpeechJob?.id || ""
    );

    await finishSpeechVisual(
      activeSpeechToken,
      activeSpeechJob
    );
  }

  if (
    speechFetchBusy
    && speechStartedAt
    && performance.now() - speechStartedAt > 7000
  ) {
    console.warn("speech fetch watchdog reset");
    speechFetchBusy = false;
    speechStartedAt = 0;
  }

  if (speechBusy || speechFetchBusy || reactionBusy) return false;
  if (shouldHoldSpeechForIdleFullPlay()) return false;
  speechFetchBusy = true;
  speechStartedAt = performance.now();
  let consumedJob = null;
  try {
    const payload = await fetchJsonWithTimeout(
      rendererPreviewMode
        ? "/api/renderer/next-speech?preview=1"
        : "/api/renderer/next-speech",
      { cache: "no-store" },
      4500
    );
    if (!payload.job) return false;
    consumedJob = payload.job;
    speechBusy = true;
    await playSpeechJob(consumedJob);
    return true;
  } catch (err) {
    console.warn("speech failed", err);
    if (consumedJob) {
      await acknowledgeSpeechFinished(consumedJob);
    }
    speechBusy = false;
    speechStartedAt = 0;
    speechDeadlineAt = 0;
    activeSpeechJob = null;
    hideMessageCard();
    return false;
  } finally {
    speechFetchBusy = false;
    if (!speechBusy) {
      speechStartedAt = 0;
    }
  }
}

function eventFromJob(job) {
  const event = job?.metadata?.event;
  return event && typeof event === "object" ? event : {};
}

function titleForJob(job) {
  const event = eventFromJob(job);
  return String(event.display_name || event.username || actorLabel(job.actor)).trim() || "Boneco";
}

function cardTextForJob(job) {
  const event = eventFromJob(job);
  if (event.kind === "comment" && event.text) return String(event.text);
  if (event.kind === "gift") {
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const gift = String(metadata.gift_name || event.text || "presente").trim();
    const count = Number(metadata.count || 1);
    return count > 1 ? `${count}x ${gift}` : gift;
  }
  return String(job.text || "");
}

function avatarForJob(job) {
  const event = eventFromJob(job);
  return String(
    event.profile_image ||
    event.profile_image_url ||
    event.profile_image_file ||
    event.avatar_url ||
    event.avatarUrl ||
    ""
  ).trim();
}

function actorLabel(actor) {
  return {
    main: "Boneco",
    dj: "DJ",
    oracle: "Oráculo",
    guest: "Convidado",
    user: "Usuário",
  }[actor] || "Boneco";
}

function showMessageCard(job) {
  const source = String(job?.metadata?.source || "").trim().toLowerCase();
  if (source === "manual") {
    hideMessageCard();
    return;
  }

  const event = eventFromJob(job);
  const title = titleForJob(job);
  const text = cardTextForJob(job);
  messageTitle.textContent = title;
  messageText.textContent = text;

  const avatar = avatarForJob(job);
  if (avatar) {
    avatarImage.src = mediaImageUrl(avatar);
    avatarImage.hidden = false;
    avatarLetter.hidden = true;
  } else {
    avatarImage.removeAttribute("src");
    avatarImage.hidden = true;
    avatarLetter.textContent = (title.replace(/^@/, "").trim()[0] || "B").toUpperCase();
    avatarLetter.hidden = false;
  }
  showBellyProfile(job, title, avatar);
  messageCard.hidden = false;
}

function hideMessageCard() {
  messageCard.hidden = true;
  hideBellyProfile();
}

function showBellyProfile(job, title, avatar) {
  const event = eventFromJob(job);
  const text = cardTextForJob(job);
  if (!text || !avatar) {
    hideBellyProfile();
    return;
  }
  messageCard.classList.add("belly-mode");
  bellyProfileImage.src = mediaImageUrl(avatar);
  bellyProfileImage.hidden = false;
  bellyProfileLetter.hidden = true;
  bellyProfile.hidden = true;
  bellyTrackMisses = 0;
  bellyTrackLastScan = 0;
  bellyTrackPosition = { x: 360, y: 640, size: fixedBellyProfileSize(), holeRadius: fixedBellyProfileSize() * 0.5 };
  startBellyTracking();
}

function hideBellyProfile() {
  if (bellyTrackFrame) {
    cancelAnimationFrame(bellyTrackFrame);
    bellyTrackFrame = 0;
  }
  bellyTrackMisses = 0;
  setBellyCutoutActive(false);
  messageCard.classList.remove("belly-mode");
  if (bellyProfile) bellyProfile.hidden = true;
  if (bellyProfileImage) {
    bellyProfileImage.removeAttribute("src");
    bellyProfileImage.hidden = true;
  }
  if (bellyProfileLetter) {
    bellyProfileLetter.textContent = "";
    bellyProfileLetter.hidden = true;
  }
}

function setBellyCutoutActive(active) {
  if (!actorLayer) return;
  actorLayer.classList.toggle("belly-cutout-active", Boolean(active));
  if (!active) {
    clearBellyVideoMask(videoA);
    clearBellyVideoMask(videoB);
  }
}

function applyBellyVideoMask(maskUrl) {
  if (!activeVideo || !maskUrl) return;
  const value = `url("${maskUrl}")`;
  activeVideo.style.webkitMaskImage = value;
  activeVideo.style.maskImage = value;
  activeVideo.style.webkitMaskRepeat = "no-repeat";
  activeVideo.style.maskRepeat = "no-repeat";
  activeVideo.style.webkitMaskSize = "100% 100%";
  activeVideo.style.maskSize = "100% 100%";
}

function clearBellyVideoMask(video) {
  if (!video) return;
  video.style.webkitMaskImage = "";
  video.style.maskImage = "";
  video.style.webkitMaskRepeat = "";
  video.style.maskRepeat = "";
  video.style.webkitMaskSize = "";
  video.style.maskSize = "";
}

function startBellyTracking() {
  if (!bellyProfile || !bellyTrackCtx) return;
  if (bellyTrackFrame) cancelAnimationFrame(bellyTrackFrame);
  const tick = (now) => {
    if (messageCard.hidden) {
      hideBellyProfile();
      return;
    }
    if (currentScene !== "talking") {
      bellyProfile.hidden = true;
      setBellyCutoutActive(false);
      bellyTrackFrame = requestAnimationFrame(tick);
      return;
    }
    if (!bellyTrackLastScan || now - bellyTrackLastScan >= 90) {
      bellyTrackLastScan = now;
      const detected = detectPinkBellyMarker(activeVideo);
      if (detected) {
        bellyTrackMisses = 0;
        applyBellyProfilePosition(detected, !bellyProfile.hidden);
        setBellyCutoutActive(true);
        applyBellyVideoMask(detected.maskUrl);
        bellyProfile.hidden = false;
      } else {
        bellyTrackMisses += 1;
        if (bellyTrackMisses > 5) {
          bellyProfile.hidden = true;
          setBellyCutoutActive(false);
        }
      }
    }
    bellyTrackFrame = requestAnimationFrame(tick);
  };
  bellyTrackFrame = requestAnimationFrame(tick);
}

function applyBellyProfilePosition(position, smooth = true) {
  const weight = smooth ? 0.34 : 1;
  const fixedSize = fixedBellyProfileSize();
  const targetHoleRadius = Math.max(fixedSize * 0.52, Number(position.holeRadius || 0));
  bellyTrackPosition = {
    x: bellyTrackPosition.x + (position.x - bellyTrackPosition.x) * weight,
    y: bellyTrackPosition.y + (position.y - bellyTrackPosition.y) * weight,
    size: fixedSize,
    holeRadius: bellyTrackPosition.holeRadius + (targetHoleRadius - bellyTrackPosition.holeRadius) * weight,
  };
  bellyProfile.style.setProperty("--belly-x", `${bellyTrackPosition.x.toFixed(1)}px`);
  bellyProfile.style.setProperty("--belly-y", `${bellyTrackPosition.y.toFixed(1)}px`);
  bellyProfile.style.setProperty("--belly-size", `${bellyTrackPosition.size.toFixed(1)}px`);
  actorLayer.style.setProperty("--belly-x", `${bellyTrackPosition.x.toFixed(1)}px`);
  actorLayer.style.setProperty("--belly-y", `${bellyTrackPosition.y.toFixed(1)}px`);
  actorLayer.style.setProperty("--belly-size", `${bellyTrackPosition.size.toFixed(1)}px`);
  actorLayer.style.setProperty("--belly-hole-radius", `${(bellyTrackPosition.holeRadius + 3).toFixed(1)}px`);
}

function fixedBellyProfileSize() {
  return Math.max(30, Math.min(118, BELLY_PROFILE_BASE_SIZE * bellyProfileScale));
}

function detectPinkBellyMarker(video) {
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight || !bellyMaskCtx) return null;
  const width = bellyTrackCanvas.width;
  const height = bellyTrackCanvas.height;
  try {
    bellyTrackCtx.clearRect(0, 0, width, height);
    drawVideoCoverToCanvas(video, bellyTrackCtx, width, height);
    const frame = bellyTrackCtx.getImageData(0, 0, width, height).data;
    const pinkPixels = new Uint8Array(width * height);
    const minX = Math.floor(width * 0.34);
    const maxX = Math.ceil(width * 0.66);
    const minY = Math.floor(height * 0.38);
    const maxY = Math.ceil(height * 0.74);
    let weightSum = 0;
    let sumX = 0;
    let sumY = 0;
    let hitCount = 0;
    let hitMinX = maxX;
    let hitMaxX = minX;
    let hitMinY = maxY;
    let hitMaxY = minY;
    for (let y = minY; y < maxY; y += 1) {
      for (let x = minX; x < maxX; x += 1) {
        const offset = (y * width + x) * 4;
        const r = frame[offset];
        const g = frame[offset + 1];
        const b = frame[offset + 2];
        if (r < 170 || b < 85 || g > 135) continue;
        if (r - g < 62 || b - g < 20) continue;
        pinkPixels[y * width + x] = 1;
        const weight = Math.max(1, (r - g) + (b - g) * 0.55);
        weightSum += weight;
        sumX += x * weight;
        sumY += y * weight;
        hitCount += 1;
        if (x < hitMinX) hitMinX = x;
        if (x > hitMaxX) hitMaxX = x;
        if (y < hitMinY) hitMinY = y;
        if (y > hitMaxY) hitMaxY = y;
      }
    }
    if (hitCount < 9 || weightSum <= 0) return null;
    const centerX = (sumX / weightSum / width) * STAGE_WIDTH;
    const centerY = (sumY / weightSum / height) * STAGE_HEIGHT;
    const markerW = ((hitMaxX - hitMinX + 1) / width) * STAGE_WIDTH;
    const markerH = ((hitMaxY - hitMinY + 1) / height) * STAGE_HEIGHT;
    const markerDiameter = Math.max(markerW, markerH);
    const maskUrl = buildPinkCutoutMaskUrl(pinkPixels, width, height, minX, maxX, minY, maxY);
    return {
      x: Math.max(80, Math.min(STAGE_WIDTH - 80, centerX + bellyProfileOffsetX)),
      y: Math.max(180, Math.min(STAGE_HEIGHT - 120, centerY + bellyProfileOffsetY)),
      holeRadius: Math.max(18, Math.min(96, markerDiameter * 0.62)),
      maskUrl,
    };
  } catch (err) {
    return null;
  }
}

function buildPinkCutoutMaskUrl(pinkPixels, width, height, minX, maxX, minY, maxY) {
  const mask = bellyMaskCtx.createImageData(width, height);
  const data = mask.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  const dilate = 2;
  for (let y = Math.max(0, minY - dilate); y < Math.min(height, maxY + dilate); y += 1) {
    for (let x = Math.max(0, minX - dilate); x < Math.min(width, maxX + dilate); x += 1) {
      let remove = false;
      for (let oy = -dilate; oy <= dilate && !remove; oy += 1) {
        const yy = y + oy;
        if (yy < 0 || yy >= height) continue;
        for (let ox = -dilate; ox <= dilate; ox += 1) {
          const xx = x + ox;
          if (xx < 0 || xx >= width) continue;
          if (pinkPixels[yy * width + xx]) {
            remove = true;
            break;
          }
        }
      }
      if (remove) data[(y * width + x) * 4 + 3] = 0;
    }
  }
  bellyMaskCtx.putImageData(mask, 0, 0);
  return bellyMaskCanvas.toDataURL("image/png");
}

function drawVideoCoverToCanvas(video, ctx, width, height) {
  const videoW = Number(video.videoWidth || width);
  const videoH = Number(video.videoHeight || height);
  const destRatio = width / height;
  const videoRatio = videoW / videoH;
  let sx = 0;
  let sy = 0;
  let sw = videoW;
  let sh = videoH;
  if (videoRatio > destRatio) {
    sw = videoH * destRatio;
    sx = (videoW - sw) * 0.5;
  } else if (videoRatio < destRatio) {
    sh = videoW / destRatio;
    sy = (videoH - sh) * 0.5;
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
}

function stopTimeline() {
  if (timelineFrame) {
    cancelAnimationFrame(timelineFrame);
    timelineFrame = 0;
  }
  if (timelineFinishTimer) {
    clearTimeout(timelineFinishTimer);
    timelineFinishTimer = 0;
  }
  stopVideoWatchdog();
  setVideoRate(1);
}

function setVideoRate(rate) {
  const value = Number(rate || 1);
  if (sceneAudio) sceneAudio.playbackRate = 1;
  if (musicAudio) musicAudio.playbackRate = 1;
  if (activeVideo && currentScene === "talking") activeVideo.playbackRate = value;
}

async function recoverTalkingVideo(token, reason = "stall") {
  if (videoRecoveryBusy || token !== activeSpeechToken || !speechBusy || currentScene !== "talking") return;
  videoRecoveryBusy = true;
  try {
    console.warn(`speech video watchdog switching talking video after ${reason}`);
    await setScene("talking", { force: true, startAt: 0, loop: true });
    setVideoRate(1);
    videoWatchdogState = {
      src: activeVideo?.currentSrc || activeVideo?.src || "",
      time: Number(activeVideo?.currentTime || 0),
      wallAt: performance.now(),
    };
  } catch (err) {
    console.warn("speech video watchdog switch failed", err);
  } finally {
    videoRecoveryBusy = false;
  }
}

function startVideoWatchdog(token) {
  stopVideoWatchdog();

  const now = performance.now();
  videoWatchdogState = {
    src: activeVideo?.currentSrc || activeVideo?.src || "",
    time: Number(activeVideo?.currentTime || 0),
    wallAt: now,
    lastPresentedFrameAt: now,
    presentedFrames: 0,
    callbackVideo: activeVideo || null,
  };

  armPresentedFrameTracker(activeVideo, token);

  const tick = () => {
    if (token !== activeSpeechToken || !speechBusy) {
      videoWatchdogFrame = 0;
      return;
    }

    const video = activeVideo;
    if (video && currentScene === "talking") {
      if (videoWatchdogState.callbackVideo !== video) {
        videoWatchdogState.callbackVideo = video;
        videoWatchdogState.lastPresentedFrameAt = performance.now();
        videoWatchdogState.presentedFrames = 0;
        armPresentedFrameTracker(video, token);
      }

      if (video.ended && video.loop !== false) {
        try {
          video.currentTime = 0;
        } catch (err) {
          console.warn("speech video rewind failed", err);
        }
        video.play().catch(() => {});
        videoWatchdogState.lastPresentedFrameAt = performance.now();
      } else if (video.paused) {
        video.play().catch(() => {});
      }

      const playbackRate = Number(video.playbackRate || 1);

      if (playbackRate < 0.9) {
        videoWatchdogState.lastPresentedFrameAt = performance.now();
        videoWatchdogState.src = video.currentSrc || video.src || "";
        videoWatchdogState.time = Number(video.currentTime || 0);
        videoWatchdogFrame = requestAnimationFrame(tick);
        return;
      }

      const lastFrameAt = Number(videoWatchdogState.lastPresentedFrameAt || 0);
      const stalledFor = lastFrameAt > 0 ? performance.now() - lastFrameAt : 0;

      if (stalledFor > STALLED_VIDEO_RELOAD_MS) {
        console.error("speech video stalled for too long; reloading renderer");
        window.location.reload();
        return;
      }

      if (stalledFor > STALLED_VIDEO_SWITCH_MS) {
        recoverTalkingVideo(token, "no-presented-frame").catch(console.warn);
        videoWatchdogState.lastPresentedFrameAt = performance.now();
      } else if (stalledFor > STALLED_VIDEO_PLAY_RETRY_MS) {
        console.warn("speech video watchdog retrying play()");
        video.play().catch(() => {});
      }
    }

    videoWatchdogFrame = requestAnimationFrame(tick);
  };

  videoWatchdogFrame = requestAnimationFrame(tick);
}

function stopVideoWatchdog() {
  videoFrameCallbackToken += 1;
  if (videoWatchdogFrame) {
    cancelAnimationFrame(videoWatchdogFrame);
    videoWatchdogFrame = 0;
  }
}

function sceneNeedsContinuousVideo(scene) {
  const value = String(scene || "");
  if (!value) return false;
  if (value === "idle" || value === "reaction") return true;
  return false;
}

function restartContinuousScene(scene) {
  const value = String(scene || "");
  if (value === "reaction") return setScene("idle", { force: true });
  if (value === "idle") return setScene("idle", { force: true, loop: true });
  return setScene(value, { force: true, loop: true });
}

function recoverStalledActiveVideo(now) {
  if (!activeVideo || speechBusy) return;
  if (!sceneNeedsContinuousVideo(currentScene)) {
    generalVideoWatchdogState.src = "";
    generalVideoWatchdogState.time = 0;
    generalVideoWatchdogState.wallAt = 0;
    return;
  }

  const video = activeVideo;
  const src = video.currentSrc || video.src || currentVideo || "";
  if (!src) return;

  const currentTime = Number(video.currentTime || 0);
  const state = generalVideoWatchdogState;
  if (state.src !== src) {
    state.src = src;
    state.time = currentTime;
    state.wallAt = now;
    state.retryAt = 0;
    state.recovering = false;
    return;
  }

  const advanced = Math.abs(currentTime - Number(state.time || 0)) > 0.025;
  if (!video.paused && !video.ended && advanced) {
    state.time = currentTime;
    state.wallAt = now;
    return;
  }

  const stalledFor = Math.max(0, now - Number(state.wallAt || now));

  if (!video.ended && now - Number(state.retryAt || 0) >= GENERAL_VIDEO_PLAY_RETRY_MS) {
    state.retryAt = now;
    video.play().catch(() => {});
  }

  if (stalledFor >= GENERAL_VIDEO_RESTART_MS && !state.recovering) {
    state.recovering = true;
    console.warn(
      "general video watchdog restarting scene",
      currentScene,
      src
    );
    restartContinuousScene(currentScene)
      .catch(err => console.warn("general video watchdog failed", err))
      .finally(() => {
        state.time = Number(activeVideo?.currentTime || 0);
        state.wallAt = performance.now();
        state.retryAt = 0;
        state.recovering = false;
      });
  }

  if (stalledFor >= GENERAL_VIDEO_RELOAD_MS) {
    console.error("general video watchdog reloading renderer after stalled video");
    window.location.reload();
  }
}

function timelineSegmentAt(segments, seconds) {
  return segments.find(item => {
    const start = Number(item.start || 0);
    const end = Number(item.end || 0);
    return seconds >= start && seconds < end;
  });
}

function normalizeTimelineSegments(timeline) {
  const source = Array.isArray(timeline?.segments) ? timeline.segments : Array.isArray(timeline) ? timeline : [];
  return source
    .map(item => {
      const start = Number(item?.start || 0);
      const rawEnd = Number(item?.end || 0);
      const duration = Number(item?.duration || 0);
      const end = rawEnd > start ? rawEnd : start + Math.max(0, duration);
      return {
        kind: String(item?.kind || ""),
        start,
        end,
        duration: Math.max(0, end - start),
      };
    })
    .filter(item => item.end > item.start);
}

function normalizeTimelinePayload(timeline) {
  const segments = normalizeTimelineSegments(timeline);
  const timelineEnd = Number(timeline?.timeline_end || 0) || lastSegmentEnd(segments);
  const speechEnd = Number(timeline?.speech_end || 0) || lastSpeechEnd(segments) || timelineEnd;
  const trailingMuteAt = Number(timeline?.trailing_mute_at || 0) || computeTrailingMuteAt(segments, speechEnd, timelineEnd);
  return { segments, timelineEnd, speechEnd, trailingMuteAt };
}

async function timelineForJob(job) {
  const embedded = job.timeline || job.metadata?.timeline || job.audio_timeline || job.metadata?.audio_timeline;
  if (normalizeTimelineSegments(embedded).length) return embedded;
  const timelinePath = String(job.timeline_path || job.metadata?.timeline_path || "").trim();
  if (!timelinePath) return [];
  try {
    const response = await fetch(fileUrl(timelinePath), { cache: "no-store" });
    if (!response.ok) return [];
    return await response.json();
  } catch (err) {
    console.warn("timeline json failed", err);
    return [];
  }
}

function manualMusicPathForJob(job) {
  const metadata =
    job?.metadata && typeof job.metadata === "object"
      ? job.metadata
      : {};
  if (String(metadata.source || "").trim().toLowerCase() !== "manual") {
    return "";
  }
  return String(metadata.manual_music_path || "").trim();
}

function startManualSpeechMusic(job) {
  const track = manualMusicPathForJob(job);
  if (!track || !musicAudio) return;

  const metadata =
    job?.metadata && typeof job.metadata === "object"
      ? job.metadata
      : {};
  const sequenceIndex = Number(metadata.manual_sequence_index || 0);

  if (!manualSpeechMusicActive) {
    manualSpeechMusicPrevious = musicTracks.includes(musicCurrent)
      ? musicCurrent
      : "";
  }

  manualSpeechMusicActive = true;
  manualSpeechMusicTrack = track;
  playMusicTrack(track, {
    loop: true,
    restart: sequenceIndex <= 0 || musicCurrent !== track,
  });
}

function finishManualSpeechMusic(job) {
  const metadata =
    job?.metadata && typeof job.metadata === "object"
      ? job.metadata
      : {};

  if (
    String(metadata.source || "").trim().toLowerCase() !== "manual"
    || !manualSpeechMusicActive
  ) {
    return;
  }

  if (metadata.manual_sequence_last !== true) {
    return;
  }

  manualSpeechMusicActive = false;
  manualSpeechMusicTrack = "";

  const restore = musicTracks.includes(manualSpeechMusicPrevious)
    ? manualSpeechMusicPrevious
    : "";
  manualSpeechMusicPrevious = "";

  if (restore) {
    playMusicTrack(restore, {
      loop: musicTracks.length < 2,
      restart: musicCurrent !== restore,
    });
    return;
  }

  if (musicTracks.length) {
    playNextMusic(true);
  } else if (musicAudio) {
    musicAudio.pause();
    musicCurrent = "";
  }
}

function shouldSlowTimelineSegment(segment) {
  if (!segment) return false;
  if (segment.kind === "micro_pause") return true;
  const microLimit = runtimeNumber("micro_pause_freeze_max", DEFAULT_MICRO_PAUSE_MAX);
  const duration = Number(segment.duration || 0);
  return segment.kind === "pause" && duration <= Math.max(SHORT_PAUSE_LIMIT, microLimit) + 0.015;
}

function shouldMuteTimelineSegment(segment) {
  if (!segment) return false;
  const pauseToMute = runtimeNumber("pause_to_mute_min", DEFAULT_PAUSE_TO_MUTE_MIN);
  return segment.kind === "pause" && Number(segment.duration || 0) >= pauseToMute;
}

function runtimeNumber(key, fallback) {
  const value = Number(runtimeConfig?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(
      url,
      {
        ...options,
        signal: controller.signal,
      }
    );

    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

function rendererHeartbeat() {
  const now = performance.now();
  const activeDuration =
    Number.isFinite(activeVideo?.duration)
      ? Number(activeVideo.duration || 0)
      : 0;
  const lastPresentedAt =
    Number(videoWatchdogState?.lastPresentedFrameAt || 0);

  const payload = {
    preview: rendererPreviewMode,
    active_layout: activeLayout,
    visual_mode: visualMode,
    current_scene: currentScene,
    speech_busy: speechBusy,
    speech_fetch_busy: speechFetchBusy,
    reaction_busy: reactionBusy,
    active_speech_job_id: activeSpeechJob?.id || "",
    speech_age_ms:
      speechStartedAt
        ? Math.max(0, now - speechStartedAt)
        : 0,
    speech_deadline_ms:
      speechDeadlineAt
        ? Math.max(0, speechDeadlineAt - now)
        : 0,
    game_loop_age_ms:
      lastGameLoopAt
        ? Math.max(0, now - lastGameLoopAt)
        : 0,
    layout_draw_age_ms:
      lastLayoutDrawAt
        ? Math.max(0, now - lastLayoutDrawAt)
        : 0,
    active_video_paused: Boolean(activeVideo?.paused),
    active_video_ended: Boolean(activeVideo?.ended),
    active_video_ready_state: Number(activeVideo?.readyState || 0),
    active_video_current_time: Number(activeVideo?.currentTime || 0),
    active_video_duration: activeDuration,
    idle_full_play: Boolean(idleFullPlay),
    idle_full_play_age_ms:
      idleFullPlayStartedAt
        ? Math.max(0, now - idleFullPlayStartedAt)
        : 0,
    current_video: currentVideo || activeVideo?.currentSrc || activeVideo?.src || "",
    video_watchdog_presented_frames: Number(videoWatchdogState?.presentedFrames || 0),
    video_watchdog_age_ms:
      lastPresentedAt
        ? Math.max(0, now - lastPresentedAt)
        : 0,
    general_video_watchdog_recovering: Boolean(generalVideoWatchdogState.recovering),
    general_video_watchdog_age_ms:
      generalVideoWatchdogState.wallAt
        ? Math.max(0, now - Number(generalVideoWatchdogState.wallAt || 0))
        : 0,
    location: window.location.href,
  };

  fetch(
    "/api/renderer/heartbeat",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    }
  ).catch(() => {});
}

function lastSegmentEnd(segments) {
  let end = 0;
  for (const segment of segments) end = Math.max(end, Number(segment.end || 0));
  return end;
}

function lastSpeechEnd(segments) {
  let end = 0;
  for (const segment of segments) {
    if (segment.kind === "speech") end = Math.max(end, Number(segment.end || 0));
  }
  return end;
}

function hasTrailingPause(segments, speechEnd) {
  if (!speechEnd) return false;
  return segments.some(segment => segment.kind !== "speech" && Number(segment.start || 0) >= speechEnd - 0.01);
}

function computeTrailingMuteAt(segments, speechEnd, timelineEnd) {
  let lastSpeechIndex = -1;
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index].kind === "speech") lastSpeechIndex = index;
  }
  if (lastSpeechIndex < 0) return timelineEnd;
  const next = segments[lastSpeechIndex + 1];
  if (next) return Math.max(0, Number(next.start || 0));
  return speechEnd || timelineEnd;
}

function startLipSync(timeline, audio = sceneAudio, token = activeSpeechToken) {
  stopTimeline();
  const payload = normalizeTimelinePayload(timeline);
  const segments = payload.segments;
  if (!segments.length) return;
  let visualMuted = false;
  startVideoWatchdog(token);
  const tick = () => {
    if (audio.ended) {
      setVideoRate(1);
      return;
    }
    if (audio.paused) {
      timelineFrame = requestAnimationFrame(tick);
      return;
    }
    const elapsed = audio.currentTime || 0;
    const segment = timelineSegmentAt(segments, elapsed);
    const muteAdvance = runtimeNumber("mute_switch_advance", DEFAULT_MUTE_SWITCH_ADVANCE);
    const muteAt = payload.trailingMuteAt || payload.speechEnd || 0;
    if (segment && segment.kind === "speech") {
      visualMuted = false;
      if (currentScene !== "talking") {
        setScene("talking").catch(console.warn);
      }
      setVideoRate(1);
    } else if (!visualMuted && muteAt > 0 && hasTrailingPause(segments, payload.speechEnd) && elapsed >= Math.max(0, muteAt - muteAdvance)) {
      visualMuted = true;
      setVideoRate(1);
      setScene("idle").catch(console.warn);
    } else if (!visualMuted && shouldMuteTimelineSegment(segment)) {
      visualMuted = true;
      setVideoRate(1);
      setScene("idle").catch(console.warn);
    } else if (!visualMuted) {
      const pauseRate = Math.max(
        0.10,
        Math.min(1, runtimeNumber("micro_pause_rate", MICRO_PAUSE_RATE))
      );
      setVideoRate(shouldSlowTimelineSegment(segment) ? pauseRate : 1);
    }
    timelineFrame = requestAnimationFrame(tick);
  };
  timelineFrame = requestAnimationFrame(tick);
}

async function acknowledgeSpeechFinished(job) {
  // Preview não confirma nem avança sequência oficial.
  if (rendererPreviewMode) return true;

  const metadata =
    job?.metadata && typeof job.metadata === "object"
      ? job.metadata
      : {};

  const sequenceId = String(
    metadata.manual_sequence_id || ""
  ).trim();

  const payload = {
    job_id: String(job?.id || ""),
    manual_sequence_id: sequenceId,
    manual_sequence_index: Number(
      metadata.manual_sequence_index
    ),
    audio_path: String(job?.audio_path || ""),
    timeline_path: String(
      job?.timeline_path
      || metadata.timeline_path
      || ""
    ),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(
        rendererPreviewMode
          ? "/api/renderer/speech-finished?preview=1"
          : "/api/renderer/speech-finished",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          cache: "no-store",
        }
      );

      if (response.ok) return true;
    } catch (err) {
      console.warn("speech finished ack failed", err);
    }

    await new Promise(resolve =>
      window.setTimeout(resolve, 120 * (attempt + 1))
    );
  }

  console.warn(
    "speech finished ack exhausted retries",
    payload
  );

  return false;
}


async function playSpeechJob(job) {
  const token = ++activeSpeechToken;
  const timeline = await timelineForJob(job);
  const audioPath = String(job.audio_path || "");
  const timelinePayload =
    normalizeTimelinePayload(timeline);

  const fallbackMs = Math.max(
    1600,
    Math.min(
      8500,
      String(job.text || "").length * 58
    )
  );

  const expectedMs = Math.max(
    fallbackMs,
    Math.min(
      SPEECH_STUCK_TIMEOUT_MS,
      Math.ceil(
        Number(timelinePayload.timelineEnd || 0)
        * 1000
      )
      + 2500
    )
  );

  stopTimeline();
  activeSpeechJob = job;
  speechStartedAt = performance.now();
  speechDeadlineAt =
    speechStartedAt
    + Math.max(
        3500,
        Math.min(
          SPEECH_STUCK_TIMEOUT_MS,
          expectedMs
        )
      );

  showMessageCard(job);
  startManualSpeechMusic(job);
  sceneAudio.pause();
  sceneAudio.removeAttribute("src");
  sceneAudio.load();

  const talkingReady = await setScene("talking", { force: true, startAt: 0 });
  if (!talkingReady) {
    console.warn("talking scene not ready before speech audio");
  }

  if (!audioPath) {
    window.setTimeout(
      () => finishSpeechVisual(token, job),
      fallbackMs
    );
    return;
  }

  sceneAudio.src = fileUrl(audioPath);
  sceneAudio.currentTime = 0;
  sceneAudio.playbackRate = 1;
  sceneAudio.volume = 1;
  sceneAudio.muted = false;

  const finishOnce = () => finishSpeechVisual(token, job);
  sceneAudio.addEventListener("ended", finishOnce, { once: true });
  sceneAudio.addEventListener("error", finishOnce, { once: true });
  startLipSync(timelinePayload, sceneAudio, token);
  await sceneAudio.play().catch(() => {
    audioUnlock.hidden = false;
    stopTimeline();
    window.setTimeout(() => finishSpeechVisual(token, job), fallbackMs);
  });
}

async function finishSpeechVisual(token = activeSpeechToken, job = null) {
  if (token !== activeSpeechToken) return;
  stopTimeline();
  sceneAudio.pause();
  sceneAudio.removeAttribute("src");
  sceneAudio.load();
  hideMessageCard();
  if (token !== activeSpeechToken) return;

  if (job) {
    await acknowledgeSpeechFinished(job);
  }

  if (token !== activeSpeechToken) return;

  speechBusy = false;
  speechStartedAt = 0;
  speechDeadlineAt = 0;
  activeSpeechJob = null;
  finishManualSpeechMusic(job);
  onSpeechCompletedForCamera();
  await maybePlayNaturalReaction(job);
  const startedNext = await pollSpeech();
  if (!startedNext && token === activeSpeechToken) {
    await setScene("idle").catch(console.warn);
  }
}

pollState();
stage.dataset.visual = visualMode;
stage.dataset.layout = activeLayout;
rendererHeartbeat();
requestAnimationFrame(gameLoop);
requestAnimationFrame(drawActiveLayout);
setInterval(pollState, 900);
setInterval(pollSpeech, 350);
setInterval(rendererHeartbeat, 2000);

if (rendererPreviewMode) {
  pollPreviewEvents();
  setInterval(
    pollPreviewEvents,
    350
  );
}
