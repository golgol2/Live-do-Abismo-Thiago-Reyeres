(() => {
  const registry = window.BonecoLayoutRegistry;

  if (!registry) {
    console.error(
      "BonecoLayoutRegistry ausente para orbital_cathedral."
    );
    return;
  }

  const LAYOUT_W = 360;
  const LAYOUT_H = 640;

  let layoutCanvas = null;
  let layoutOverlayCanvas = null;
  let layoutCtx = null;
  let layoutOverlayCtx = null;
  let musicEnergy = 0;
  let musicBass = 0;
  let visualHue = 144;
  let visualPeople = [];
  let visualImageEntry = () => null;
  let drawVisualProfile = () => false;
  let mediaImageUrl = value => String(value || "");
  let isLayoutVisualMode = () => true;
  let liveCamera = { currentZoom: 1 };
  let orbitalCubeLayer = null;

  function randomBetween(min, max) {
    return Number(min || 0) + Math.random() * (Number(max || 0) - Number(min || 0));
  }

  function ensureSuperCubeLayer(context = {}) {
    const existing =
      orbitalCubeLayer ||
      document.getElementById("orbitalSuperCubeLayer");

    if (existing) {
      orbitalCubeLayer = existing;
      return existing;
    }

    const layer = document.createElement("div");
    layer.id = "orbitalSuperCubeLayer";
    layer.className = "orbital-cube-layer";
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");

    const glow = document.createElement("div");
    glow.className = "orbital-cube-glow";

    const cube = document.createElement("div");
    cube.id = "orbitalSuperCube";
    cube.className = "orbital-cube";

    for (const [index, name] of [
      "front",
      "back",
      "right",
      "left",
      "top",
      "bottom",
    ].entries()) {
      const face = document.createElement("div");
      face.className = `orbital-cube-face orbital-cube-${name}`;
      face.dataset.face = String(index);
      cube.appendChild(face);
    }

    const caption = document.createElement("div");
    caption.className = "orbital-cube-caption";

    const captionName = document.createElement("strong");
    captionName.id = "orbitalSuperCubeName";
    captionName.textContent = "TOP PRESENTES";

    const captionScore = document.createElement("span");
    captionScore.id = "orbitalSuperCubeScore";
    captionScore.textContent = "aguardando presentes";

    caption.append(captionName, captionScore);
    layer.append(glow, cube, caption);

    const parent =
      context?.cameraLayer ||
      context?.stage ||
      document.getElementById("cameraLayer") ||
      document.getElementById("stage") ||
      document.body;

    if (context?.world && context.world.parentElement === parent) {
      parent.insertBefore(layer, context.world);
    } else {
      parent.appendChild(layer);
    }

    orbitalCubeLayer = layer;
    return layer;
  }

  function destroySuperCubeLayer() {
    const layer =
      orbitalCubeLayer ||
      document.getElementById("orbitalSuperCubeLayer");

    if (layer) {
      layer.remove();
    }

    orbitalCubeLayer = null;
    socialGiftCubeSignature = "";
  }

  function syncContext(context, state = {}) {
    layoutCanvas = context?.layoutCanvas || null;
    layoutOverlayCanvas = context?.layoutOverlayCanvas || null;
    layoutCtx = context?.layoutCtx || null;
    layoutOverlayCtx = context?.layoutOverlayCtx || null;
    visualImageEntry = context?.visualImageEntry || (() => null);
    drawVisualProfile = context?.drawVisualProfile || (() => false);
    mediaImageUrl = context?.mediaImageUrl || (value => String(value || ""));
    isLayoutVisualMode = context?.isLayoutVisualMode || (() => true);
    liveCamera = context?.getCameraState?.() || { currentZoom: 1 };

    const music = context?.getMusicState?.() || {};
    musicEnergy = Number(state.musicEnergy ?? music.musicEnergy ?? 0);
    musicBass = Number(state.musicBass ?? music.musicBass ?? 0);
    visualHue = Number(state.visualHue ?? music.visualHue ?? 144);
    visualPeople = Array.isArray(state.visualPeople)
      ? state.visualPeople
      : (context?.getVisualPeople?.() || []);
  }

let orbitalCubeMotion = {
  currentX: 0,
  targetX: 0,
  currentY: 0,
  targetY: 0,
  nextDecisionAt: 0,
  lastFrameAt: 0,
  phase: Math.random() * Math.PI * 2,
};

function chooseNextSuperCubePosition(now = performance.now()) {
  const nearCenter = Math.random() < 0.28;
  orbitalCubeMotion.targetX = nearCenter
    ? randomBetween(-28, 28)
    : randomBetween(-130, 130);
  orbitalCubeMotion.targetY = randomBetween(-28, 38);
  orbitalCubeMotion.nextDecisionAt = now + randomBetween(2800, 6200);
}

function updateSuperCubeMotion(now) {
  const layer =
    orbitalCubeLayer ||
    document.getElementById("orbitalSuperCubeLayer");
  if (!layer || layer.hidden) {
    orbitalCubeMotion.lastFrameAt = now;
    return;
  }

  if (!orbitalCubeMotion.nextDecisionAt || now >= orbitalCubeMotion.nextDecisionAt) {
    chooseNextSuperCubePosition(now);
  }

  if (!orbitalCubeMotion.lastFrameAt) orbitalCubeMotion.lastFrameAt = now;

  const dt = Math.min(
    0.08,
    Math.max(0.001, (now - orbitalCubeMotion.lastFrameAt) / 1000)
  );
  orbitalCubeMotion.lastFrameAt = now;

  const smoothing = 1 - Math.exp(-dt * 1.05);
  orbitalCubeMotion.currentX +=
    (orbitalCubeMotion.targetX - orbitalCubeMotion.currentX) * smoothing;
  orbitalCubeMotion.currentY +=
    (orbitalCubeMotion.targetY - orbitalCubeMotion.currentY) * smoothing;

  const t = now * 0.001;
  const bob =
    Math.sin(t * 1.18 + orbitalCubeMotion.phase) * 5.5 +
    Math.sin(t * 0.47 + orbitalCubeMotion.phase * 0.6) * 2.5;

  layer.style.setProperty(
    "--orbital-cube-x",
    `${orbitalCubeMotion.currentX.toFixed(2)}px`
  );
  layer.style.setProperty(
    "--orbital-cube-y",
    `${(orbitalCubeMotion.currentY + bob).toFixed(2)}px`
  );
}

const distantFloorSnapshot = document.createElement("canvas");
distantFloorSnapshot.width = LAYOUT_W;
distantFloorSnapshot.height = LAYOUT_H;
const distantFloorSnapshotCtx = distantFloorSnapshot.getContext("2d", { alpha: true });

function drawRepeatedDistantLayer(canvas, ctx, snapshot, snapshotCtx, zoom) {
  if (!canvas || !ctx || !snapshot || !snapshotCtx) return;

  const w = canvas.width;
  const h = canvas.height;
  const s = Math.max(0.60, Math.min(1, Number(zoom || 1)));

  snapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
  snapshotCtx.clearRect(0, 0, w, h);
  snapshotCtx.drawImage(canvas, 0, 0, w, h);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // A perspectiva recua ancorada no centro do chão.
  // Isso mantém os pés do Boneco visualmente presos ao piso.
  ctx.save();
  ctx.translate(w * 0.5, h);
  ctx.scale(s, s);
  ctx.translate(-w * 0.5, -h);

  // Multiplica a cena para esquerda/direita conforme abrimos o campo de visão.
  // Cinco cópias cobrem até o limite distante mínimo atual.
  for (let copy = -2; copy <= 2; copy += 1) {
    ctx.save();

    // Espelhamento alternado evita uma emenda dura nas bordas.
    if (Math.abs(copy) % 2 === 1) {
      const tileCenter = copy * w + w * 0.5;
      ctx.translate(tileCenter, 0);
      ctx.scale(-1, 1);
      ctx.translate(-tileCenter, 0);
    }

    ctx.drawImage(snapshot, copy * w, 0, w, h);
    ctx.restore();
  }

  ctx.restore();
}


function applyDistantSceneryPerspective() {
  if (!isLayoutVisualMode()) return;

  const zoom = Number(liveCamera.currentZoom || 1);
  if (zoom >= 0.999) return;

  if (
    layoutOverlayCanvas &&
    layoutOverlayCtx &&
    distantFloorSnapshot &&
    distantFloorSnapshotCtx
  ) {
    drawRepeatedDistantLayer(
      layoutOverlayCanvas,
      layoutOverlayCtx,
      distantFloorSnapshot,
      distantFloorSnapshotCtx,
      zoom
    );
  }
}

function randomBetween(min, max) {
  const a = Number(min), b = Number(max);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (b <= a) return a;
  return a + Math.random() * (b - a);
}

function randomIntInclusive(min, max) {
  return Math.round(randomBetween(Math.ceil(min), Math.floor(max)));
}

let socialGiftCubeSignature = "";

function socialCubeInitials(item) {
  const label = String(
    item?.display_name ||
    item?.username ||
    "?"
  ).trim();

  if (!label) return "?";

  const parts = label.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return (
      String(parts[0][0] || "") +
      String(parts[parts.length - 1][0] || "")
    ).toUpperCase();
  }

  return label.slice(0, 2).toUpperCase();
}

function socialCubeProfile(item) {
  return String(
    item?.profile_image ||
    item?.avatar_url ||
    ""
  ).trim();
}

function createSocialCubeTile(item) {
  const tile = document.createElement("div");
  tile.className = "orbital-cube-tile";

  const profile = socialCubeProfile(item);

  if (profile) {
    const img = document.createElement("img");
    img.className = "orbital-cube-tile-image";
    img.alt = "";
    img.decoding = "async";
    img.src = mediaImageUrl(profile);
    tile.appendChild(img);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "orbital-cube-tile-fallback";
    fallback.textContent = socialCubeInitials(item);
    tile.appendChild(fallback);
  }

  return tile;
}

function fillSocialCubeFace(face, items) {
  face.replaceChildren();
  face.classList.remove("orbital-cube-face-leader");

  const grid = document.createElement("div");
  grid.className = "orbital-cube-grid";

  for (let i = 0; i < 36; i += 1) {
    const item = items[i];

    if (item) {
      grid.appendChild(createSocialCubeTile(item));
    } else {
      const empty = document.createElement("div");
      empty.className = "orbital-cube-tile orbital-cube-tile-empty";
      grid.appendChild(empty);
    }
  }

  face.appendChild(grid);
}

function fillSocialCubeLeaderFace(face, leader) {
  face.replaceChildren();
  face.classList.add("orbital-cube-face-leader");

  const wrap = document.createElement("div");
  wrap.className = "orbital-cube-leader";

  const profile = socialCubeProfile(leader);

  if (profile) {
    const img = document.createElement("img");
    img.className = "orbital-cube-leader-image";
    img.alt = "";
    img.decoding = "async";
    img.src = mediaImageUrl(profile);
    wrap.appendChild(img);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "orbital-cube-leader-fallback";
    fallback.textContent = socialCubeInitials(leader);
    wrap.appendChild(fallback);
  }

  const badge = document.createElement("div");
  badge.className = "orbital-cube-leader-badge";

  const strong = document.createElement("strong");
  strong.textContent = String(
    leader?.display_name ||
    leader?.username ||
    "TOP"
  );

  const span = document.createElement("span");
  span.textContent =
    `${Math.max(
      1,
      Number(leader?.total_count || leader?.count || 1)
    )} presentes`;

  badge.append(strong, span);
  wrap.appendChild(badge);
  face.appendChild(wrap);
}

function syncSocialGiftCube(
  board,
  style = "",
  fallbackLeader = null,
  context = {}
) {
  const layer = ensureSuperCubeLayer(context);
  const cube = layer.querySelector("#orbitalSuperCube");

  if (!layer || !cube) {
    console.warn("social gift cube: HTML ausente");
    return;
  }

  const list = Array.isArray(board)
    ? board.filter(
        item =>
          item &&
          Number(item.total_count || item.count || 0) > 0
      )
    : [];

  let effective = list;

  if (!effective.length && fallbackLeader) {
    effective = [fallbackLeader];
  }

  const previewMode =
    new URLSearchParams(window.location.search)
      .get("preview") === "1";

  if (!isLayoutVisualMode() || (!effective.length && !previewMode)) {
    layer.hidden = true;
    socialGiftCubeSignature = "";
    return;
  }

  if (!effective.length && previewMode) {
    effective = [{
      username: "teste",
      display_name: "SUPER CUBO",
      total_count: 1,
    }];
  }

  const leader = effective[0];
  const others = effective.slice(1, 181);

  layer.hidden = false;

  const faces = Array.from(
    cube.querySelectorAll(".orbital-cube-face")
  );

  if (faces.length !== 6) {
    console.warn(
      "social gift cube: esperado 6 faces, encontrado",
      faces.length
    );
    return;
  }

  const signature = JSON.stringify(
    effective.slice(0, 181).map(item => [
      item.username || "",
      item.display_name || "",
      item.total_count || item.count || 0,
      item.profile_image || item.avatar_url || "",
    ])
  );

  if (signature !== socialGiftCubeSignature) {
    socialGiftCubeSignature = signature;

    fillSocialCubeLeaderFace(faces[0], leader);

    for (let faceIndex = 1; faceIndex < 6; faceIndex += 1) {
      const start = (faceIndex - 1) * 36;

      fillSocialCubeFace(
        faces[faceIndex],
        others.slice(start, start + 36)
      );
    }
  }

  const name = document.getElementById("orbitalSuperCubeName");
  const score = document.getElementById("orbitalSuperCubeScore");

  if (name) {
    name.textContent = String(
      leader?.display_name ||
      leader?.username ||
      "TOP PRESENTES"
    );
  }

  if (score) {
    score.textContent =
      `${Math.max(
        1,
        Number(leader?.total_count || leader?.count || 1)
      )} presentes - ${effective.length} apoiadores`;
  }
}

function orbitalCubeInitials(item) {
  const label = String(
    item?.display_name ||
    item?.displayName ||
    item?.username ||
    "?"
  ).trim();

  if (!label) return "?";

  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (
      String(parts[0][0] || "") +
      String(parts[parts.length - 1][0] || "")
    ).toUpperCase();
  }

  return label.slice(0, 2).toUpperCase();
}


function orbitalCubeProfileUrl(item) {
  return String(
    item?.profile_image ||
    item?.avatar_url ||
    item?.profileImage ||
    ""
  ).trim();
}

function createSuperCubeCell(item, { leader = false, empty = false } = {}) {
  const cell = document.createElement("div");
  cell.className = "orbital-cube-cell";
  if (leader) cell.classList.add("is-leader");
  if (empty) {
    cell.classList.add("is-empty");
    return cell;
  }

  const label = String(
    item?.display_name ||
    item?.displayName ||
    item?.username ||
    "?"
  ).trim();

  const total = Math.max(
    0,
    Math.round(Number(item?.total_count || item?.count || 0))
  );

  const profile = orbitalCubeProfileUrl(item);
  if (profile) {
    const img = document.createElement("img");
    img.className = "orbital-cube-cell-image";
    img.alt = "";
    img.decoding = "async";
    img.src = mediaImageUrl(profile);
    cell.appendChild(img);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "orbital-cube-cell-fallback";
    fallback.textContent = orbitalCubeInitials(item);
    cell.appendChild(fallback);
  }

  cell.title = total > 0 ? `${label} - ${total}` : label;

  if (leader) {
    const badge = document.createElement("span");
    badge.className = "orbital-cube-leader-badge";
    badge.textContent = total > 0 ? `${total}` : "TOP";
    cell.appendChild(badge);
  }

  return cell;
}

function renderSuperCubeFace(face, people, leader = null) {
  if (!face) return;

  const grid =
    face.querySelector(".orbital-cube-face-grid") ||
    (() => {
      const node = document.createElement("div");
      node.className = "orbital-cube-face-grid";
      face.replaceChildren(node);
      return node;
    })();

  grid.replaceChildren();
  face.classList.toggle("is-leader-face", Boolean(leader));

  if (leader) {
    grid.appendChild(
      createSuperCubeCell(leader, { leader: true })
    );
    return;
  }

  const entries = Array.isArray(people) ? people.slice(0, 36) : [];
  for (let index = 0; index < 36; index += 1) {
    const item = entries[index];
    grid.appendChild(
      item
        ? createSuperCubeCell(item)
        : createSuperCubeCell(null, { empty: true })
    );
  }
}

function syncSuperCube(board, style = "") {
  const layer =
    orbitalCubeLayer ||
    document.getElementById("orbitalSuperCubeLayer");

  if (!layer) return;

  const cleanStyle = String(style || "").trim();
  const isOrbital = cleanStyle === "orbital_cathedral";

  let ranking = Array.isArray(board)
    ? board.filter(item => item && typeof item === "object")
    : [];

  ranking = ranking
    .slice()
    .sort((a, b) => {
      const totalDiff =
        Number(b?.total_count || 0) - Number(a?.total_count || 0);
      if (totalDiff) return totalDiff;
      const eventDiff =
        Number(b?.gift_events || 0) - Number(a?.gift_events || 0);
      if (eventDiff) return eventDiff;
      return Number(b?.updated_at || 0) - Number(a?.updated_at || 0);
    })
    .slice(0, 181);

  const previewMode =
    new URLSearchParams(window.location.search).get("preview") === "1";

  if (!isOrbital || (!ranking.length && !previewMode)) {
    layer.hidden = true;
    return;
  }

  layer.hidden = false;

  const leader = ranking[0] || {
    display_name: "TOP PRESENTES",
    username: "TOP",
    total_count: 0,
    gift_events: 0,
  };

  const others = ranking.slice(1, 181);

  const faces = [
    layer.querySelector(".orbital-cube-front"),
    layer.querySelector(".orbital-cube-back"),
    layer.querySelector(".orbital-cube-right"),
    layer.querySelector(".orbital-cube-left"),
    layer.querySelector(".orbital-cube-top"),
    layer.querySelector(".orbital-cube-bottom"),
  ];

  renderSuperCubeFace(faces[0], [], leader);

  for (let faceIndex = 1; faceIndex < faces.length; faceIndex += 1) {
    const start = (faceIndex - 1) * 36;
    renderSuperCubeFace(
      faces[faceIndex],
      others.slice(start, start + 36),
      null
    );
  }

  const name = document.getElementById("orbitalSuperCubeName");
  const score = document.getElementById("orbitalSuperCubeScore");

  const label = String(
    leader?.display_name ||
    leader?.username ||
    "TOP PRESENTES"
  ).trim();

  const total = Math.max(
    0,
    Math.round(Number(leader?.total_count || 0))
  );

  if (name) {
    name.textContent = previewMode && !ranking.length
      ? "SUPER CUBO - TESTE"
      : label || "TOP PRESENTES";
  }

  if (score) {
    score.textContent = previewMode && !ranking.length
      ? "aguardando presentes"
      : `${total} presente${total === 1 ? "" : "s"} - lider`;
  }
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

function visualRingPoint(anchor, center, scale, wobble) {
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

function drawActiveLayoutRing(ctx, anchors, center, scale, hue, alpha, width, time, index) {
  const wobbleAmp = 0.8 + scale * 1.25;
  const points = anchors.map((anchor, pos) => visualRingPoint(anchor, center, scale, {
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

function drawActiveLayoutDepthLines(ctx, center, hue, power, time, wallOrbit) {
  const outer = { left: -20, top: -20, right: LAYOUT_W + 20, bottom: LAYOUT_H + 20 };
  const innerW = 34 + power * 20;
  const innerH = 56 + power * 28;
  const inner = {
    left: center.x - innerW,
    top: center.y - innerH,
    right: center.x + innerW,
    bottom: center.y + innerH,
  };
  const count = 38;
  const maxPhotoSlots = Math.min(10, visualPeople.length);
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
    const person = personSlot ? visualPeople[Math.floor(i / photoEvery) % visualPeople.length] : null;
    const perspective = 1 - travel;
    const photoRadius = (person?.weight > 1 ? 8.5 : 7.2) + perspective * 12 + power * 2.8;
    const photoAlpha = 0.28 + perspective * 0.45 + power * 0.18;
    if (!person || !drawVisualProfile(ctx, person, sparkX, sparkY, photoRadius, localHue + 24, photoAlpha)) {
      ctx.fillStyle = `hsla(${localHue + 24}, 100%, 78%, ${0.16 + power * 0.2})`;
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, 1.8 + power * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
function drawOrbitalFloorOverlay(timeMs = performance.now()) {
  if (!layoutOverlayCtx || !layoutOverlayCanvas) return;

  const ctx = layoutOverlayCtx;
  const w = LAYOUT_W;
  const h = LAYOUT_H;
  const time = Number(timeMs || 0) * 0.001;
  const energy = Math.max(0, Math.min(1, Number(musicEnergy || 0)));
  const bass = Math.max(0, Math.min(1, Number(musicBass || 0)));

  const floorHorizonY = h * 0.675;
  const floorBottom = h * 1.035;
  const cx = w * 0.5;
  const rows = 11;
  const cols = 7;
  const beatStep = Math.floor(time * (0.45 + bass * 1.35));

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // Máscara/base totalmente opaca.
  const base = ctx.createLinearGradient(0, floorHorizonY, 0, h);
  base.addColorStop(0, "#03060e");
  base.addColorStop(0.18, "#02040a");
  base.addColorStop(1, "#000003");

  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(cx - 36, floorHorizonY);
  ctx.lineTo(cx + 36, floorHorizonY);
  ctx.lineTo(w * 1.10, floorBottom);
  ctx.lineTo(w * -0.10, floorBottom);
  ctx.closePath();
  ctx.fill();

  const people = Array.isArray(visualPeople) ? visualPeople : [];
  const giftPeople = people
    .filter(person =>
      Number(person?.weight || 1) > 1 &&
      String(person?.profile || "").trim()
    )
    .slice(0, 14);

  const slots = [];
  for (let row = 2; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if ((row * 3 + col * 5) % 4 === 0) {
        slots.push({ row, col });
      }
    }
  }

  const giftTileMap = new Map();
  for (let i = 0; i < Math.min(giftPeople.length, slots.length); i += 1) {
    giftTileMap.set(`${slots[i].row}:${slots[i].col}`, giftPeople[i]);
  }

  function tilePath(x00, y0, x01, x11, y1, x10) {
    ctx.beginPath();
    ctx.moveTo(x00, y0);
    ctx.lineTo(x01, y0);
    ctx.lineTo(x11, y1);
    ctx.lineTo(x10, y1);
    ctx.closePath();
  }

  function drawPersonTile(person, x00, y0, x01, x11, y1, x10, hue) {
    const entry = visualImageEntry(person?.profile);
    if (!entry) return false;

    const img = entry.img;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return false;

    const side = Math.min(iw, ih);
    const sx = (iw - side) * 0.5;
    const sy = (ih - side) * 0.5;

    const minX = Math.min(x00, x01, x10, x11);
    const maxX = Math.max(x00, x01, x10, x11);
    const minY = y0;
    const maxY = y1;

    ctx.save();
    tilePath(x00, y0, x01, x11, y1, x10);
    ctx.clip();

    // Somente a FOTO possui transparência.
    ctx.globalAlpha = 0.34 + energy * 0.10;
    ctx.drawImage(
      img,
      sx, sy, side, side,
      minX, minY,
      Math.max(1, maxX - minX),
      Math.max(1, maxY - minY)
    );

    ctx.globalAlpha = 1;
    ctx.fillStyle = `hsla(${hue},92%,48%,0.30)`;
    ctx.fillRect(
      minX, minY,
      Math.max(1, maxX - minX),
      Math.max(1, maxY - minY)
    );

    const shade = ctx.createLinearGradient(0, minY, 0, maxY);
    shade.addColorStop(0, "rgba(0,0,0,.02)");
    shade.addColorStop(1, "rgba(0,0,0,.26)");
    ctx.fillStyle = shade;
    ctx.fillRect(
      minX, minY,
      Math.max(1, maxX - minX),
      Math.max(1, maxY - minY)
    );

    ctx.restore();
    return true;
  }

  function drawMotif(cxTile, cyTile, tileW, tileH, seed, hue, weak = false) {
    const mode = Math.abs(seed) % 8;
    const size = Math.max(3.5, Math.min(tileW, tileH) * 0.20);

    ctx.save();
    ctx.globalAlpha = weak ? 0.12 : 0.32 + energy * 0.18;
    ctx.lineWidth = Math.max(0.7, size * 0.12);
    ctx.strokeStyle = `hsla(${(hue + 115) % 360},100%,86%,.95)`;
    ctx.fillStyle = `hsla(${(hue + 115) % 360},100%,86%,.90)`;

    if (mode === 0) {
      ctx.beginPath();
      ctx.arc(cxTile, cyTile, size, 0, Math.PI * 2);
      ctx.stroke();
    } else if (mode === 1) {
      ctx.beginPath();
      ctx.moveTo(cxTile, cyTile - size);
      ctx.lineTo(cxTile + size * 0.92, cyTile + size * 0.82);
      ctx.lineTo(cxTile - size * 0.92, cyTile + size * 0.82);
      ctx.closePath();
      ctx.stroke();
    } else if (mode === 2) {
      ctx.beginPath();
      ctx.moveTo(cxTile, cyTile - size);
      ctx.lineTo(cxTile + size, cyTile);
      ctx.lineTo(cxTile, cyTile + size);
      ctx.lineTo(cxTile - size, cyTile);
      ctx.closePath();
      ctx.stroke();
    } else if (mode === 3) {
      ctx.strokeRect(
        cxTile - size * 0.84,
        cyTile - size * 0.84,
        size * 1.68,
        size * 1.68
      );
    } else if (mode === 4) {
      const glyphs = ["✨", "🔥", "💎", "😀"];
      ctx.font = `${Math.max(9, size * 1.55)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyphs[Math.abs(seed) % glyphs.length], cxTile, cyTile);
    } else {
      ctx.beginPath();
      ctx.arc(cxTile, cyTile, size * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  for (let row = 0; row < rows; row += 1) {
    const p0 = row / rows;
    const p1 = (row + 1) / rows;

    const y0 =
      floorHorizonY +
      Math.pow(p0, 1.78) * (floorBottom - floorHorizonY);
    const y1 =
      floorHorizonY +
      Math.pow(p1, 1.78) * (floorBottom - floorHorizonY);

    const half0 = 36 + Math.pow(p0, 1.14) * w * 0.60;
    const half1 = 36 + Math.pow(p1, 1.14) * w * 0.60;

    for (let col = 0; col < cols; col += 1) {
      const u0 = col / cols;
      const u1 = (col + 1) / cols;

      const x00 = cx - half0 + half0 * 2 * u0;
      const x01 = cx - half0 + half0 * 2 * u1;
      const x10 = cx - half1 + half1 * 2 * u0;
      const x11 = cx - half1 + half1 * 2 * u1;

      const seed = row * 47 + col * 83 + beatStep * 29;
      const hue = (seed * 17 + visualHue + bass * 64) % 360;
      const light =
        27 +
        energy * 24 +
        ((row + col + beatStep) % 3) * 4;

      tilePath(x00, y0, x01, x11, y1, x10);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `hsl(${hue},88%,${light}%)`;
      ctx.fill();

      const person = giftTileMap.get(`${row}:${col}`) || null;
      if (person) {
        drawPersonTile(person, x00, y0, x01, x11, y1, x10, hue);
      }

      tilePath(x00, y0, x01, x11, y1, x10);
      ctx.strokeStyle = `rgba(255,255,255,${0.055 + energy * 0.075})`;
      ctx.lineWidth = 0.55;
      ctx.stroke();

      const cxTile = (x00 + x01 + x10 + x11) * 0.25;
      const cyTile = (y0 + y0 + y1 + y1) * 0.25;
      const tileW = Math.abs((x01 - x00) + (x11 - x10)) * 0.5;
      const tileH = Math.abs(y1 - y0);

      drawMotif(
        cxTile, cyTile, tileW, tileH,
        seed, hue, Boolean(person)
      );
    }
  }

  const reflection = ctx.createLinearGradient(0, floorHorizonY, 0, h);
  reflection.addColorStop(
    0,
    `hsla(${195 + visualHue * 0.08},100%,58%,${0.08 + energy * 0.04})`
  );
  reflection.addColorStop(0.22, "rgba(0,0,0,0)");
  reflection.addColorStop(1, "rgba(0,0,0,.18)");
  ctx.fillStyle = reflection;
  ctx.fillRect(0, floorHorizonY, w, h - floorHorizonY);

  ctx.restore();
}

function drawOrbitalCathedral(timeMs = performance.now()) {
  if (!layoutCtx || !layoutCanvas) return;

  const ctx = layoutCtx;
  const w = LAYOUT_W;
  const h = LAYOUT_H;
  const time = Number(timeMs || 0) * 0.001;
  const energy = Math.max(0, Math.min(1, Number(musicEnergy || 0)));
  const bass = Math.max(0, Math.min(1, Number(musicBass || 0)));

  // O ponto de fuga do túnel coincide com o fim/horizonte do piso.
  const floorHorizonY = h * 0.675;
  const cx = w * 0.5;
  const cy = floorHorizonY;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // ============================================================
  // 1. FUNDO PLASMA ANIMADO, PUXADO PARA O PRETO.
  // ============================================================
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#010105";
  ctx.fillRect(0, 0, w, h);

  const plasmaSpots = [
    { ax: 0.23, ay: 0.18, rx: 0.34, ry: 0.26, phase: 0.0, hue: 286 },
    { ax: 0.78, ay: 0.24, rx: 0.30, ry: 0.23, phase: 1.7, hue: 188 },
    { ax: 0.18, ay: 0.52, rx: 0.38, ry: 0.30, phase: 3.1, hue: 330 },
    { ax: 0.80, ay: 0.56, rx: 0.35, ry: 0.28, phase: 4.4, hue: 155 },
    { ax: 0.50, ay: 0.40, rx: 0.42, ry: 0.34, phase: 5.6, hue: 225 },
  ];

  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < plasmaSpots.length; i += 1) {
    const spot = plasmaSpots[i];
    const slow = time * (0.055 + i * 0.006);
    const px = w * (
      spot.ax +
      Math.sin(slow + spot.phase) * (0.07 + energy * 0.025)
    );
    const py = h * (
      spot.ay +
      Math.cos(slow * 0.83 + spot.phase) * (0.055 + bass * 0.020)
    );
    const radius = Math.max(w * spot.rx, h * spot.ry);
    const hue = (
      spot.hue +
      visualHue * 0.16 +
      Math.sin(time * 0.10 + spot.phase) * 28
    ) % 360;

    const plasma = ctx.createRadialGradient(px, py, 0, px, py, radius);
    plasma.addColorStop(
      0,
      `hsla(${hue},100%,58%,${0.10 + energy * 0.10})`
    );
    plasma.addColorStop(
      0.28,
      `hsla(${hue + 28},100%,44%,${0.075 + energy * 0.075})`
    );
    plasma.addColorStop(
      0.62,
      `hsla(${hue + 62},92%,28%,${0.026 + energy * 0.040})`
    );
    plasma.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = plasma;
    ctx.fillRect(0, 0, w, h);
  }

  // Faixas orgânicas suaves para dar aparência de plasma esticado.
  for (let band = 0; band < 7; band += 1) {
    const phase = time * (0.035 + band * 0.002) + band * 0.93;
    const x = cx + Math.sin(phase) * w * (0.20 + band * 0.016);
    const y = h * (0.12 + band * 0.085) + Math.cos(phase * 0.78) * 22;
    const rx = w * (0.28 + band * 0.015);
    const ry = 34 + band * 7 + energy * 18;
    const hue = (190 + band * 31 + visualHue * 0.10) % 360;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(phase * 0.43) * 0.28);
    const streak = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    streak.addColorStop(
      0,
      `hsla(${hue},100%,62%,${0.030 + energy * 0.042})`
    );
    streak.addColorStop(0.46, `hsla(${hue + 34},100%,42%,0.018)`);
    streak.addColorStop(1, "rgba(0,0,0,0)");
    ctx.scale(1, ry / rx);
    ctx.fillStyle = streak;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Preto nas bordas: o plasma sempre "morre" no escuro.
  ctx.globalCompositeOperation = "source-over";
  const plasmaVignette = ctx.createRadialGradient(
    cx, h * 0.42, h * 0.12,
    cx, h * 0.42, h * 0.76
  );
  plasmaVignette.addColorStop(0, "rgba(0,0,0,0)");
  plasmaVignette.addColorStop(0.55, "rgba(0,0,0,.04)");
  plasmaVignette.addColorStop(0.82, "rgba(0,0,0,.30)");
  plasmaVignette.addColorStop(1, "rgba(0,0,0,.72)");
  ctx.fillStyle = plasmaVignette;
  ctx.fillRect(0, 0, w, h);

  // ============================================================
  // 2. TÚNEL / ANÉIS: CENTRO NO FIM DO PISO.
  // ============================================================
  ctx.globalCompositeOperation = "lighter";

  const ringCount = 13;
  const ringSegments = 28;
  const ringFlow = time * (15 + energy * 22);
  const ringDrift = time * (0.009 + energy * 0.007);
  const pulse =
    1 +
    Math.sin(time * (0.82 + bass * 1.05)) *
      (0.014 + bass * 0.050);

  for (let ring = 0; ring < ringCount; ring += 1) {
    const depth = (ring / ringCount + ringDrift) % 1;
    const radius = (13 + depth * h * 0.60) * pulse;
    const ry = radius * (0.72 + depth * 0.23);
    const alpha =
      0.18 + (1 - depth) * (0.34 + energy * 0.25);
    const width =
      2.4 +
      energy * 3.8 +
      bass * 2.0 +
      (1 - depth) * 1.9;

    for (let seg = 0; seg < ringSegments; seg += 1) {
      const a0 = (seg / ringSegments) * Math.PI * 2;
      const a1 = ((seg + 0.91) / ringSegments) * Math.PI * 2;
      const hue = (
        ringFlow * 36 +
        seg * (360 / ringSegments) +
        ring * 20 +
        visualHue * 0.16
      ) % 360;

      ctx.strokeStyle = `hsla(${hue},100%,67%,${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, ry, 0, a0, a1);
      ctx.stroke();

      ctx.strokeStyle =
        `rgba(255,255,255,${alpha * (0.14 + energy * 0.19)})`;
      ctx.lineWidth = Math.max(0.9, width * 0.17);
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, ry, 0, a0, a1);
      ctx.stroke();
    }
  }

  // Halo do ponto de fuga.
  const vanishingHalo = ctx.createRadialGradient(
    cx, cy, 0,
    cx, cy, 62 + bass * 20
  );
  vanishingHalo.addColorStop(
    0,
    `rgba(255,255,255,${0.13 + bass * 0.12})`
  );
  vanishingHalo.addColorStop(
    0.22,
    `hsla(${195 + visualHue * 0.08},100%,64%,${0.16 + energy * 0.12})`
  );
  vanishingHalo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vanishingHalo;
  ctx.beginPath();
  ctx.arc(cx, cy, 76 + bass * 18, 0, Math.PI * 2);
  ctx.fill();

  // ============================================================
  // 3. TRILHOS / FOTOS: DESENHADOS ANTES DO PISO.
  //    A PARTE BAIXA SERÁ COBERTA PELOS TIJOLOS.
  // ============================================================
    // Trilhos e fotos existem somente ACIMA do horizonte do piso.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, floorHorizonY - 2);
  ctx.clip();

const laneCount = 24;
  const laneRotation = time * (0.055 + energy * 0.032);
  const outerRx = w * 0.84;
  const outerRy = h * 0.78;
  const innerRadius = 13 + bass * 6;
  const laneGeometry = [];

  for (let i = 0; i < laneCount; i += 1) {
    const baseAngle =
      (i / laneCount) * Math.PI * 2 + laneRotation;

    const outerX = cx + Math.cos(baseAngle) * outerRx;
    const outerY = cy + Math.sin(baseAngle) * outerRy;

    const innerAngle =
      baseAngle +
      0.31 +
      Math.sin(time * 0.44 + i) * 0.035;

    const innerX = cx + Math.cos(innerAngle) * innerRadius;
    const innerY = cy + Math.sin(innerAngle) * innerRadius * 0.72;

    const ctrlAngle = baseAngle + 0.15;
    const ctrlX =
      cx + Math.cos(ctrlAngle) * outerRx * 0.46;
    const ctrlY =
      cy + Math.sin(ctrlAngle) * outerRy * 0.39;

    laneGeometry.push({
      outerX, outerY, ctrlX, ctrlY, innerX, innerY,
    });

    const hue = (ringFlow * 42 + i * 17 + 120) % 360;

    ctx.strokeStyle =
      `hsla(${hue},100%,58%,${0.075 + energy * 0.14})`;
    ctx.lineWidth = 5.0 + energy * 3.4;
    ctx.beginPath();
    ctx.moveTo(outerX, outerY);
    ctx.quadraticCurveTo(ctrlX, ctrlY, innerX, innerY);
    ctx.stroke();

    ctx.strokeStyle =
      `hsla(${hue + 22},100%,76%,${0.18 + energy * 0.25})`;
    ctx.lineWidth = 2.0 + energy * 2.2;
    ctx.beginPath();
    ctx.moveTo(outerX, outerY);
    ctx.quadraticCurveTo(ctrlX, ctrlY, innerX, innerY);
    ctx.stroke();

    const travel =
      (time * (0.085 + energy * 0.060) + i * 0.061) % 1;
    const eased = travel * travel;
    const omt = 1 - eased;

    const sparkX =
      omt * omt * outerX +
      2 * omt * eased * ctrlX +
      eased * eased * innerX;

    const sparkY =
      omt * omt * outerY +
      2 * omt * eased * ctrlY +
      eased * eased * innerY;

    ctx.fillStyle =
      `hsla(${hue + 34},100%,80%,${0.32 + energy * 0.32})`;
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, 2.2 + bass * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const people = Array.isArray(visualPeople) ? visualPeople : [];
  const peopleCount = Math.min(10, people.length);

  for (let i = 0; i < peopleCount; i += 1) {
    const person = people[i];
    const lane = laneGeometry[(i * 3 + 1) % laneGeometry.length];

    const travel =
      (time * (0.035 + (i % 3) * 0.005) +
        i / Math.max(1, peopleCount)) % 1;

    const eased = travel * travel;
    const omt = 1 - eased;

    const px =
      omt * omt * lane.outerX +
      2 * omt * eased * lane.ctrlX +
      eased * eased * lane.innerX;

    const py =
      omt * omt * lane.outerY +
      2 * omt * eased * lane.ctrlY +
      eased * eased * lane.innerY;

    const perspective = 1 - travel;
    const radius =
      6.2 +
      perspective * 10.2 +
      (person?.weight > 1 ? 2.2 : 0);

    const alpha = Math.max(
      0.20,
      Math.min(0.90, 0.27 + perspective * 0.59)
    );

    const hue =
      (ringFlow * 46 + i * 49 + 155) % 360;

    if (!drawVisualProfile(
      ctx, person, px, py, radius, hue, alpha
    )) {
      ctx.fillStyle = `hsla(${hue},100%,77%,${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, radius * 0.34), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ============================================================
  // 4. PISO OPACO POR CIMA DOS TRILHOS.
  //    O HORIZONTE COINCIDE COM O CENTRO DA ESPIRAL.
  // ============================================================
    ctx.restore();

ctx.globalCompositeOperation = "source-over";

  const floorBottom = h * 1.035;
  const rows = 11;
  const cols = 7;
  const beatStep = Math.floor(time * (0.45 + bass * 1.35));

  function drawTileMotif(
    cxTile, cyTile, tileW, tileH, seed, hueBase, alphaBase
  ) {
    const mode = seed % 8;
    const size = Math.max(
      3.5,
      Math.min(tileW, tileH) * 0.20
    );
    const hue2 = (hueBase + 115) % 360;

    ctx.save();
    ctx.globalAlpha = alphaBase;
    ctx.lineWidth = Math.max(0.7, size * 0.12);
    ctx.strokeStyle = `hsla(${hue2},100%,86%,.95)`;
    ctx.fillStyle = `hsla(${hue2},100%,86%,.90)`;

    if (mode === 0) {
      ctx.beginPath();
      ctx.arc(cxTile, cyTile, size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cxTile, cyTile, size * 0.40, 0, Math.PI * 2);
      ctx.stroke();
    } else if (mode === 1) {
      ctx.beginPath();
      ctx.moveTo(cxTile, cyTile - size);
      ctx.lineTo(cxTile + size * 0.92, cyTile + size * 0.82);
      ctx.lineTo(cxTile - size * 0.92, cyTile + size * 0.82);
      ctx.closePath();
      ctx.stroke();
    } else if (mode === 2) {
      ctx.beginPath();
      ctx.moveTo(cxTile, cyTile - size);
      ctx.lineTo(cxTile + size, cyTile);
      ctx.lineTo(cxTile, cyTile + size);
      ctx.lineTo(cxTile - size, cyTile);
      ctx.closePath();
      ctx.stroke();
    } else if (mode === 3) {
      ctx.strokeRect(
        cxTile - size * 0.84,
        cyTile - size * 0.84,
        size * 1.68,
        size * 1.68
      );
    } else if (mode === 4) {
      ctx.font = `${Math.max(9, size * 1.55)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const glyphs = ["✨", "🔥", "💎", "😀"];
      ctx.fillText(
        glyphs[Math.abs(seed) % glyphs.length],
        cxTile,
        cyTile
      );
    } else if (mode === 5) {
      ctx.beginPath();
      ctx.arc(
        cxTile - size * 0.45, cyTile, size * 0.36,
        0, Math.PI * 2
      );
      ctx.arc(
        cxTile + size * 0.45, cyTile, size * 0.36,
        0, Math.PI * 2
      );
      ctx.fill();
    } else if (mode === 6) {
      ctx.beginPath();
      for (let p = 0; p < 5; p += 1) {
        const a = -Math.PI / 2 + p * Math.PI * 2 / 5;
        const sx = cxTile + Math.cos(a) * size;
        const sy = cyTile + Math.sin(a) * size;
        if (p === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cxTile - size, cyTile);
      ctx.lineTo(cxTile, cyTile - size);
      ctx.lineTo(cxTile + size, cyTile);
      ctx.lineTo(cxTile, cyTile + size);
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cxTile, cyTile, size * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // Camada-base escura do piso garante que os trilhos não atravessem visualmente.
  const floorBase = ctx.createLinearGradient(
    0, floorHorizonY, 0, h
  );
  floorBase.addColorStop(0, "#03060e");
  floorBase.addColorStop(0.18, "#02040a");
  floorBase.addColorStop(1, "#000003");
  ctx.fillStyle = floorBase;

  ctx.beginPath();
  ctx.moveTo(cx - 24, floorHorizonY);
  ctx.lineTo(cx + 24, floorHorizonY);
  ctx.lineTo(w * 1.08, floorBottom);
  ctx.lineTo(w * -0.08, floorBottom);
  ctx.closePath();
  ctx.fill();

  for (let row = 0; row < rows; row += 1) {
    const p0 = row / rows;
    const p1 = (row + 1) / rows;

    const y0 =
      floorHorizonY +
      Math.pow(p0, 1.78) * (floorBottom - floorHorizonY);

    const y1 =
      floorHorizonY +
      Math.pow(p1, 1.78) * (floorBottom - floorHorizonY);

    const half0 = 24 + Math.pow(p0, 1.16) * w * 0.60;
    const half1 = 24 + Math.pow(p1, 1.16) * w * 0.60;

    for (let col = 0; col < cols; col += 1) {
      const u0 = col / cols;
      const u1 = (col + 1) / cols;

      const x00 = cx - half0 + half0 * 2 * u0;
      const x01 = cx - half0 + half0 * 2 * u1;
      const x10 = cx - half1 + half1 * 2 * u0;
      const x11 = cx - half1 + half1 * 2 * u1;

      const seed = row * 47 + col * 83 + beatStep * 29;
      const hue =
        (seed * 17 + visualHue + bass * 64) % 360;

      const light =
        27 +
        energy * 24 +
        ((row + col + beatStep) % 3) * 4;

      // Mais opaco para realmente ficar por cima dos trilhos.
      const alpha =
        0.68 + energy * 0.18 + p1 * 0.08;

      ctx.fillStyle =
        `hsla(${hue},88%,${light}%,${Math.min(.96, alpha)})`;

      ctx.beginPath();
      ctx.moveTo(x00 + 0.65, y0 + 0.6);
      ctx.lineTo(x01 - 0.65, y0 + 0.6);
      ctx.lineTo(x11 - 1.0, y1 - 0.65);
      ctx.lineTo(x10 + 1.0, y1 - 0.65);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle =
        `rgba(255,255,255,${0.055 + energy * 0.075})`;
      ctx.lineWidth = 0.55;
      ctx.stroke();

      const cxTile = (x00 + x01 + x10 + x11) * 0.25;
      const cyTile = (y0 + y0 + y1 + y1) * 0.25;
      const tileW =
        Math.abs((x01 - x00) + (x11 - x10)) * 0.5;
      const tileH = Math.abs(y1 - y0);

      drawTileMotif(
        cxTile, cyTile, tileW, tileH,
        seed, hue, 0.36 + energy * 0.22
      );
    }
  }

  // Reflexo leve do plasma no piso.
  const reflection = ctx.createLinearGradient(
    0, floorHorizonY, 0, h
  );
  reflection.addColorStop(
    0,
    `hsla(${195 + visualHue * 0.08},100%,58%,${0.10 + energy * 0.05})`
  );
  reflection.addColorStop(0.20, "rgba(0,0,0,0)");
  reflection.addColorStop(0.72, "rgba(0,0,0,0)");
  reflection.addColorStop(1, "rgba(0,0,0,.20)");
  ctx.fillStyle = reflection;
  ctx.fillRect(0, floorHorizonY, w, h - floorHorizonY);

  // Vinheta final.
  const finalVignette = ctx.createRadialGradient(
    cx, h * 0.45, h * 0.10,
    cx, h * 0.45, h * 0.76
  );
  finalVignette.addColorStop(0, "rgba(0,0,0,0)");
  finalVignette.addColorStop(0.58, "rgba(0,0,0,.02)");
  finalVignette.addColorStop(0.86, "rgba(0,0,0,.12)");
  finalVignette.addColorStop(1, "rgba(0,0,0,.38)");
  ctx.fillStyle = finalVignette;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}

  registry.register({
    id: "orbital_cathedral",
    name: "Catedral Orbital",

    init(context) {
      if (context?.stage) {
        context.stage.dataset.layout =
          "orbital_cathedral";
      }

      syncContext(context);
      ensureSuperCubeLayer(context);
    },

    update(now, state, context) {
      syncContext(context, state);
      updateSuperCubeMotion(now);
    },

    render(now, state, context) {
      syncContext(context, state);

      drawOrbitalCathedral(now);
      drawOrbitalFloorOverlay(now);
      applyDistantSceneryPerspective();

      return true;
    },

    onState(payload, context) {
      syncContext(context);

      const board =
        Array.isArray(payload?.gift_leaderboard)
          ? payload.gift_leaderboard
          : [];

      const leader =
        payload?.top_gifter
        || board[0]
        || null;

      syncSocialGiftCube(
        board,
        "orbital_cathedral",
        leader,
        context
      );

      syncSuperCube(
        board.length
          ? board
          : (
              leader
                ? [leader]
                : []
            ),
        "orbital_cathedral"
      );
    },

    destroy(context) {
      context?.clearLayoutOverlay?.();
      syncSocialGiftCube([], "", null);
      syncSuperCube([], "");
      destroySuperCubeLayer();
    },
  });
})();
