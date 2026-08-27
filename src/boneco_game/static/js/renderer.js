const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 1280;
const MICRO_PAUSE_RATE = 0.58;
const SHORT_PAUSE_LIMIT = 0.35;
const DEFAULT_MICRO_PAUSE_MAX = 0.35;
const DEFAULT_PAUSE_TO_MUTE_MIN = 2.0;
const DEFAULT_MUTE_SWITCH_ADVANCE = 0.025;
const STALLED_VIDEO_NUDGE_MS = 650;
const STALLED_VIDEO_SWITCH_MS = 1300;
const WALK_START_MS = 1550;
const WALK_STOP_MS = 6800;
const WALK_TRANSITION_TIME_SCALE = 2.25;
const WALK_TRANSITION_PLAYBACK_RATE = 1;
const DEFAULT_CAMERA_SPEED = 3.25;
const DEFAULT_RUN_DIRECTION = "right";
const MUSIC_IDLE_VOLUME = 0.16;
const MUSIC_SPEECH_VOLUME = 0.055;
const TUNNEL_W = 360;
const TUNNEL_H = 640;
const BELLY_PROFILE_BASE_SIZE = 92;

const stage = document.getElementById("stage");
const tunnelCanvas = document.getElementById("tunnelCanvas");
const tunnelCtx = tunnelCanvas ? tunnelCanvas.getContext("2d", { alpha: false }) : null;
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
const urlMode = new URLSearchParams(window.location.search).get("mode") || "";

let activeVideo = videoA;
let standbyVideo = videoB;
let currentVideo = "";
let currentScene = "";
let currentMap = null;
let visualMode = "tunnel";
let mapSignature = "";
let mapRuntimeKey = "";
let skyRuntimeKey = "";
let mapEntries = [];
let musicTracks = [];
let musicCurrent = "";
let musicAudioContext = null;
let musicAnalyser = null;
let musicFreqData = null;
let musicEnergy = 0;
let musicBass = 0;
let tunnelHue = 144;
let tunnelPeople = [];
let tunnelPeopleSignature = "";
const tunnelImageCache = new Map();
let mediaState = {
  idle: [],
  talking: [],
  walk_right: [],
  walk_left: [],
  walk_start_right: [],
  walk_loop_right: [],
  walk_stop_right: [],
  walk_start_left: [],
  walk_loop_left: [],
  walk_stop_left: [],
};
let walkMotion = {
  start: 1.7,
  accel_end: 3.0,
  loop_start: 3.25,
  loop_end: 7.8,
  decel_start: 8.4,
  stop_end: 14.6,
};
let mediaCacheVersion = "";
let activeSpeechToken = 0;
let speechBusy = false;
let speechFetchBusy = false;
let runtimeConfig = {
  micro_pause_freeze_max: DEFAULT_MICRO_PAUSE_MAX,
  pause_to_mute_min: DEFAULT_PAUSE_TO_MUTE_MIN,
  mute_switch_advance: DEFAULT_MUTE_SWITCH_ADVANCE,
};
let timelineFrame = 0;
let timelineFinishTimer = 0;
let videoWatchdogFrame = 0;
let videoWatchdogState = { src: "", time: 0, wallAt: 0 };
let videoRecoveryBusy = false;
let bellyTrackFrame = 0;
let bellyTrackLastScan = 0;
let bellyTrackMisses = 0;
let bellyProfileScale = 0.82;
let bellyProfileOffsetX = 0;
let bellyProfileOffsetY = 0;
let videoSwitchToken = 0;
let idleFullPlay = false;
let idleFullPlayStartedAt = 0;
let walk = {
  actorX: 640,
  targetX: null,
  direction: "right",
  directionCyclesLeft: 0,
  phase: "idle",
  phaseStartedAt: 0,
  loopStartedAt: 0,
  phaseUntil: 0,
  pauseUntil: 0,
  lastTs: 0,
  speed: 112,
};
let sceneCamera = {
  currentViewportScale: 1,
  targetViewportScale: 1,
  wideUntil: 0,
  nextDecisionAt: 0,
  lastStartScale: 0,
  lastStopScale: 0,
  activeShotKind: "",
};
const bellyTrackCanvas = document.createElement("canvas");
bellyTrackCanvas.width = 144;
bellyTrackCanvas.height = 256;
const bellyTrackCtx = bellyTrackCanvas.getContext("2d", { willReadFrequently: true });
const bellyMaskCanvas = document.createElement("canvas");
bellyMaskCanvas.width = bellyTrackCanvas.width;
bellyMaskCanvas.height = bellyTrackCanvas.height;
const bellyMaskCtx = bellyMaskCanvas.getContext("2d", { willReadFrequently: true });
let bellyTrackPosition = { x: 360, y: 640, size: 92, holeRadius: 46 };

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

function syncTunnelPeople(people) {
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
  if (signature === tunnelPeopleSignature) return;
  tunnelPeopleSignature = signature;
  tunnelPeople = next;
  for (const person of tunnelPeople) preloadTunnelImage(person.profile);
}

function preloadTunnelImage(path) {
  const url = mediaImageUrl(path);
  if (!url || tunnelImageCache.has(url)) return null;
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
  tunnelImageCache.set(url, entry);
  return entry;
}

function tunnelImageEntry(path) {
  const url = mediaImageUrl(path);
  if (!url) return null;
  const entry = tunnelImageCache.get(url) || preloadTunnelImage(path);
  if (!entry || entry.failed) return null;
  if (entry.loaded || (entry.img.complete && entry.img.naturalWidth > 0)) {
    entry.loaded = true;
    return entry;
  }
  return null;
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

function isTunnelMode() {
  return visualMode !== "map";
}

function clearMapForTunnel() {
  if (!mapEntries.length && mapSignature === "__tunnel__") return;
  mapEntries = [];
  mapSignature = "__tunnel__";
  mapBack.replaceChildren();
  mapFront.replaceChildren();
}

function positionTunnelActor() {
  if (world) world.style.transform = "none";
  actorLayer.style.setProperty("--actor-x", "0px");
  actorLayer.style.setProperty("--actor-y", "0px");
  actorLayer.style.setProperty("--actor-scale", "1");
}

function syncMusicTracks(tracks) {
  const next = (Array.isArray(tracks) ? tracks : []).map(String).filter(Boolean);
  if (sameStringList(next, musicTracks)) return;
  musicTracks = next;
  if (!musicTracks.length) {
    if (musicAudio) musicAudio.pause();
    musicCurrent = "";
    return;
  }
  if (!musicTracks.includes(musicCurrent)) {
    playNextMusic(true);
  }
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
  if (!musicAudio || !musicTracks.length) return;
  const next = pick(musicTracks, force ? "" : musicCurrent);
  if (!next) return;
  if (next !== musicCurrent) {
    musicCurrent = next;
    musicAudio.src = fileUrl(next);
    musicAudio.currentTime = 0;
  }
  musicAudio.loop = musicTracks.length < 2;
  musicAudio.playbackRate = 1;
  musicAudio.volume = speechBusy ? MUSIC_SPEECH_VOLUME : MUSIC_IDLE_VOLUME;
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
  if (!musicAudio || !musicTracks.length) return;
  if (musicAudio.paused) {
    playNextMusic(false);
    return;
  }
  const target = speechBusy ? MUSIC_SPEECH_VOLUME : MUSIC_IDLE_VOLUME;
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

function drawCornerSaber(ctx, outer, center, hue, power, time, phase) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.strokeStyle = `hsla(${hue}, 100%, 52%, ${0.26 + power * 0.18})`;
  ctx.lineWidth = 31 + power * 12;
  ctx.beginPath();
  ctx.moveTo(outer.x, outer.y);
  ctx.lineTo(center.x, center.y);
  ctx.stroke();
  ctx.strokeStyle = `hsla(${hue + 14}, 100%, 68%, ${0.74 + power * 0.16})`;
  ctx.lineWidth = 13 + power * 5;
  ctx.beginPath();
  ctx.moveTo(outer.x, outer.y);
  ctx.lineTo(center.x, center.y);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${0.76 + power * 0.18})`;
  ctx.lineWidth = 3 + power * 2;
  ctx.beginPath();
  ctx.moveTo(outer.x, outer.y);
  ctx.lineTo(center.x, center.y);
  ctx.stroke();

  const dx = center.x - outer.x;
  const dy = center.y - outer.y;
  for (let i = 0; i < 4; i += 1) {
    const t = (time * (0.42 + power * 0.55) + phase + i * 0.25) % 1;
    const start = Math.max(0, t - 0.055);
    const end = Math.min(1, t + 0.055);
    const x1 = outer.x + dx * start;
    const y1 = outer.y + dy * start;
    const x2 = outer.x + dx * end;
    const y2 = outer.y + dy * end;
    ctx.strokeStyle = `rgba(255,255,255,${0.42 + power * 0.34})`;
    ctx.lineWidth = 8 + power * 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = `hsla(${hue + 25}, 100%, 76%, ${0.34 + power * 0.26})`;
    ctx.beginPath();
    ctx.arc(x2, y2, 5 + power * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function tunnelRingPoint(anchor, center, scale, wobble) {
  return {
    x: center.x + (anchor.x - center.x) * scale + wobble.x,
    y: center.y + (anchor.y - center.y) * scale + wobble.y,
  };
}

function rotateAround(point, center, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function drawTunnelRing(ctx, anchors, center, scale, hue, alpha, width, time, index) {
  const wobbleAmp = 0.8 + scale * 1.25;
  const points = anchors.map((anchor, pos) => tunnelRingPoint(anchor, center, scale, {
    x: Math.sin(time * 1.3 + index * 0.7 + pos * 1.9) * wobbleAmp,
    y: Math.cos(time * 1.1 + index * 0.8 + pos * 1.6) * wobbleAmp,
  }));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = `hsla(${hue}, 100%, 58%, ${alpha})`;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.42})`;
  ctx.lineWidth = Math.max(0.8, width * 0.22);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function rectanglePerimeterPoint(rect, t) {
  const value = ((Number(t) % 1) + 1) % 1;
  const side = value * 4;
  if (side < 1) {
    return {
      x: rect.left + (rect.right - rect.left) * side,
      y: rect.top,
    };
  }
  if (side < 2) {
    return {
      x: rect.right,
      y: rect.top + (rect.bottom - rect.top) * (side - 1),
    };
  }
  if (side < 3) {
    return {
      x: rect.right - (rect.right - rect.left) * (side - 2),
      y: rect.bottom,
    };
  }
  return {
    x: rect.left,
    y: rect.bottom - (rect.bottom - rect.top) * (side - 3),
  };
}

function distanceToNearestCornerPhase(t) {
  const value = ((Number(t) % 1) + 1) % 1;
  return Math.min(
    Math.abs(value - 0),
    Math.abs(value - 0.25),
    Math.abs(value - 0.5),
    Math.abs(value - 0.75),
    Math.abs(value - 1),
  );
}

function drawTunnelProfile(ctx, person, x, y, radius, hue, alpha) {
  const entry = tunnelImageEntry(person.profile);
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

function drawTunnelDepthLines(ctx, center, hue, power, time, wallOrbit) {
  const outer = { left: -20, top: -20, right: TUNNEL_W + 20, bottom: TUNNEL_H + 20 };
  const innerW = 34 + power * 20;
  const innerH = 56 + power * 28;
  const inner = {
    left: center.x - innerW,
    top: center.y - innerH,
    right: center.x + innerW,
    bottom: center.y + innerH,
  };
  const count = 38;
  const maxPhotoSlots = Math.min(10, tunnelPeople.length);
  const photoEvery = maxPhotoSlots ? Math.max(1, Math.floor(count / maxPhotoSlots)) : 0;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = 0; i < count; i += 1) {
    const t = (i / count + wallOrbit + Math.sin(time * 0.8 + i * 0.31) * 0.004) % 1;
    const cornerGap = distanceToNearestCornerPhase(t);
    const avoidBaton = cornerGap < 0.018;
    if (avoidBaton) continue;
    const start = rectanglePerimeterPoint(outer, t);
    const end = rectanglePerimeterPoint(inner, t + Math.sin(time * 0.55 + i) * 0.006);
    const localHue = (hue + i * 11 + wallOrbit * 260) % 360;
    const alpha = 0.1 + power * 0.14 + Math.min(0.08, cornerGap * 1.2);
    ctx.strokeStyle = `hsla(${localHue}, 100%, 64%, ${alpha})`;
    ctx.lineWidth = 0.9 + power * 1.45;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    const travel = (time * 0.42 + i * 0.047) % 1;
    const sparkX = start.x + (end.x - start.x) * travel;
    const sparkY = start.y + (end.y - start.y) * travel;
    const personSlot = photoEvery && i % photoEvery === 0;
    const person = personSlot ? tunnelPeople[Math.floor(i / photoEvery) % tunnelPeople.length] : null;
    const perspective = 1 - travel;
    const photoRadius = (person?.weight > 1 ? 8.5 : 7.2) + perspective * 12 + power * 2.8;
    const photoAlpha = 0.28 + perspective * 0.45 + power * 0.18;
    if (!person || !drawTunnelProfile(ctx, person, sparkX, sparkY, photoRadius, localHue + 24, photoAlpha)) {
      ctx.fillStyle = `hsla(${localHue + 24}, 100%, 78%, ${0.16 + power * 0.2})`;
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, 1.8 + power * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTunnel(now) {
  if (!tunnelCtx) return;
  if (!isTunnelMode()) {
    requestAnimationFrame(drawTunnel);
    return;
  }
  const ctx = tunnelCtx;
  const time = now * 0.001;
  updateMusicVolume();
  updateMusicEnergy(time);
  tunnelHue = (tunnelHue + 0.18 + musicEnergy * 1.6) % 360;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#02030a";
  ctx.fillRect(0, 0, TUNNEL_W, TUNNEL_H);

  const center = {
    x: TUNNEL_W * 0.5 + Math.sin(time * 0.7) * (5 + musicBass * 10),
    y: TUNNEL_H * 0.31 + Math.cos(time * 0.52) * (4 + musicEnergy * 7),
  };
  const pulse = Math.max(0.12, Math.min(1, musicBass * 1.4 + musicEnergy * 0.55));
  const wallOrbit = time * 0.046;
  const batons = [
    { outer: { x: -14, y: -14 }, hue: (tunnelHue + 312) % 360, phase: 0 },
    { outer: { x: TUNNEL_W + 14, y: -14 }, hue: (tunnelHue + 28) % 360, phase: 0.18 },
    { outer: { x: TUNNEL_W + 14, y: TUNNEL_H + 14 }, hue: (tunnelHue + 90) % 360, phase: 0.36 },
    { outer: { x: -14, y: TUNNEL_H + 14 }, hue: (tunnelHue + 276) % 360, phase: 0.54 },
  ];
  const cornerAnchors = [
    batons[0].outer,
    batons[1].outer,
    batons[2].outer,
    batons[3].outer,
  ];

  const bg = ctx.createRadialGradient(center.x, center.y, 8, center.x, center.y, 430);
  bg.addColorStop(0, `hsla(${(tunnelHue + 85) % 360}, 100%, 58%, .35)`);
  bg.addColorStop(0.28, `hsla(${(tunnelHue + 170) % 360}, 96%, 40%, .1)`);
  bg.addColorStop(0.7, "rgba(3, 8, 18, .9)");
  bg.addColorStop(1, "#010106");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, TUNNEL_W, TUNNEL_H);

  ctx.globalCompositeOperation = "lighter";
  for (const baton of batons) {
    drawCornerSaber(ctx, baton.outer, center, baton.hue, pulse, time, baton.phase);
  }
  drawTunnelDepthLines(ctx, center, tunnelHue, pulse, time, wallOrbit);
  for (let i = 0; i < 40; i += 1) {
    const p = (i / 40 + time * (0.075 + musicEnergy * 0.14)) % 1;
    const scale = 0.12 + p * p * 1.08;
    const alpha = (1 - p) * 0.54 + 0.075;
    const hue = (tunnelHue + i * 10 + musicBass * 150) % 360;
    drawTunnelRing(ctx, cornerAnchors, center, scale, hue, alpha, 1.8 + pulse * 4.2 + p * 3.2, time, i);
  }

  ctx.globalCompositeOperation = "source-over";
  const floor = ctx.createLinearGradient(0, TUNNEL_H * 0.66, 0, TUNNEL_H);
  floor.addColorStop(0, "rgba(2, 5, 11, 0)");
  floor.addColorStop(0.4, `hsla(${(tunnelHue + 34) % 360}, 80%, 18%, .26)`);
  floor.addColorStop(1, "#010102");
  ctx.fillStyle = floor;
  ctx.fillRect(0, TUNNEL_H * 0.62, TUNNEL_W, TUNNEL_H * 0.38);

  requestAnimationFrame(drawTunnel);
}

function modulo(value, size) {
  const result = value % size;
  return result < 0 ? result + size : result;
}

function worldSize(map = currentMap) {
  const worldCfg = map?.world || { width: 1280, height: 720 };
  return {
    width: Number(worldCfg.width || 1280),
    height: Number(worldCfg.height || 720),
  };
}

function baseViewport(map = currentMap) {
  const worldCfg = map?.world || { width: 1280, height: 720 };
  const vp = map?.viewport || {};
  const defaultW = Number(worldCfg.height || 720) * STAGE_WIDTH / STAGE_HEIGHT;
  return {
    x: Number(vp.x ?? Math.max(0, (Number(worldCfg.width || 1280) - defaultW) * 0.5)),
    y: Number(vp.y ?? 0),
    w: Number(vp.w || defaultW),
    h: Number(vp.h || worldCfg.height || 720),
  };
}

function movementConfig(map = currentMap) {
  const movement = map?.movement || {};
  const durationMin = Math.max(1, Math.min(30, Number(movement.wide_shot_duration_min ?? 5)));
  const durationMax = Math.max(durationMin, Math.min(45, Number(movement.wide_shot_duration_max ?? 9)));
  const intervalMin = Math.max(1, Math.min(60, Number(movement.wide_shot_interval_min ?? 7)));
  const intervalMax = Math.max(intervalMin, Math.min(90, Number(movement.wide_shot_interval_max ?? 15)));
  return {
    cameraSpeed: Math.max(0.2, Math.min(4, Number(movement.camera_speed ?? DEFAULT_CAMERA_SPEED))),
    mainCameraScale: Math.max(1, Math.min(1.8, Number(movement.main_camera_scale ?? 1.18))),
    mainCameraXOffset: Math.max(-220, Math.min(220, Number(movement.main_camera_x_offset ?? 0))),
    mainCameraYOffset: Math.max(-240, Math.min(240, Number(movement.main_camera_y_offset ?? 0))),
    stopFollowSeconds: Math.max(0, Math.min(4, Number(movement.stop_follow_seconds ?? 1.0))),
    runDirection: DEFAULT_RUN_DIRECTION,
    wideShotEnabled: Boolean(movement.wide_shot_enabled ?? true),
    wideShotChance: Math.max(0, Math.min(1, Number(movement.wide_shot_chance ?? 0.22))),
    wideShotViewportScale: Math.max(1, Math.min(1.75, Number(movement.wide_shot_viewport_scale ?? 1.28))),
    wideShotYOffset: Math.max(-240, Math.min(240, Number(movement.wide_shot_y_offset ?? 0))),
    runStartShotScaleMin: Math.max(1, Math.min(2.6, Number(movement.run_start_shot_scale_min ?? 1.25))),
    runStartShotScaleMax: Math.max(1, Math.min(2.6, Number(movement.run_start_shot_scale_max ?? 2.15))),
    runStopShotScaleMin: Math.max(1, Math.min(2.6, Number(movement.run_stop_shot_scale_min ?? 1.2))),
    runStopShotScaleMax: Math.max(1, Math.min(2.6, Number(movement.run_stop_shot_scale_max ?? 2.05))),
    runStopShotXOffset: Math.max(0, Math.min(180, Number(movement.run_stop_shot_x_offset ?? 52))),
    wideShotDurationMin: durationMin,
    wideShotDurationMax: durationMax,
    wideShotIntervalMin: intervalMin,
    wideShotIntervalMax: intervalMax,
  };
}

function cameraSpeedMultiplier() {
  return movementConfig(currentMap).cameraSpeed;
}

function normalCameraScale(map = currentMap) {
  return movementConfig(map).mainCameraScale;
}

function randomBetween(min, max) {
  return Number(min) + Math.random() * Math.max(0, Number(max) - Number(min));
}

function randomDistinctBetween(min, max, lastValue = 0, minDelta = 0.06) {
  const low = Math.min(Number(min), Number(max));
  const high = Math.max(Number(min), Number(max));
  if (high - low <= minDelta) return low;
  let candidate = randomBetween(low, high);
  for (let attempt = 0; attempt < 8 && Math.abs(candidate - Number(lastValue || 0)) < minDelta; attempt += 1) {
    candidate = randomBetween(low, high);
  }
  if (Math.abs(candidate - Number(lastValue || 0)) < minDelta) {
    candidate = candidate + minDelta <= high ? candidate + minDelta : candidate - minDelta;
  }
  return Math.max(low, Math.min(high, candidate));
}

function scheduleWideShotDecision(now) {
  const cfg = movementConfig(currentMap);
  sceneCamera.nextDecisionAt = now + randomBetween(cfg.wideShotIntervalMin, cfg.wideShotIntervalMax) * 1000;
}

function activateWideShot(now = performance.now(), seconds = 0) {
  const cfg = movementConfig(currentMap);
  if (!cfg.wideShotEnabled) return;
  const duration = seconds > 0 ? Number(seconds) : randomBetween(cfg.wideShotDurationMin, cfg.wideShotDurationMax);
  sceneCamera.targetViewportScale = Math.max(cfg.mainCameraScale, cfg.wideShotViewportScale);
  sceneCamera.wideUntil = now + duration * 1000;
  sceneCamera.nextDecisionAt = 0;
  sceneCamera.activeShotKind = "wide";
  stage.dataset.camera = "wide";
}

function activateMotionCameraShot(kind, now = performance.now(), durationMs = 1200) {
  const cfg = movementConfig(currentMap);
  const isStop = kind === "stop";
  const min = isStop ? cfg.runStopShotScaleMin : cfg.runStartShotScaleMin;
  const max = isStop ? cfg.runStopShotScaleMax : cfg.runStartShotScaleMax;
  const lastKey = isStop ? "lastStopScale" : "lastStartScale";
  const scale = randomDistinctBetween(min, max, sceneCamera[lastKey] || 0);
  sceneCamera[lastKey] = scale;
  sceneCamera.targetViewportScale = Math.max(cfg.mainCameraScale, scale);
  sceneCamera.wideUntil = now + Math.max(350, Number(durationMs || 1200));
  sceneCamera.nextDecisionAt = 0;
  sceneCamera.activeShotKind = isStop ? "stop" : "start";
  stage.dataset.camera = isStop ? "stop-wide" : "start-wide";
}

function deactivateWideShot(now = performance.now()) {
  sceneCamera.targetViewportScale = normalCameraScale();
  sceneCamera.wideUntil = 0;
  sceneCamera.activeShotKind = "";
  stage.dataset.camera = "normal";
  scheduleWideShotDecision(now);
}

window.BONECO_GAME_CAMERA = {
  openWide(seconds = 8) {
    activateWideShot(performance.now(), Number(seconds) || 8);
  },
  closeWide() {
    deactivateWideShot(performance.now());
  },
};

function updateSceneCamera(now, dt, allowRandom = true) {
  const cfg = movementConfig(currentMap);
  if (!cfg.wideShotEnabled) {
    sceneCamera.targetViewportScale = cfg.mainCameraScale;
    sceneCamera.wideUntil = 0;
  } else if (sceneCamera.wideUntil && now >= sceneCamera.wideUntil) {
    deactivateWideShot(now);
  } else if (!sceneCamera.wideUntil && allowRandom) {
    if (!sceneCamera.nextDecisionAt) {
      sceneCamera.nextDecisionAt = now + 700;
    } else if (now >= sceneCamera.nextDecisionAt) {
      if (Math.random() < cfg.wideShotChance) activateWideShot(now);
      else scheduleWideShotDecision(now);
    }
  }

  const smoothing = 1 - Math.pow(0.001, Math.max(0, dt));
  sceneCamera.currentViewportScale += (sceneCamera.targetViewportScale - sceneCamera.currentViewportScale) * smoothing;
  if (Math.abs(sceneCamera.currentViewportScale - sceneCamera.targetViewportScale) < 0.002) {
    sceneCamera.currentViewportScale = sceneCamera.targetViewportScale;
  }
}

function dynamicViewport(map = currentMap) {
  const vp = baseViewport(map);
  const world = worldSize(map);
  const cfg = movementConfig(map);
  const viewportScale = Math.max(1, Number(sceneCamera.currentViewportScale || 1));
  const mainScale = Math.max(1, Number(cfg.mainCameraScale || 1));
  const referenceScale = Math.max(mainScale, cfg.wideShotViewportScale, Number(sceneCamera.targetViewportScale || 1));
  const mainProgress = mainScale > 1 ? Math.max(0, Math.min(1, (viewportScale - 1) / Math.max(0.001, mainScale - 1))) : 0;
  const wideProgress = Math.max(0, Math.min(1, (viewportScale - mainScale) / Math.max(0.001, referenceScale - mainScale)));
  const mainCameraOffset = cfg.mainCameraXOffset * mainProgress;
  const stopLeftOffset = sceneCamera.activeShotKind === "stop" ? cfg.runStopShotXOffset * wideProgress : 0;
  const w = vp.w * viewportScale;
  const h = vp.h * viewportScale;
  return {
    ...vp,
    w,
    h,
    x: modulo(walk.actorX - w * 0.5 + mainCameraOffset + stopLeftOffset, world.width),
    y: vp.y + cfg.mainCameraYOffset + cfg.wideShotYOffset * wideProgress,
  };
}

function worldRelativeX(x, viewportX, worldWidth) {
  let relative = modulo(x, worldWidth) - viewportX;
  if (relative < -worldWidth * 0.5) relative += worldWidth;
  if (relative > worldWidth * 0.5) relative -= worldWidth;
  return relative;
}

function zFor(item) {
  const base = {
    sky: 0,
    far_bg: 10,
    back_props: 20,
    floor: 42,
    interactive: 55,
    front_props: 80,
  }[item.layer] ?? 20;
  return base * 1000 + Number(item.z || 0);
}

const SKY_VARIANTS = [
  "night-blue",
  "night-blue",
  "night-violet",
  "night-green",
  "night-deep",
  "night-deep",
  "sunset-blood",
  "sunset-ember",
  "day-cold",
];

function selectSkyForMap(map) {
  if (!skyLayer) return;
  const key = `${map?.avatar || ""}:${map?.map_name || ""}:${map?.updated_at || ""}`;
  if (key === skyRuntimeKey) return;
  skyRuntimeKey = key;
  const variant = SKY_VARIANTS[Math.floor(Math.random() * SKY_VARIANTS.length)] || "night-blue";
  skyLayer.dataset.sky = variant;
}

function renderMap(map) {
  currentMap = map;
  selectSkyForMap(map);
  const objects = Array.isArray(map.objects)
    ? map.objects.filter(item => item && item.visible !== false && item.asset)
    : [];
  const signature = JSON.stringify(objects.map(item => [
    item.id,
    item.asset,
    item.layer,
    item.x,
    item.y,
    item.w,
    item.h,
    item.z,
  ]));
  if (signature === mapSignature) return;
  mapSignature = signature;
  mapEntries = [];
  mapBack.replaceChildren();
  mapFront.replaceChildren();

  for (const item of objects.sort((a, b) => zFor(a) - zFor(b))) {
    for (const copy of [-1, 0, 1]) {
      const isFloor = item.layer === "floor";
      const node = isFloor ? document.createElement("div") : document.createElement("img");
      node.className = `mapObject${isFloor ? " mapObjectFloor" : ""}`;
      const src = assetUrl(item.asset);
      if (isFloor) {
        node.style.backgroundImage = `url(${JSON.stringify(src)})`;
      } else {
        node.decoding = "async";
        node.src = src;
      }
      node.style.zIndex = String(zFor(item));
      if (item.layer === "front_props") mapFront.appendChild(node);
      else mapBack.appendChild(node);
      mapEntries.push({ node, item, copy });
    }
  }
  positionScene();
}

function positionScene() {
  if (!currentMap) return;
  const world = worldSize(currentMap);
  const vp = dynamicViewport(currentMap);
  for (const entry of mapEntries) {
    const item = entry.item;
    const x = Number(item.x || 0) + entry.copy * world.width;
    entry.node.style.left = `${((x - vp.x) / vp.w) * 100}%`;
    entry.node.style.top = `${((Number(item.y || 0) - vp.y) / vp.h) * 100}%`;
    entry.node.style.width = `${(Number(item.w || 0) / vp.w) * 100}%`;
    entry.node.style.height = `${(Number(item.h || 0) / vp.h) * 100}%`;
  }

  const actorScreenX = (worldRelativeX(walk.actorX, vp.x, world.width) / vp.w) * STAGE_WIDTH;
  const spawn = currentMap?.spawn_points?.main || {};
  const spawnY = Number(spawn.y ?? world.height * 0.82);
  const currentGroundY = ((spawnY - vp.y) / vp.h) * STAGE_HEIGHT;
  const actorScale = Math.max(0.34, Math.min(1, 1 / Math.max(1, Number(sceneCamera.currentViewportScale || 1))));
  actorLayer.style.setProperty("--actor-x", `${(actorScreenX - STAGE_WIDTH * 0.5).toFixed(2)}px`);
  actorLayer.style.setProperty("--actor-y", `${(currentGroundY - STAGE_HEIGHT).toFixed(2)}px`);
  actorLayer.style.setProperty("--actor-scale", actorScale.toFixed(5));
}

function resetWalkForMap(map) {
  const key = `${map?.avatar || ""}:${map?.map_name || ""}:${map?.updated_at || ""}`;
  if (key === mapRuntimeKey) return;
  mapRuntimeKey = key;
  const world = worldSize(map);
  const spawn = map?.spawn_points?.main || {};
  walk.actorX = Number(spawn.x ?? world.width * 0.5);
  walk.targetX = null;
  walk.direction = movementConfig(map).runDirection;
  sceneCamera.currentViewportScale = normalCameraScale(map);
  sceneCamera.targetViewportScale = normalCameraScale(map);
  sceneCamera.wideUntil = 0;
  sceneCamera.nextDecisionAt = performance.now() + 700;
  sceneCamera.lastStartScale = 0;
  sceneCamera.lastStopScale = 0;
  sceneCamera.activeShotKind = "";
  stage.dataset.camera = "normal";
  walk.phase = "idle";
  walk.phaseStartedAt = 0;
  walk.loopStartedAt = 0;
  walk.phaseUntil = 0;
  walk.directionCyclesLeft = 0;
  walk.pauseUntil = performance.now() + 900;
  walk.lastTs = 0;
  positionScene();
}

function chooseWalkDirection() {
  walk.direction = movementConfig(currentMap).runDirection;
  walk.directionCyclesLeft = 0;
  return walk.direction;
}

function walkLoopMs() {
  return Math.max(350, safeDurationSeconds(walkMotion.loop_start, walkMotion.loop_end, 2800) * 1000);
}

function randomWalkDistance(direction, speed) {
  const loopCycles = 1 + Math.floor(Math.random() * 3);
  const startSeconds = (walkStartMs() / 1000) * 0.78;
  const loopSeconds = (walkLoopMs() / 1000) * (loopCycles + Math.random() * 0.45) * cameraSpeedMultiplier();
  const movingSeconds = startSeconds + loopSeconds;
  const distance = Math.max(520, Number(speed || walk.speed || 140) * movingSeconds);
  return direction === "left" ? -distance : distance;
}

function chooseNextWalkTarget(now) {
  walk.direction = chooseWalkDirection();
  walk.speed = 116 + Math.random() * 68;
  walk.targetX = walk.actorX + randomWalkDistance(walk.direction, walk.speed);
  walk.phase = "start";
  walk.phaseStartedAt = now;
  walk.loopStartedAt = 0;
  walk.phaseUntil = now + walkStartMs();
  walk.pauseUntil = 0;
  activateMotionCameraShot("start", now, walkStartMs() * 1.15);
}

function walkSceneFor(direction, phase) {
  const side = direction === "left" ? "left" : "right";
  if (phase === "start") return `walk_start_${side}`;
  if (phase === "loop") return `walk_loop_${side}`;
  if (phase === "stop") return `walk_stop_${side}`;
  return `walk_${side}`;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function safeDurationSeconds(start, end, fallbackMs) {
  const value = Number(end || 0) - Number(start || 0);
  if (value > 0.05) return value;
  return Math.max(0.05, Number(fallbackMs || 1000) / 1000);
}

function walkStartMs() {
  return Math.max(350, safeDurationSeconds(walkMotion.start, walkMotion.loop_start, WALK_START_MS) * 1000 / WALK_TRANSITION_TIME_SCALE);
}

function walkStopMs() {
  return Math.max(350, safeDurationSeconds(walkMotion.loop_end, walkMotion.stop_end, WALK_STOP_MS) * 1000 / WALK_TRANSITION_TIME_SCALE);
}

function walkSpeedMultiplier(now) {
  const cameraSpeed = cameraSpeedMultiplier();
  if (walk.phase === "start") {
    const elapsed = (now - walk.phaseStartedAt) / 1000;
    const accelDuration = safeDurationSeconds(walkMotion.start, walkMotion.accel_end, WALK_START_MS) / WALK_TRANSITION_TIME_SCALE;
    return (0.38 + smoothstep(elapsed / accelDuration) * 0.62) * cameraSpeed;
  }
  if (walk.phase === "stop") {
    const elapsed = (now - walk.phaseStartedAt) / 1000;
    const stopDuration = safeDurationSeconds(walkMotion.loop_end, walkMotion.stop_end, WALK_STOP_MS) / WALK_TRANSITION_TIME_SCALE;
    const decelOffset = Math.max(0, Number(walkMotion.decel_start || walkMotion.loop_end) - Number(walkMotion.loop_end || 0)) / WALK_TRANSITION_TIME_SCALE;
    if (elapsed <= decelOffset) return cameraSpeed;
    const decelDuration = Math.max(0.08, stopDuration - decelOffset);
    return (1 - smoothstep((elapsed - decelOffset) / decelDuration) * 0.62) * cameraSpeed;
  }
  if (walk.phase === "loop") {
    return cameraSpeed;
  }
  return 1;
}

function stopFollowMultiplier(now) {
  const { stopFollowSeconds } = movementConfig(currentMap);
  if (stopFollowSeconds <= 0 || !walk.phaseStartedAt) return 0;
  const elapsed = (now - walk.phaseStartedAt) / 1000;
  if (elapsed >= stopFollowSeconds) return 0;
  return cameraSpeedMultiplier() * (1 - smoothstep(elapsed / stopFollowSeconds));
}

function advanceWalk(dt, now) {
  if (walk.targetX === null) return true;
  const remaining = walk.targetX - walk.actorX;
  const step = Math.sign(remaining) * walk.speed * walkSpeedMultiplier(now) * dt;
  if (Math.abs(remaining) <= Math.abs(step) || Math.abs(remaining) < 3) {
    walk.actorX = walk.targetX;
    walk.targetX = null;
    return true;
  }
  walk.actorX += step;
  return false;
}

function updateWalking(now) {
  if (!currentMap) return;
  if (!walk.lastTs) walk.lastTs = now;
  const dt = Math.min(0.08, Math.max(0, (now - walk.lastTs) / 1000));
  walk.lastTs = now;

  if (isTunnelMode()) {
    positionTunnelActor();
    if (!speechBusy) {
      if (currentScene === "idle" && idleFullPlay && activeVideo?.ended) {
        currentScene = "";
        currentVideo = "";
        idleFullPlay = false;
      }
      if (!currentVideo || currentScene !== "idle") setScene("idle");
    }
    return;
  }

  if (speechBusy) {
    updateSceneCamera(now, dt, false);
    positionScene();
    return;
  }

  updateSceneCamera(now, dt, true);

  if (walk.pauseUntil && now < walk.pauseUntil) {
    walk.phase = "idle";
    setScene("idle");
    positionScene();
    return;
  }

  if (walk.targetX === null && walk.phase !== "start" && walk.phase !== "loop" && walk.phase !== "stop") {
    chooseNextWalkTarget(now);
  }

  if (walk.phase === "start") {
    advanceWalk(dt, now);
    setScene(walkSceneFor(walk.direction, "start"), { loop: false, playbackRate: WALK_TRANSITION_PLAYBACK_RATE });
    if (now >= walk.phaseUntil) {
      walk.phase = "loop";
      walk.phaseStartedAt = now;
      walk.loopStartedAt = now;
      walk.phaseUntil = 0;
      if (walk.targetX === null) {
        walk.targetX = walk.actorX + randomWalkDistance(walk.direction, walk.speed);
      }
      currentScene = "";
    }
    positionScene();
    return;
  }

  if (walk.phase === "stop") {
    const follow = stopFollowMultiplier(now);
    if (follow > 0) {
      const sign = walk.direction === "left" ? -1 : 1;
      walk.actorX += sign * walk.speed * follow * dt;
    }
    setScene(walkSceneFor(walk.direction, "stop"), { loop: false, playbackRate: WALK_TRANSITION_PLAYBACK_RATE });
    if (now >= walk.phaseUntil) {
      walk.phase = "idle";
      walk.loopStartedAt = 0;
      walk.phaseUntil = 0;
      walk.pauseUntil = now + 900 + Math.random() * 2400;
      currentScene = "";
      setScene("idle");
    }
    positionScene();
    return;
  }

  walk.phase = "loop";
  if (!walk.loopStartedAt) walk.loopStartedAt = now;
  const reached = advanceWalk(dt, now);
  const minLoopDone = now - walk.loopStartedAt >= walkLoopMs() * 0.96;
  if (reached && !minLoopDone) {
    const remainingSeconds = Math.max(0.25, (walkLoopMs() - (now - walk.loopStartedAt)) / 1000);
    const sign = walk.direction === "left" ? -1 : 1;
    walk.targetX = walk.actorX + sign * walk.speed * remainingSeconds;
    setScene(walkSceneFor(walk.direction, "loop"), { loop: true });
  } else if (reached) {
    walk.phase = "stop";
    walk.phaseStartedAt = now;
    walk.loopStartedAt = 0;
    walk.phaseUntil = now + walkStopMs();
    activateMotionCameraShot("stop", now, walkStopMs() * 1.25);
    currentScene = "";
    setScene(walkSceneFor(walk.direction, "stop"), { loop: false, playbackRate: WALK_TRANSITION_PLAYBACK_RATE });
  } else {
    setScene(walkSceneFor(walk.direction, "loop"), { loop: true });
  }
  positionScene();
}

function gameLoop(now) {
  updateWalking(now);
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

async function switchVideo(path, options = {}) {
  if (!path) return false;
  const force = Boolean(options.force);
  if (path === currentVideo && !force) return true;
  if (path === currentVideo && force && activeVideo) {
    const token = ++videoSwitchToken;
    idleFullPlay = Boolean(options.fullPlay);
    idleFullPlayStartedAt = idleFullPlay ? performance.now() : 0;
    activeVideo.loop = Boolean(options.fullPlay) ? false : options.loop !== false;
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
  standbyVideo.muted = true;
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

function mediaForScene(scene) {
  if (scene === "walk_start_right") return mediaState.walk_start_right?.length ? mediaState.walk_start_right : mediaState.walk_right;
  if (scene === "walk_loop_right") return mediaState.walk_loop_right?.length ? mediaState.walk_loop_right : mediaState.walk_right;
  if (scene === "walk_stop_right") return mediaState.walk_stop_right?.length ? mediaState.walk_stop_right : mediaState.walk_right;
  if (scene === "walk_start_left") return mediaState.walk_start_left?.length ? mediaState.walk_start_left : mediaState.walk_left;
  if (scene === "walk_loop_left") return mediaState.walk_loop_left?.length ? mediaState.walk_loop_left : mediaState.walk_left;
  if (scene === "walk_stop_left") return mediaState.walk_stop_left?.length ? mediaState.walk_stop_left : mediaState.walk_left;
  if (scene === "walk_right") return mediaState.walk_right;
  if (scene === "walk_left") return mediaState.walk_left;
  if (scene === "talking") return mediaState.talking;
  return mediaState.idle;
}

function fileNameFromPath(path) {
  return String(path || "").split(/[\\/]/).pop() || "";
}

function isDanceIdleVideo(path) {
  const file = fileNameFromPath(path);
  const stem = file.replace(/\.[^.]+$/, "");
  return /(^|[_\-\s])d($|[_\-\s])/i.test(stem);
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
  if (currentScene === scene && currentVideo && !options.force) return true;
  const list = mediaForScene(scene);
  const path = pick(list, currentVideo) || pick(mediaState.idle, currentVideo);
  if (!path) return false;
  currentScene = scene;
  const fullPlay = scene === "idle" && isDanceIdleVideo(path);
  return switchVideo(path, { ...options, loop: !fullPlay, fullPlay });
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
    walkMotion = { ...walkMotion, ...(payload.walk_motion || {}) };
    bellyProfileScale = clampNumber(payload.state?.belly_profile_scale, 0.45, 2.0, 0.82);
    bellyProfileOffsetX = clampNumber(payload.state?.belly_profile_offset_x, -120, 120, 0);
    bellyProfileOffsetY = clampNumber(payload.state?.belly_profile_offset_y, -120, 120, 0);
    visualMode = String(payload.state?.visual_mode || "tunnel") === "map" ? "map" : "tunnel";
    stage.dataset.visual = visualMode;
    stage.dataset.mode = String(urlMode || payload.state?.mode || "normal");
    syncMusicTracks(payload.music || []);
    syncTunnelPeople(payload.visual_people || []);
    if (isTunnelMode()) {
      currentMap = payload.map || currentMap || {};
      clearMapForTunnel();
      positionTunnelActor();
    } else {
      renderMap(payload.map || {});
      resetWalkForMap(payload.map || {});
      applyCamera(payload.state?.camera || { x: 0, y: 0, zoom: 1 });
    }
    if (!currentVideo) await setScene("idle");
  } catch (err) {
    console.warn("state failed", err);
  }
}

async function pollSpeech() {
  if (speechBusy || speechFetchBusy) return false;
  if (shouldHoldSpeechForIdleFullPlay()) return false;
  speechFetchBusy = true;
  try {
    const response = await fetch("/api/renderer/next-speech", { cache: "no-store" });
    const payload = await response.json();
    if (!payload.job) return false;
    speechBusy = true;
    await playSpeechJob(payload.job);
    return true;
  } catch (err) {
    console.warn("speech failed", err);
    speechBusy = false;
    hideMessageCard();
    return false;
  } finally {
    speechFetchBusy = false;
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
  videoWatchdogState = {
    src: activeVideo?.currentSrc || activeVideo?.src || "",
    time: Number(activeVideo?.currentTime || 0),
    wallAt: performance.now(),
  };
  const tick = () => {
    if (token !== activeSpeechToken || !speechBusy) {
      videoWatchdogFrame = 0;
      return;
    }
    const video = activeVideo;
    if (video && currentScene === "talking") {
      if (video.ended && video.loop !== false) {
        try {
          video.currentTime = 0;
        } catch (err) {
          console.warn("speech video rewind failed", err);
        }
        video.play().catch(() => {});
      } else if (video.paused) {
        video.play().catch(() => {});
      }
      const src = video.currentSrc || video.src || "";
      const time = Number(video.currentTime || 0);
      const minProgress = Math.max(0.012, 0.018 * Math.max(0.4, Number(video.playbackRate || 1)));
      if (src !== videoWatchdogState.src || Math.abs(time - videoWatchdogState.time) >= minProgress) {
        videoWatchdogState = { src, time, wallAt: performance.now() };
      } else if (performance.now() - videoWatchdogState.wallAt > STALLED_VIDEO_SWITCH_MS) {
        recoverTalkingVideo(token, "stalled-frame").catch(console.warn);
        videoWatchdogState = { src, time: Number(video.currentTime || 0), wallAt: performance.now() };
      } else if (performance.now() - videoWatchdogState.wallAt > STALLED_VIDEO_NUDGE_MS) {
        console.warn("speech video watchdog recovered stalled frame");
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = Math.min(Math.max(0, time + 0.12), Math.max(0, video.duration - 0.05));
        }
        video.play().catch(() => {});
        videoWatchdogState = { src, time: Number(video.currentTime || 0), wallAt: performance.now() };
      }
    }
    videoWatchdogFrame = requestAnimationFrame(tick);
  };
  videoWatchdogFrame = requestAnimationFrame(tick);
}

function stopVideoWatchdog() {
  if (videoWatchdogFrame) {
    cancelAnimationFrame(videoWatchdogFrame);
    videoWatchdogFrame = 0;
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
      setVideoRate(shouldSlowTimelineSegment(segment) ? MICRO_PAUSE_RATE : 1);
    }
    timelineFrame = requestAnimationFrame(tick);
  };
  timelineFrame = requestAnimationFrame(tick);
}

async function playSpeechJob(job) {
  const token = ++activeSpeechToken;
  const timeline = await timelineForJob(job);
  const audioPath = String(job.audio_path || "");
  const fallbackMs = Math.max(1600, Math.min(8500, String(job.text || "").length * 58));

  stopTimeline();
  showMessageCard(job);
  sceneAudio.pause();
  sceneAudio.removeAttribute("src");
  sceneAudio.load();

  await setScene("talking", { force: true, startAt: 0 });

  if (!audioPath) {
    window.setTimeout(() => finishSpeechVisual(token), fallbackMs);
    return;
  }

  sceneAudio.src = fileUrl(audioPath);
  sceneAudio.currentTime = 0;
  sceneAudio.playbackRate = 1;
  sceneAudio.volume = 1;
  sceneAudio.muted = false;

  const finishOnce = () => finishSpeechVisual(token);
  sceneAudio.addEventListener("ended", finishOnce, { once: true });
  sceneAudio.addEventListener("error", finishOnce, { once: true });
  startLipSync(timeline, sceneAudio, token);
  await sceneAudio.play().catch(() => {
    audioUnlock.hidden = false;
    stopTimeline();
    window.setTimeout(() => finishSpeechVisual(token), fallbackMs);
  });
}

async function finishSpeechVisual(token = activeSpeechToken) {
  if (token !== activeSpeechToken) return;
  stopTimeline();
  sceneAudio.pause();
  sceneAudio.removeAttribute("src");
  sceneAudio.load();
  hideMessageCard();
  if (token !== activeSpeechToken) return;
  speechBusy = false;
  const startedNext = await pollSpeech();
  if (!startedNext && token === activeSpeechToken) {
    await setScene("idle").catch(console.warn);
  }
}

pollState();
stage.dataset.visual = visualMode;
requestAnimationFrame(gameLoop);
requestAnimationFrame(drawTunnel);
setInterval(pollState, 900);
setInterval(pollSpeech, 350);
