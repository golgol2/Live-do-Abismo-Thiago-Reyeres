const cfg = window.BONECO_MAP_EDITOR || { avatar: "BONECO_MAPA_2D", mapName: "Padrao", idleVideo: "" };
const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 1280;

const mapJson = document.getElementById("mapJson");
const previewObjects = document.getElementById("previewObjects");
const mapCanvas = document.getElementById("mapCanvas");
const liveViewportFrame = document.getElementById("liveViewportFrame");
const runLine = document.getElementById("runLine");
const previewActorVideo = document.getElementById("previewActorVideo");
const previewActorFallback = document.getElementById("previewActorFallback");
const objectList = document.getElementById("objectList");
const assetCategorySelect = document.getElementById("assetCategorySelect");
const assetSearch = document.getElementById("assetSearch");
const assetSelect = document.getElementById("assetSelect");
const assetBrowser = document.getElementById("assetBrowser");
const propName = document.getElementById("propName");
const propLayer = document.getElementById("propLayer");
const propX = document.getElementById("propX");
const propY = document.getElementById("propY");
const propW = document.getElementById("propW");
const propH = document.getElementById("propH");
const propZ = document.getElementById("propZ");
const propVisible = document.getElementById("propVisible");
const propLockRatio = document.getElementById("propLockRatio");
const cameraSpeedRange = document.getElementById("cameraSpeedRange");
const cameraSpeedValue = document.getElementById("cameraSpeedValue");
const mainCameraScaleRange = document.getElementById("mainCameraScaleRange");
const mainCameraScaleValue = document.getElementById("mainCameraScaleValue");
const mainCameraXOffsetRange = document.getElementById("mainCameraXOffsetRange");
const mainCameraXOffsetValue = document.getElementById("mainCameraXOffsetValue");
const mainCameraYOffsetRange = document.getElementById("mainCameraYOffsetRange");
const mainCameraYOffsetValue = document.getElementById("mainCameraYOffsetValue");
const stopFollowRange = document.getElementById("stopFollowRange");
const stopFollowValue = document.getElementById("stopFollowValue");
const wideShotScaleRange = document.getElementById("wideShotScaleRange");
const wideShotScaleValue = document.getElementById("wideShotScaleValue");
const wideShotYOffsetRange = document.getElementById("wideShotYOffsetRange");
const wideShotYOffsetValue = document.getElementById("wideShotYOffsetValue");
const wideShotChanceRange = document.getElementById("wideShotChanceRange");
const wideShotChanceValue = document.getElementById("wideShotChanceValue");
const runStartShotMinValue = document.getElementById("runStartShotMinValue");
const runStartShotMaxValue = document.getElementById("runStartShotMaxValue");
const runStopShotMinValue = document.getElementById("runStopShotMinValue");
const runStopShotMaxValue = document.getElementById("runStopShotMaxValue");
const runStopShotXOffsetRange = document.getElementById("runStopShotXOffsetRange");
const runStopShotXOffsetValue = document.getElementById("runStopShotXOffsetValue");

let currentMap = null;
let selectedId = "";
let assets = [];
let suppressPropEvents = false;
let suppressMovementEvents = false;
let dragState = null;

const DEFAULT_MOVEMENT = {
  camera_speed: 3.25,
  stop_follow_seconds: 1.0,
  run_direction: "right",
  main_camera_scale: 1.18,
  main_camera_x_offset: 0,
  main_camera_y_offset: 0,
  wide_shot_enabled: true,
  wide_shot_chance: 0.22,
  wide_shot_viewport_scale: 1.28,
  wide_shot_y_offset: 0,
  run_start_shot_scale_min: 1.25,
  run_start_shot_scale_max: 2.15,
  run_stop_shot_scale_min: 1.2,
  run_stop_shot_scale_max: 2.05,
  run_stop_shot_x_offset: 52,
  wide_shot_duration_min: 5.0,
  wide_shot_duration_max: 9.0,
  wide_shot_interval_min: 7.0,
  wide_shot_interval_max: 15.0,
};

function mapUrl() {
  return `/api/map?avatar=${encodeURIComponent(cfg.avatar)}&map_name=${encodeURIComponent(cfg.mapName)}`;
}

function assetsUrl() {
  return `/api/map/assets?avatar=${encodeURIComponent(cfg.avatar)}`;
}

function fileUrl(path) {
  if (!path) return "";
  return `/file?path=${encodeURIComponent(path)}`;
}

function assetUrl(path) {
  if (!path) return "";
  return path.startsWith("/") ? fileUrl(path) : `/assets/${path}`;
}

function worldSize(map = currentMap) {
  const world = map?.world || { width: 1280, height: 720 };
  return {
    width: Number(world.width || 1280),
    height: Number(world.height || 720),
  };
}

function viewportOf(map = currentMap) {
  const world = worldSize(map);
  const vp = map?.viewport || {};
  const defaultW = world.height * 720 / 1280;
  return {
    x: Number(vp.x ?? Math.max(0, (world.width - defaultW) * 0.5)),
    y: Number(vp.y ?? 0),
    w: Number(vp.w || defaultW),
    h: Number(vp.h || world.height),
  };
}

function ensureSpawnPoints(map = currentMap) {
  const world = worldSize(map);
  if (!map.spawn_points || typeof map.spawn_points !== "object") {
    map.spawn_points = {};
  }
  if (!map.spawn_points.main || typeof map.spawn_points.main !== "object") {
    map.spawn_points.main = { x: world.width * 0.5, y: world.height * 0.82 };
  }
  map.spawn_points.main.x = clamp(map.spawn_points.main.x ?? world.width * 0.5, 0, world.width);
  map.spawn_points.main.y = clamp(map.spawn_points.main.y ?? world.height * 0.82, 0, world.height);
  return map.spawn_points.main;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function ensureMovement(map = currentMap) {
  if (!map) return { ...DEFAULT_MOVEMENT };
  if (!map.movement || typeof map.movement !== "object") {
    map.movement = { ...DEFAULT_MOVEMENT };
  }
  map.movement.camera_speed = clamp(map.movement.camera_speed ?? DEFAULT_MOVEMENT.camera_speed, 0.2, 4);
  map.movement.main_camera_scale = clamp(map.movement.main_camera_scale ?? DEFAULT_MOVEMENT.main_camera_scale, 1, 1.8);
  map.movement.main_camera_x_offset = clamp(map.movement.main_camera_x_offset ?? DEFAULT_MOVEMENT.main_camera_x_offset, -220, 220);
  map.movement.main_camera_y_offset = clamp(map.movement.main_camera_y_offset ?? DEFAULT_MOVEMENT.main_camera_y_offset, -240, 240);
  map.movement.stop_follow_seconds = clamp(map.movement.stop_follow_seconds ?? DEFAULT_MOVEMENT.stop_follow_seconds, 0, 4);
  map.movement.run_direction = "right";
  map.movement.wide_shot_enabled = Boolean(map.movement.wide_shot_enabled ?? DEFAULT_MOVEMENT.wide_shot_enabled);
  map.movement.wide_shot_chance = clamp(map.movement.wide_shot_chance ?? DEFAULT_MOVEMENT.wide_shot_chance, 0, 1);
  map.movement.wide_shot_viewport_scale = clamp(map.movement.wide_shot_viewport_scale ?? DEFAULT_MOVEMENT.wide_shot_viewport_scale, 1, 1.75);
  map.movement.wide_shot_y_offset = clamp(map.movement.wide_shot_y_offset ?? DEFAULT_MOVEMENT.wide_shot_y_offset, -240, 240);
  map.movement.run_start_shot_scale_min = clamp(map.movement.run_start_shot_scale_min ?? DEFAULT_MOVEMENT.run_start_shot_scale_min, 1, 2.6);
  map.movement.run_start_shot_scale_max = clamp(map.movement.run_start_shot_scale_max ?? DEFAULT_MOVEMENT.run_start_shot_scale_max, 1, 2.6);
  map.movement.run_stop_shot_scale_min = clamp(map.movement.run_stop_shot_scale_min ?? DEFAULT_MOVEMENT.run_stop_shot_scale_min, 1, 2.6);
  map.movement.run_stop_shot_scale_max = clamp(map.movement.run_stop_shot_scale_max ?? DEFAULT_MOVEMENT.run_stop_shot_scale_max, 1, 2.6);
  map.movement.run_stop_shot_x_offset = clamp(map.movement.run_stop_shot_x_offset ?? DEFAULT_MOVEMENT.run_stop_shot_x_offset, 0, 180);
  map.movement.wide_shot_duration_min = clamp(map.movement.wide_shot_duration_min ?? DEFAULT_MOVEMENT.wide_shot_duration_min, 1, 30);
  map.movement.wide_shot_duration_max = clamp(map.movement.wide_shot_duration_max ?? DEFAULT_MOVEMENT.wide_shot_duration_max, 1, 45);
  map.movement.wide_shot_interval_min = clamp(map.movement.wide_shot_interval_min ?? DEFAULT_MOVEMENT.wide_shot_interval_min, 1, 60);
  map.movement.wide_shot_interval_max = clamp(map.movement.wide_shot_interval_max ?? DEFAULT_MOVEMENT.wide_shot_interval_max, 1, 90);
  if (map.movement.wide_shot_duration_max < map.movement.wide_shot_duration_min) {
    map.movement.wide_shot_duration_max = map.movement.wide_shot_duration_min;
  }
  if (map.movement.wide_shot_interval_max < map.movement.wide_shot_interval_min) {
    map.movement.wide_shot_interval_max = map.movement.wide_shot_interval_min;
  }
  if (map.movement.run_start_shot_scale_max < map.movement.run_start_shot_scale_min) {
    map.movement.run_start_shot_scale_max = map.movement.run_start_shot_scale_min;
  }
  if (map.movement.run_stop_shot_scale_max < map.movement.run_stop_shot_scale_min) {
    map.movement.run_stop_shot_scale_max = map.movement.run_stop_shot_scale_min;
  }
  return map.movement;
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
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

function setActorPreview() {
  if (cfg.idleVideo) {
    previewActorVideo.src = fileUrl(cfg.idleVideo);
    previewActorVideo.hidden = false;
    previewActorFallback.style.display = "none";
  } else {
    previewActorVideo.hidden = true;
    previewActorFallback.style.display = "grid";
  }
}

function renderViewportFrame(map) {
  const world = worldSize(map);
  const vp = viewportOf(map);
  liveViewportFrame.style.left = `${(vp.x / world.width) * 100}%`;
  liveViewportFrame.style.top = `${(vp.y / world.height) * 100}%`;
  liveViewportFrame.style.width = `${(vp.w / world.width) * 100}%`;
  liveViewportFrame.style.height = `${(vp.h / world.height) * 100}%`;
}

function renderActorPosition(map) {
  const world = worldSize(map);
  const spawn = ensureSpawnPoints(map);
  const left = (Number(spawn.x || world.width * 0.5) / world.width) * 100;
  const bottom = Math.max(0, ((world.height - Number(spawn.y || world.height * 0.82)) / world.height) * 100);
  for (const node of [previewActorVideo, previewActorFallback]) {
    node.style.left = `${left}%`;
    node.style.bottom = `${bottom}%`;
  }
}

function renderRunLine(map) {
  const world = worldSize(map);
  const spawn = ensureSpawnPoints(map);
  runLine.style.top = `${(Number(spawn.y || 0) / world.height) * 100}%`;
  runLine.classList.toggle("active", selectedId === "__run_line__");
}

function renderObjects(map) {
  previewObjects.replaceChildren();
  const world = worldSize(map);
  const objects = Array.isArray(map.objects) ? [...map.objects] : [];
  objects.sort((a, b) => zFor(a) - zFor(b));

  for (const item of objects) {
    if (!item.asset || item.visible === false) continue;
    const img = document.createElement("img");
    const isFloor = item.layer === "floor";
    const node = isFloor ? document.createElement("div") : img;
    node.className = `previewObj${isFloor ? " previewObjFloor" : ""}${item.id === selectedId ? " active" : ""}`;
    img.dataset.id = item.id;
    node.dataset.id = item.id;
    if (isFloor) {
      node.style.backgroundImage = `url(${JSON.stringify(assetUrl(item.asset))})`;
    } else {
      img.src = assetUrl(item.asset);
    }
    node.style.left = `${(Number(item.x || 0) / world.width) * 100}%`;
    node.style.top = `${(Number(item.y || 0) / world.height) * 100}%`;
    node.style.width = `${(Number(item.w || 0) / world.width) * 100}%`;
    node.style.height = `${(Number(item.h || 0) / world.height) * 100}%`;
    node.style.zIndex = String(zFor(item));
    node.title = item.name || item.id;
    node.addEventListener("click", event => {
      event.stopPropagation();
      selectObject(item.id);
    });
    node.addEventListener("pointerdown", event => startDrag(event, item.id));
    previewObjects.appendChild(node);
  }
}

function renderObjectList(map) {
  objectList.replaceChildren();
  const objects = Array.isArray(map.objects) ? map.objects : [];
  if (!objects.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Nenhum objeto no mapa.";
    objectList.appendChild(empty);
    return;
  }

  for (const item of objects) {
    const row = document.createElement("div");
    row.className = `object-row${item.id === selectedId ? " active" : ""}`;
    row.dataset.id = item.id;
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = item.name || item.id;
    row.querySelector("span").textContent = `${item.layer} | x ${Math.round(Number(item.x || 0))}, y ${Math.round(Number(item.y || 0))}`;
    row.addEventListener("click", () => selectObject(item.id));
    objectList.appendChild(row);
  }
}

function selectedObject() {
  if (selectedId === "__run_line__") return null;
  return (currentMap?.objects || []).find(item => item.id === selectedId) || null;
}

function renderProps() {
  const item = selectedObject();
  suppressPropEvents = true;
  const disabled = !item;
  for (const input of [propName, propLayer, propX, propY, propW, propH, propZ, propVisible, propLockRatio]) {
    input.disabled = disabled;
  }
  if (item) {
    propName.value = item.name || "";
    propLayer.value = item.layer || "back_props";
    propX.value = Math.round(Number(item.x || 0));
    propY.value = Math.round(Number(item.y || 0));
    propW.value = Math.round(Number(item.w || 0));
    propH.value = Math.round(Number(item.h || 0));
    propZ.value = Number(item.z || 0);
    propVisible.checked = item.visible !== false;
    propLockRatio.checked = item.lock_ratio !== false;
  } else {
    propName.value = "";
    propLayer.value = "back_props";
    propX.value = "";
    propY.value = "";
    propW.value = "";
    propH.value = "";
    propZ.value = "";
    propVisible.checked = true;
    propLockRatio.checked = true;
  }
  suppressPropEvents = false;
}

function renderMovementControls() {
  const movement = ensureMovement(currentMap);
  suppressMovementEvents = true;
  cameraSpeedRange.value = String(movement.camera_speed);
  cameraSpeedValue.value = formatNumber(movement.camera_speed);
  mainCameraScaleRange.value = String(movement.main_camera_scale);
  mainCameraScaleValue.value = formatNumber(movement.main_camera_scale);
  mainCameraXOffsetRange.value = String(movement.main_camera_x_offset);
  mainCameraXOffsetValue.value = formatNumber(movement.main_camera_x_offset);
  mainCameraYOffsetRange.value = String(movement.main_camera_y_offset);
  mainCameraYOffsetValue.value = formatNumber(movement.main_camera_y_offset);
  stopFollowRange.value = String(movement.stop_follow_seconds);
  stopFollowValue.value = formatNumber(movement.stop_follow_seconds);
  wideShotScaleRange.value = String(movement.wide_shot_viewport_scale);
  wideShotScaleValue.value = formatNumber(movement.wide_shot_viewport_scale);
  wideShotYOffsetRange.value = String(movement.wide_shot_y_offset);
  wideShotYOffsetValue.value = formatNumber(movement.wide_shot_y_offset);
  wideShotChanceRange.value = String(movement.wide_shot_chance);
  wideShotChanceValue.value = formatNumber(movement.wide_shot_chance);
  runStartShotMinValue.value = formatNumber(movement.run_start_shot_scale_min);
  runStartShotMaxValue.value = formatNumber(movement.run_start_shot_scale_max);
  runStopShotMinValue.value = formatNumber(movement.run_stop_shot_scale_min);
  runStopShotMaxValue.value = formatNumber(movement.run_stop_shot_scale_max);
  runStopShotXOffsetRange.value = String(movement.run_stop_shot_x_offset);
  runStopShotXOffsetValue.value = formatNumber(movement.run_stop_shot_x_offset);
  suppressMovementEvents = false;
}

function renderAll() {
  if (!currentMap) return;
  ensureMovement(currentMap);
  ensureSpawnPoints(currentMap);
  mapJson.value = JSON.stringify(currentMap, null, 2);
  renderMovementControls();
  renderViewportFrame(currentMap);
  renderActorPosition(currentMap);
  renderRunLine(currentMap);
  renderObjects(currentMap);
  renderObjectList(currentMap);
  renderProps();
}

function pointerWorld(event) {
  const rect = mapCanvas.getBoundingClientRect();
  const world = worldSize(currentMap);
  return {
    x: ((event.clientX - rect.left) / rect.width) * world.width,
    y: ((event.clientY - rect.top) / rect.height) * world.height,
  };
}

function startDrag(event, id) {
  const item = (currentMap?.objects || []).find(candidate => candidate.id === id);
  if (!item) return;
  event.preventDefault();
  event.stopPropagation();
  selectObject(id);
  const pointer = pointerWorld(event);
  dragState = {
    id,
    offsetX: pointer.x - Number(item.x || 0),
    offsetY: pointer.y - Number(item.y || 0),
  };
  mapCanvas.setPointerCapture?.(event.pointerId);
}

function startRunLineDrag(event) {
  if (!currentMap) return;
  event.preventDefault();
  event.stopPropagation();
  selectedId = "__run_line__";
  dragState = { id: "__run_line__" };
  mapCanvas.setPointerCapture?.(event.pointerId);
  moveRunLineToPointer(event);
  renderAll();
}

function moveRunLineToPointer(event) {
  const pointer = pointerWorld(event);
  const world = worldSize(currentMap);
  const spawn = ensureSpawnPoints(currentMap);
  spawn.y = Math.round(clamp(pointer.y, 0, world.height));
}

function dragMove(event) {
  if (!dragState) return;
  if (dragState.id === "__run_line__") {
    moveRunLineToPointer(event);
    renderAll();
    return;
  }
  const item = selectedObject();
  if (!item || item.id !== dragState.id) return;
  const pointer = pointerWorld(event);
  item.x = Math.round(pointer.x - dragState.offsetX);
  item.y = Math.round(pointer.y - dragState.offsetY);
  renderAll();
}

function stopDrag() {
  dragState = null;
}

function selectObject(id) {
  selectedId = id || "";
  renderAll();
}

function syncPropsToObject(changedField = "") {
  if (suppressPropEvents) return;
  const item = selectedObject();
  if (!item) return;

  const oldW = Number(item.w || 1);
  const oldH = Number(item.h || 1);
  const ratio = oldW > 0 && oldH > 0 ? oldW / oldH : 1;
  item.name = propName.value.trim() || item.id;
  item.layer = propLayer.value;
  item.x = Number(propX.value || 0);
  item.y = Number(propY.value || 0);
  item.w = Math.max(1, Number(propW.value || 1));
  item.h = Math.max(1, Number(propH.value || 1));
  item.z = Number(propZ.value || 0);
  item.visible = propVisible.checked;
  item.lock_ratio = propLockRatio.checked;

  if (item.lock_ratio && changedField === "w") {
    item.h = Math.max(1, Math.round(item.w / ratio));
  } else if (item.lock_ratio && changedField === "h") {
    item.w = Math.max(1, Math.round(item.h * ratio));
  }
  renderAll();
}

function syncMovement(source, rawValue) {
  if (suppressMovementEvents || !currentMap) return;
  const movement = ensureMovement(currentMap);
  if (source === "speed") {
    movement.camera_speed = clamp(rawValue, 0.2, 4);
  } else if (source === "mainScale") {
    movement.main_camera_scale = clamp(rawValue, 1, 1.8);
  } else if (source === "mainXOffset") {
    movement.main_camera_x_offset = clamp(rawValue, -220, 220);
  } else if (source === "mainYOffset") {
    movement.main_camera_y_offset = clamp(rawValue, -240, 240);
  } else if (source === "stop") {
    movement.stop_follow_seconds = clamp(rawValue, 0, 4);
  } else if (source === "wideScale") {
    movement.wide_shot_viewport_scale = clamp(rawValue, 1, 1.75);
  } else if (source === "wideYOffset") {
    movement.wide_shot_y_offset = clamp(rawValue, -240, 240);
  } else if (source === "wideChance") {
    movement.wide_shot_chance = clamp(rawValue, 0, 1);
  } else if (source === "startShotMin") {
    movement.run_start_shot_scale_min = clamp(rawValue, 1, 2.6);
    if (movement.run_start_shot_scale_max < movement.run_start_shot_scale_min) {
      movement.run_start_shot_scale_max = movement.run_start_shot_scale_min;
    }
  } else if (source === "startShotMax") {
    movement.run_start_shot_scale_max = clamp(rawValue, 1, 2.6);
    if (movement.run_start_shot_scale_min > movement.run_start_shot_scale_max) {
      movement.run_start_shot_scale_min = movement.run_start_shot_scale_max;
    }
  } else if (source === "stopShotMin") {
    movement.run_stop_shot_scale_min = clamp(rawValue, 1, 2.6);
    if (movement.run_stop_shot_scale_max < movement.run_stop_shot_scale_min) {
      movement.run_stop_shot_scale_max = movement.run_stop_shot_scale_min;
    }
  } else if (source === "stopShotMax") {
    movement.run_stop_shot_scale_max = clamp(rawValue, 1, 2.6);
    if (movement.run_stop_shot_scale_min > movement.run_stop_shot_scale_max) {
      movement.run_stop_shot_scale_min = movement.run_stop_shot_scale_max;
    }
  } else if (source === "stopShotXOffset") {
    movement.run_stop_shot_x_offset = clamp(rawValue, 0, 180);
  }
  renderAll();
}

async function loadAssets() {
  const response = await fetch(assetsUrl(), { cache: "no-store" });
  const payload = await response.json();
  assets = Array.isArray(payload.assets) ? payload.assets : [];
  renderAssetCategories();
  renderAssetPicker();
}

function assetImageUrl(asset) {
  const path = typeof asset === "string" ? asset : asset?.asset || "";
  if (!path) return "";
  return path.startsWith("/") ? fileUrl(path) : `/assets/${path}`;
}

function assetCategory(asset) {
  return asset?.category || "Outros";
}

function renderAssetCategories() {
  const selected = assetCategorySelect.value || "";
  const categories = [...new Set(assets.map(assetCategory))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  assetCategorySelect.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = `Todas (${assets.length})`;
  assetCategorySelect.appendChild(all);
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = `${category} (${assets.filter(asset => assetCategory(asset) === category).length})`;
    assetCategorySelect.appendChild(option);
  }
  assetCategorySelect.value = categories.includes(selected) ? selected : "";
}

function filteredAssets() {
  const category = assetCategorySelect.value || "";
  const search = (assetSearch.value || "").trim().toLowerCase();
  return assets.filter(asset => {
    if (category && assetCategory(asset) !== category) return false;
    if (!search) return true;
    const haystack = `${asset.name || ""} ${asset.asset || ""} ${assetCategory(asset)}`.toLowerCase();
    return haystack.includes(search);
  });
}

function renderAssetPicker() {
  const visibleAssets = filteredAssets();
  const selectedAsset = assetSelect.value || "";
  assetSelect.replaceChildren();
  assetBrowser.replaceChildren();
  if (!visibleAssets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhum asset encontrado";
    assetSelect.appendChild(option);
    const empty = document.createElement("p");
    empty.className = "asset-empty";
    empty.textContent = assets.length ? "Nenhum asset nessa categoria/busca." : "Nenhum asset encontrado no avatar.";
    assetBrowser.appendChild(empty);
    return;
  }
  for (const asset of visibleAssets) {
    const option = document.createElement("option");
    option.value = asset.asset;
    option.textContent = `${assetCategory(asset)} / ${asset.name}`;
    assetSelect.appendChild(option);
  }
  if (visibleAssets.some(asset => asset.asset === selectedAsset)) {
    assetSelect.value = selectedAsset;
  }
  const activeAsset = assetSelect.value || "";

  for (const asset of visibleAssets) {
    const card = document.createElement("article");
    card.className = "asset-card";
    card.dataset.asset = asset.asset;

    const img = document.createElement("img");
    img.className = "asset-thumb";
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = asset.name || "";
    img.src = assetImageUrl(asset);

    const meta = document.createElement("div");
    meta.className = "asset-meta";
    const title = document.createElement("strong");
    title.textContent = asset.name || asset.asset;
    const subtitle = document.createElement("span");
    subtitle.textContent = assetCategory(asset);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Adicionar";
    button.addEventListener("click", event => {
      event.stopPropagation();
      addAssetObject(asset.asset);
    });

    meta.append(title, subtitle, button);
    card.append(img, meta);
    card.addEventListener("click", () => {
      assetSelect.value = asset.asset;
      renderAssetPicker();
    });
    if (activeAsset === asset.asset) {
      card.classList.add("active");
    }
    assetBrowser.appendChild(card);
  }
}

async function loadMap() {
  const response = await fetch(mapUrl(), { cache: "no-store" });
  currentMap = await response.json();
  if (!Array.isArray(currentMap.objects)) currentMap.objects = [];
  ensureMovement(currentMap);
  ensureSpawnPoints(currentMap);
  if (selectedId && !selectedObject()) selectedId = "";
  if (!selectedId && currentMap.objects.length) selectedId = currentMap.objects[0].id;
  renderAll();
}

async function saveMap() {
  if (!currentMap) return;
  const advancedJson = mapJson.value.trim();
  if (advancedJson) {
    try {
      currentMap = JSON.parse(advancedJson);
    } catch (err) {
      alert(`JSON invalido: ${err.message}`);
      return;
    }
  }
  const response = await fetch(mapUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentMap),
  });
  currentMap = await response.json();
  if (selectedId && !selectedObject()) selectedId = "";
  renderAll();
}

function assetMetaByPath(asset) {
  return assets.find(item => item.asset === asset) || null;
}

function logicalSizeForAsset(meta, fallbackW = 220, fallbackH = 160) {
  const vp = viewportOf(currentMap);
  const width = Number(meta?.width || 0);
  const height = Number(meta?.height || 0);
  if (width > 0 && height > 0) {
    return {
      w: Math.max(1, Math.round(width * vp.w / STAGE_WIDTH)),
      h: Math.max(1, Math.round(height * vp.h / STAGE_HEIGHT)),
    };
  }
  return { w: fallbackW, h: fallbackH };
}

function defaultLayerForAsset(asset) {
  const meta = typeof asset === "string" ? assetMetaByPath(asset) : asset;
  const text = `${meta?.category || ""} ${meta?.asset || ""} ${meta?.name || ""}`.toLowerCase();
  if (/piso|floor/.test(text)) return "floor";
  if (/sky|ceu|céu/.test(text)) return "sky";
  if (/far_bg|fundo distante/.test(text)) return "far_bg";
  if (/front_props|frente/.test(text)) return "front_props";
  if (/interactive|interativo/.test(text)) return "interactive";
  return "back_props";
}

function objectDefaults(asset, name = "") {
  const world = worldSize(currentMap);
  const meta = assetMetaByPath(asset);
  const size = logicalSizeForAsset(meta);
  return {
    id: `obj_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
    name: name || meta?.name || asset.split("/").pop() || "Objeto",
    layer: defaultLayerForAsset(meta || asset),
    asset,
    x: Math.round(world.width * 0.38),
    y: Math.round(world.height * 0.55),
    w: size.w,
    h: size.h,
    z: 0,
    visible: true,
    lock_ratio: true,
  };
}

function addAssetObject(assetPath = "") {
  if (!currentMap) return;
  const asset = assetPath || assetSelect.value || "";
  if (!asset) return;
  const object = objectDefaults(asset);
  currentMap.objects = currentMap.objects || [];
  currentMap.objects.push(object);
  selectObject(object.id);
}

function addFloor() {
  if (!currentMap) return;
  const floorAsset = assets.find(item => /piso/i.test(item.name))?.asset || assetSelect.value;
  if (!floorAsset) return;
  const world = worldSize(currentMap);
  const natural = logicalSizeForAsset(assetMetaByPath(floorAsset), Math.round(world.width * 1.9), Math.round(world.height * 0.24));
  const object = {
    ...objectDefaults(floorAsset, "Piso/base"),
    layer: "floor",
    x: -Math.round(world.width * 0.2),
    y: Math.round(world.height * 0.76),
    w: Math.round(world.width * 1.9),
    h: Math.max(Math.round(world.height * 0.24), natural.h),
    z: 0,
  };
  currentMap.objects = currentMap.objects || [];
  currentMap.objects.push(object);
  selectObject(object.id);
}

function duplicateObject() {
  const item = selectedObject();
  if (!item || !currentMap) return;
  const clone = {
    ...item,
    id: `obj_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
    name: `${item.name || item.id} copia`,
    x: Number(item.x || 0) + 32,
    y: Number(item.y || 0) + 22,
  };
  currentMap.objects.push(clone);
  selectObject(clone.id);
}

function deleteObject() {
  if (!selectedId || !currentMap) return;
  currentMap.objects = currentMap.objects.filter(item => item.id !== selectedId);
  selectedId = "";
  renderAll();
}

function nudgeSelected(dx, dy) {
  const item = selectedObject();
  if (!item) return;
  item.x = Number(item.x || 0) + dx;
  item.y = Number(item.y || 0) + dy;
  renderAll();
}

mapCanvas.addEventListener("click", () => selectObject(""));
mapCanvas.addEventListener("pointermove", dragMove);
mapCanvas.addEventListener("pointerup", stopDrag);
mapCanvas.addEventListener("pointercancel", stopDrag);
runLine.addEventListener("click", event => {
  event.preventDefault();
  event.stopPropagation();
  selectObject("__run_line__");
});
runLine.addEventListener("pointerdown", startRunLineDrag);
document.getElementById("loadMap").addEventListener("click", loadMap);
document.getElementById("saveMap").addEventListener("click", saveMap);
document.getElementById("addFloor").addEventListener("click", addFloor);
document.getElementById("addAssetObject").addEventListener("click", () => addAssetObject());
document.getElementById("refreshAssets").addEventListener("click", loadAssets);
document.getElementById("duplicateObject").addEventListener("click", duplicateObject);
document.getElementById("deleteObject").addEventListener("click", deleteObject);
assetCategorySelect.addEventListener("change", renderAssetPicker);
assetSearch.addEventListener("input", renderAssetPicker);
assetSelect.addEventListener("change", renderAssetPicker);

propName.addEventListener("input", () => syncPropsToObject("name"));
propLayer.addEventListener("change", () => syncPropsToObject("layer"));
propX.addEventListener("input", () => syncPropsToObject("x"));
propY.addEventListener("input", () => syncPropsToObject("y"));
propW.addEventListener("input", () => syncPropsToObject("w"));
propH.addEventListener("input", () => syncPropsToObject("h"));
propZ.addEventListener("input", () => syncPropsToObject("z"));
propVisible.addEventListener("change", () => syncPropsToObject("visible"));
propLockRatio.addEventListener("change", () => syncPropsToObject("lock_ratio"));
cameraSpeedRange.addEventListener("input", () => syncMovement("speed", cameraSpeedRange.value));
cameraSpeedValue.addEventListener("input", () => syncMovement("speed", cameraSpeedValue.value));
mainCameraScaleRange.addEventListener("input", () => syncMovement("mainScale", mainCameraScaleRange.value));
mainCameraScaleValue.addEventListener("input", () => syncMovement("mainScale", mainCameraScaleValue.value));
mainCameraXOffsetRange.addEventListener("input", () => syncMovement("mainXOffset", mainCameraXOffsetRange.value));
mainCameraXOffsetValue.addEventListener("input", () => syncMovement("mainXOffset", mainCameraXOffsetValue.value));
mainCameraYOffsetRange.addEventListener("input", () => syncMovement("mainYOffset", mainCameraYOffsetRange.value));
mainCameraYOffsetValue.addEventListener("input", () => syncMovement("mainYOffset", mainCameraYOffsetValue.value));
stopFollowRange.addEventListener("input", () => syncMovement("stop", stopFollowRange.value));
stopFollowValue.addEventListener("input", () => syncMovement("stop", stopFollowValue.value));
wideShotScaleRange.addEventListener("input", () => syncMovement("wideScale", wideShotScaleRange.value));
wideShotScaleValue.addEventListener("input", () => syncMovement("wideScale", wideShotScaleValue.value));
wideShotYOffsetRange.addEventListener("input", () => syncMovement("wideYOffset", wideShotYOffsetRange.value));
wideShotYOffsetValue.addEventListener("input", () => syncMovement("wideYOffset", wideShotYOffsetValue.value));
wideShotChanceRange.addEventListener("input", () => syncMovement("wideChance", wideShotChanceRange.value));
wideShotChanceValue.addEventListener("input", () => syncMovement("wideChance", wideShotChanceValue.value));
runStartShotMinValue.addEventListener("input", () => syncMovement("startShotMin", runStartShotMinValue.value));
runStartShotMaxValue.addEventListener("input", () => syncMovement("startShotMax", runStartShotMaxValue.value));
runStopShotMinValue.addEventListener("input", () => syncMovement("stopShotMin", runStopShotMinValue.value));
runStopShotMaxValue.addEventListener("input", () => syncMovement("stopShotMax", runStopShotMaxValue.value));
runStopShotXOffsetRange.addEventListener("input", () => syncMovement("stopShotXOffset", runStopShotXOffsetRange.value));
runStopShotXOffsetValue.addEventListener("input", () => syncMovement("stopShotXOffset", runStopShotXOffsetValue.value));
document.addEventListener("keydown", event => {
  const tag = document.activeElement?.tagName || "";
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  const step = event.shiftKey ? 10 : 1;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    nudgeSelected(-step, 0);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    nudgeSelected(step, 0);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    nudgeSelected(0, -step);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    nudgeSelected(0, step);
  } else if (event.key === "Delete") {
    event.preventDefault();
    deleteObject();
  }
});

setActorPreview();
Promise.all([loadAssets(), loadMap()]).catch(err => {
  console.error(err);
  alert(`Erro ao carregar editor: ${err.message}`);
});
