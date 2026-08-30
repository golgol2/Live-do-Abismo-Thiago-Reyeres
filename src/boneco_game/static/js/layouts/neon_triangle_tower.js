(() => {
  const registry = window.BonecoLayoutRegistry;

  if (!registry) {
    console.error(
      "BonecoLayoutRegistry ausente para neon_triangle_tower."
    );
    return;
  }

  const TOWER_ROWS = 5;
  const TOWER_BASE_SIZE = 5;
  const TOWER_SLOT_COUNT = 15;
  const TOWER_TOP_SLOT_INDEX = TOWER_SLOT_COUNT - 1;
  const TOWER_CUBE_SIZE = 86;
  const TOWER_GAP = 6;
  const RANK_TO_SLOT = [
    14,
    12, 13,
    9, 10, 11,
    5, 6, 7, 8,
    0, 1, 2, 3, 4,
  ];
  const BACKGROUND_SHAPES = Array.from({ length: 28 }, (_, index) => ({
    x: (index * 97) % 360,
    y: 22 + ((index * 61) % 292),
    radius: 14 + (index % 7) * 8,
    sides: 4 + (index % 4),
    phase: index * 0.74,
    speed: 0.14 + (index % 6) * 0.035,
    orbit: index % 4,
    orbitRadius: 24 + (index % 5) * 16,
  }));

  let stage = null;
  let layoutCanvas = null;
  let layoutOverlayCanvas = null;
  let layoutCtx = null;
  let layoutOverlayCtx = null;
  let mediaImageUrl = value => String(value || "");
  let visualImageEntry = () => null;
  let drawVisualProfile = () => false;
  let getVisualPeople = () => [];
  let isLayoutVisualMode = () => true;
  let musicEnergy = 0;
  let musicBass = 0;
  let visualHue = 190;
  let people = [];
  let peopleSignature = "";
  let peopleSlots = Array(TOWER_SLOT_COUNT).fill(null);
  let towerLayer = null;
  let towerStack = null;
  let towerCubes = [];
  let towerBeat = 0;

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, Number(value || 0))
    );
  }

  function syncContext(context, state = {}) {
    stage = context?.stage || stage;
    layoutCanvas = context?.layoutCanvas || layoutCanvas;
    layoutOverlayCanvas = context?.layoutOverlayCanvas || layoutOverlayCanvas;
    layoutCtx = context?.layoutCtx || layoutCtx;
    layoutOverlayCtx = context?.layoutOverlayCtx || layoutOverlayCtx;
    mediaImageUrl = context?.mediaImageUrl || mediaImageUrl;
    visualImageEntry = context?.visualImageEntry || visualImageEntry;
    drawVisualProfile = context?.drawVisualProfile || drawVisualProfile;
    getVisualPeople = context?.getVisualPeople || getVisualPeople;
    isLayoutVisualMode = context?.isLayoutVisualMode || isLayoutVisualMode;

    const music = context?.getMusicState?.() || {};
    musicEnergy = clamp(
      state.musicEnergy ?? music.musicEnergy ?? musicEnergy,
      0,
      1
    );
    musicBass = clamp(
      state.musicBass ?? music.musicBass ?? musicBass,
      0,
      1
    );
    visualHue = Number(
      state.visualHue ?? music.visualHue ?? visualHue
    );

  }

  function normalizePeople(list) {
    const byKey = new Map();

    for (const item of Array.isArray(list) ? list : []) {
      const profile = String(
        item?.profile ||
        item?.profile_image ||
        item?.profile_image_url ||
        item?.avatar_url ||
        item?.avatarUrl ||
        ""
      ).trim();

      const username = String(
        item?.username ||
        item?.key ||
        ""
      ).trim();

      const displayName = String(
        item?.displayName ||
        item?.display_name ||
        username ||
        "user"
      ).trim();

      const key = String(
        username || displayName || profile
      ).toLowerCase();

      if (!key) continue;

      const weight = Math.max(
        1,
        Number(
          item?.score ||
          item?.total_coins ||
          item?.gift_total_coins ||
          item?.weight ||
          item?.total_count ||
          item?.count ||
          item?.gift_count ||
          1
        )
      );
      const totalCoins = Math.max(
        0,
        Number(item?.total_coins || item?.score || weight || 0)
      );
      const totalCount = Math.max(
        0,
        Number(item?.total_count || item?.count || item?.gift_count || 0)
      );

      const current = byKey.get(key);
      if (current) {
        current.weight = Math.max(current.weight, weight);
        current.totalCoins = Math.max(current.totalCoins, totalCoins);
        current.totalCount = Math.max(current.totalCount, totalCount);
        current.lastGiftName = current.lastGiftName || String(item?.last_gift_name || "").trim();
        current.profile = current.profile || profile;
        current.displayName =
          current.displayName === "user"
            ? displayName
            : current.displayName;
        continue;
      }

      byKey.set(key, {
        key,
        username,
        displayName,
        profile,
        weight,
        totalCoins,
        totalCount,
        lastGiftName: String(item?.last_gift_name || "").trim(),
      });
    }

    return Array.from(byKey.values())
      .sort(
        (a, b) => {
          const scoreDiff =
            Number(b.totalCoins || b.weight || 0)
            - Number(a.totalCoins || a.weight || 0);
          if (scoreDiff) return scoreDiff;
          return Number(b.totalCount || 0) - Number(a.totalCount || 0);
        }
      )
      .slice(0, TOWER_SLOT_COUNT);
  }

  function collectPeople(payload) {
    const combined = [];

    if (Array.isArray(payload?.gift_leaderboard)) {
      combined.push(...payload.gift_leaderboard);
    }

    if (payload?.top_gifter) {
      combined.push(payload.top_gifter);
    }

    return normalizePeople(combined);
  }

  function personInitials(person) {
    const label = String(
      person?.displayName ||
      person?.username ||
      "?"
    ).trim();

    if (!label) return "?";

    const parts = label.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
    }

    return label.slice(0, 2).toUpperCase();
  }

  function personSignature(list) {
    return list
      .map((item, index) =>
        item
          ? `${index}:${item.key}:${item.profile}:${item.weight}`
          : `${index}:empty`
      )
      .join("|");
  }

  function findPersonSlot(key) {
    const target = String(key || "").toLowerCase();
    if (!target) return -1;

    return peopleSlots.findIndex(
      person => String(person?.key || "").toLowerCase() === target
    );
  }

  function formatCoins(value) {
    const coins = Math.max(0, Math.round(Number(value || 0)));
    if (coins >= 1000000) return `${(coins / 1000000).toFixed(1)}M`;
    if (coins >= 1000) return `${(coins / 1000).toFixed(1)}K`;
    return String(coins);
  }

  function mergePersonSlot(current, next) {
    if (!current) return { ...next };

    return {
      ...current,
      ...next,
      profile: next.profile || current.profile || "",
      username: next.username || current.username || "",
      displayName: next.displayName || current.displayName || "",
      weight: Number(next.weight || current.weight || 0),
      totalCoins: Number(next.totalCoins || current.totalCoins || 0),
      totalCount: Number(next.totalCount || current.totalCount || 0),
      lastGiftName: next.lastGiftName || current.lastGiftName || "",
    };
  }

  function syncRankingSlots(nextPeople) {
    const incoming = normalizePeople(nextPeople);
    const before = personSignature(peopleSlots);
    const nextSlots = Array(TOWER_SLOT_COUNT).fill(null);

    for (let rank = 0; rank < Math.min(incoming.length, RANK_TO_SLOT.length); rank += 1) {
      const slotIndex = RANK_TO_SLOT[rank];
      const existingIndex = findPersonSlot(incoming[rank].key);
      nextSlots[slotIndex] = mergePersonSlot(
        existingIndex >= 0 ? peopleSlots[existingIndex] : null,
        incoming[rank]
      );
    }

    peopleSlots = nextSlots;
    people = incoming;
    peopleSignature = personSignature(peopleSlots);
    return peopleSignature !== before;
  }

  function ensureTowerLayer() {
    if (towerLayer || !stage) return towerLayer;

    towerLayer = document.createElement("div");
    towerLayer.className = "neon-triangle-tower-layer";
    towerLayer.hidden = true;

    const glow = document.createElement("div");
    glow.className = "neon-triangle-tower-glow";
    towerLayer.appendChild(glow);

    towerStack = document.createElement("div");
    towerStack.className = "neon-triangle-tower-stack";
    towerLayer.appendChild(towerStack);

    stage.appendChild(towerLayer);
    return towerLayer;
  }

  function fillFace(face, person) {
    face.replaceChildren();

    if (person?.profile) {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.loading = "eager";
      img.src = mediaImageUrl(person.profile);
      face.appendChild(img);
      return;
    }

    const fallback = document.createElement("span");
    fallback.textContent = person ? personInitials(person) : "";
    face.appendChild(fallback);
  }

  function createFace(className) {
    const face = document.createElement("div");
    face.className = `neon-user-cube-face ${className}`;
    return face;
  }

  function createCube(index) {
    const cube = document.createElement("div");
    cube.className = "neon-user-cube";
    cube.dataset.index = String(index);
    cube.classList.add("is-empty");
    cube.style.setProperty(
      "--cube-hue",
      String((visualHue + index * 31) % 360)
    );
    cube.style.setProperty(
      "--cube-edge-hue",
      String((visualHue + index * 31) % 360)
    );

    cube.appendChild(createFace("front"));
    cube.appendChild(createFace("back"));
    cube.appendChild(createFace("left"));
    cube.appendChild(createFace("right"));
    cube.appendChild(createFace("top"));
    cube.appendChild(createFace("bottom"));

    return cube;
  }

  function setCubePerson(cube, person, index, maxWeight) {
    cube.classList.toggle("is-empty", !person);
    cube.classList.toggle("is-leader", Boolean(person) && index === TOWER_TOP_SLOT_INDEX);
    cube.classList.toggle("is-top-gift", Boolean(person) && index >= 12);
    cube.dataset.weight = String(person?.weight || 0);
    cube.title = person
      ? `${person.displayName || person.username} - ${formatCoins(person.totalCoins || person.weight)} moedas`
      : "";

    const giftPower = person
      ? clamp(Number(person.weight || 1) / maxWeight, 0.08, 1)
      : 0.08;

    cube.style.setProperty("--gift-power", giftPower.toFixed(4));
    cube.style.setProperty(
      "--cube-hue",
      String((visualHue + giftPower * 160 + index * 24) % 360)
    );
    cube.style.setProperty(
      "--cube-edge-hue",
      String((visualHue + giftPower * 160 + index * 24) % 360)
    );

    for (const face of cube.querySelectorAll(".neon-user-cube-face")) {
      fillFace(face, person || null);
    }
  }

  function ensureTowerSlots() {
    ensureTowerLayer();
    if (!towerLayer || !towerStack) return;

    if (towerCubes.length === TOWER_SLOT_COUNT) return;

    towerStack.replaceChildren();
    towerCubes = [];

    for (let index = 0; index < TOWER_SLOT_COUNT; index += 1) {
      const cube = createCube(index);
      towerStack.appendChild(cube);
      towerCubes.push(cube);
    }

    assignPyramidPositions();
  }

  function assignPyramidPositions() {
    const pitchX = TOWER_CUBE_SIZE + TOWER_GAP;
    const pitchY = TOWER_CUBE_SIZE + TOWER_GAP - 2;
    const maxWeight = Math.max(
      1,
      ...peopleSlots
        .filter(Boolean)
        .map(person => Number(person.weight || 1))
    );

    let index = 0;

    for (let rowFromBottom = 0; rowFromBottom < TOWER_ROWS; rowFromBottom += 1) {
      const cubesInRow = TOWER_BASE_SIZE - rowFromBottom;
      const rowWidth = (cubesInRow - 1) * pitchX;
      const y = -rowFromBottom * pitchY;
      const z = (rowFromBottom + 1) * 7;

      for (let col = 0; col < cubesInRow; col += 1) {
        const cube = towerCubes[index];
        const x = col * pitchX - rowWidth / 2;
        const rotateY = index % 2 === 0 ? -18 : 18;
        const rotateX = -7;

        if (!cube) return;

        cube.classList.toggle("is-base-row", rowFromBottom === 0);
        cube.style.transform =
          `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) ` +
          `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        cube.style.zIndex = String(300 + rowFromBottom);
        setCubePerson(cube, peopleSlots[index] || null, index, maxWeight);

        index += 1;
      }
    }
  }

  function syncTower(nextPeople) {
    ensureTowerSlots();
    if (!towerLayer || !towerStack) return;

    const changed = syncRankingSlots(nextPeople);
    if (changed) assignPyramidPositions();
    towerLayer.hidden = people.length === 0;
  }

  function updateTower() {
    ensureTowerSlots();
    if (!towerLayer || !towerStack) return;

    const targetBeat = clamp(musicBass * 1.25 + musicEnergy * 0.45, 0, 1.35);
    const time = performance.now() * 0.001;
    towerBeat += (targetBeat - towerBeat) * 0.16;

    towerLayer.style.setProperty("--tower-beat", towerBeat.toFixed(4));
    towerLayer.style.setProperty("--tower-energy", musicEnergy.toFixed(4));
    towerLayer.style.setProperty("--tower-bass", musicBass.toFixed(4));

    for (const cube of towerCubes) {
      const index = Number(cube.dataset.index || 0);
      const baseHue = Number(cube.style.getPropertyValue("--cube-hue") || visualHue);
      const edgeHue =
        (baseHue + towerBeat * 118 + Math.sin(time * (2.2 + musicBass * 3.2) + index * 0.72) * 34) % 360;
      cube.style.setProperty("--cube-edge-hue", edgeHue.toFixed(2));
    }
  }

  function drawPolygon(ctx, x, y, radius, sides, angle) {
    ctx.beginPath();
    for (let i = 0; i < sides; i += 1) {
      const a = angle + i * Math.PI * 2 / sides;
      const px = x + Math.cos(a) * radius;
      const py = y + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function rotatedSquare(cx, cy, radius, angle, stretch = 1) {
    return Array.from({ length: 4 }, (_, index) => {
      const a = angle + Math.PI * 0.25 + index * Math.PI * 0.5;
      return {
        x: cx + Math.cos(a) * radius,
        y: cy + Math.sin(a) * radius * stretch,
      };
    });
  }

  function strokePath(ctx, points, close = true) {
    if (!points.length) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    if (close) ctx.closePath();
    ctx.stroke();
  }

  function drawTesseract(ctx, x, y, size, hue, phase, alpha) {
    const outer = rotatedSquare(x, y, size, phase, 0.82);
    const inner = rotatedSquare(
      x + Math.cos(phase * 0.7) * size * 0.18,
      y + Math.sin(phase * 0.9) * size * 0.12,
      size * (0.45 + musicBass * 0.10),
      -phase * 1.2,
      0.82
    );

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 1.2 + musicEnergy * 1.8;
    ctx.strokeStyle = `hsla(${hue}, 100%, 68%, ${alpha * 1.75})`;
    strokePath(ctx, outer);
    ctx.strokeStyle = `hsla(${hue + 58}, 100%, 64%, ${alpha * 2.05})`;
    strokePath(ctx, inner);

    for (let index = 0; index < 4; index += 1) {
      const a = outer[index];
      const b = inner[index];
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, `hsla(${hue}, 100%, 62%, ${alpha * .55})`);
      grad.addColorStop(0.5, `hsla(${hue + 90}, 100%, 72%, ${alpha * 2.00})`);
      grad.addColorStop(1, `hsla(${hue + 160}, 100%, 62%, ${alpha * .55})`);
      ctx.strokeStyle = grad;
      strokePath(ctx, [a, b], false);

      ctx.fillStyle = `hsla(${hue + index * 28}, 100%, 70%, ${alpha * 2.6})`;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 1.3 + musicBass * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawBeatMeters(ctx, width, height, time, hue) {
    const baseY = height * 0.78;
    const maxH = height * 0.36;
    const bars = 13;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? -1 : 1;
      const originX = side === 0 ? width * 0.13 : width * 0.87;

      for (let index = 0; index < bars; index += 1) {
        const spread = index * 5.9 * sign;
        const wave =
          0.34 +
          Math.abs(Math.sin(time * (1.7 + index * 0.05) + index * 0.68)) * 0.26 +
          musicEnergy * 0.30 +
          musicBass * (index % 3 === 0 ? 0.34 : 0.18);
        const barHeight = maxH * clamp(wave, 0.12, 1);
        const x = originX + spread;
        const colorHue = hue + index * 11 + side * 72;

        const grad = ctx.createLinearGradient(x, baseY, x, baseY - barHeight);
        grad.addColorStop(0, `hsla(${colorHue + 70}, 100%, 58%, .04)`);
        grad.addColorStop(0.30, `hsla(${colorHue}, 100%, 58%, .24)`);
        grad.addColorStop(1, `hsla(${colorHue + 34}, 100%, 70%, .78)`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6 + musicBass * 2.8;
        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, baseY - barHeight);
        ctx.stroke();

        ctx.fillStyle = `hsla(${colorHue + 34}, 100%, 68%, ${0.24 + musicBass * 0.35})`;
        ctx.beginPath();
        ctx.arc(x, baseY - barHeight, 1.2 + musicBass * 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawBackground(now) {
    const ctx = layoutCtx;
    if (!ctx || !layoutCanvas) return;

    const width = layoutCanvas.width || 360;
    const height = layoutCanvas.height || 640;
    const time = now * 0.001;
    const hue = (visualHue + musicBass * 130) % 360;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#030414");
    bg.addColorStop(0.32, "#060727");
    bg.addColorStop(0.60, "#040818");
    bg.addColorStop(1, "#000105");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (let index = 0; index < 44; index += 1) {
      const x = (index * 83 + Math.sin(time * 0.2 + index) * 18) % width;
      const y = 18 + ((index * 47) % Math.floor(height * 0.58));
      const starHue = hue + index * 9 + time * 18;
      ctx.fillStyle = `hsla(${starHue}, 100%, 70%, ${0.08 + musicEnergy * 0.10})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.7 + ((index % 3) * 0.45) + musicBass * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let index = 0; index < 7; index += 1) {
      const x = 36 + ((index * 59) % 288);
      const y = 44 + ((index * 71) % 270);
      const size = 18 + (index % 4) * 10 + musicEnergy * 9;
      drawTesseract(
        ctx,
        x,
        y,
        size,
        hue + index * 34,
        time * (0.22 + index * 0.025) + index,
        0.18 + musicEnergy * 0.22 + (index % 2) * 0.08
      );
    }

    const anchorLeft = { x: width * 0.18, y: height * 0.34 };
    const anchorRight = { x: width * 0.82, y: height * 0.34 };
    const anchorTop = { x: width * 0.5, y: height * 0.20 };
    const anchorCenter = { x: width * 0.5, y: height * 0.43 };
    const network = [anchorLeft, anchorRight, anchorTop, anchorCenter];

    ctx.lineWidth = 0.8 + musicBass * 2.2;
    for (let a = 0; a < network.length; a += 1) {
      for (let b = a + 1; b < network.length; b += 1) {
        const from = network[a];
        const to = network[b];
        const grad = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
        grad.addColorStop(0, `hsla(${hue + a * 40}, 100%, 64%, .03)`);
        grad.addColorStop(0.5, `hsla(${hue + 90}, 100%, 70%, ${0.10 + musicEnergy * 0.18})`);
        grad.addColorStop(1, `hsla(${hue + b * 62}, 100%, 64%, .03)`);
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }

    const orbitAnchors = [
      { x: width * 0.22, y: height * 0.22 },
      { x: width * 0.78, y: height * 0.25 },
      { x: width * 0.34, y: height * 0.42 },
      { x: width * 0.66, y: height * 0.43 },
    ];
    const orbitPoints = [];

    for (const shape of BACKGROUND_SHAPES) {
      const anchor = orbitAnchors[shape.orbit % orbitAnchors.length];
      const orbitSpeed = shape.speed * (1.6 + musicEnergy * 2.7 + musicBass * 1.9);
      const orbitAngle = time * orbitSpeed + shape.phase;
      const parentAngle = time * (0.07 + musicEnergy * 0.12) + shape.orbit * Math.PI * 0.5;
      const centerX = anchor.x + Math.cos(parentAngle) * (18 + musicBass * 22);
      const centerY = anchor.y + Math.sin(parentAngle * 1.18) * (14 + musicEnergy * 20);
      const orbitRadius = shape.orbitRadius * (0.88 + musicBass * 0.36);
      const x = centerX + Math.cos(orbitAngle) * orbitRadius;
      const y = centerY + Math.sin(orbitAngle * 1.12) * orbitRadius * 0.64;
      const pulse =
        0.54 +
        musicEnergy * 0.74 +
        Math.sin(time * (1.1 + musicBass * 2.2) + shape.phase) * 0.14;
      const radius =
        shape.radius * (0.78 + musicEnergy * 0.32);
      const shapeHue =
        (hue + shape.phase * 80 + musicEnergy * 90 + musicBass * 70) % 360;

      orbitPoints.push({ x, y, cx: centerX, cy: centerY, hue: shapeHue, orbit: shape.orbit });

      ctx.lineWidth = 1.5 + musicEnergy * 3.0;
      ctx.strokeStyle =
        `hsla(${shapeHue}, 98%, 66%, ${0.18 + pulse * 0.30})`;
      ctx.fillStyle =
        `hsla(${shapeHue + 38}, 94%, 52%, ${0.045 + pulse * 0.075})`;

      drawPolygon(
        ctx,
        x,
        y,
        radius,
        shape.sides,
        time * (shape.speed + 0.12) + shape.phase
      );
      ctx.fill();
      ctx.stroke();
    }

    ctx.lineCap = "round";
    ctx.lineWidth = 0.8 + musicBass * 1.9;
    for (const point of orbitPoints) {
      const grad = ctx.createLinearGradient(point.cx, point.cy, point.x, point.y);
      grad.addColorStop(0, `hsla(${point.hue + 68}, 100%, 66%, ${0.02 + musicEnergy * 0.10})`);
      grad.addColorStop(0.55, `hsla(${point.hue}, 100%, 70%, ${0.12 + musicBass * 0.24})`);
      grad.addColorStop(1, `hsla(${point.hue + 140}, 100%, 68%, ${0.04 + musicEnergy * 0.13})`);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(point.cx, point.cy);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }

    drawBeatMeters(ctx, width, height, time, hue);

    const peopleForSky = people.length ? people : getVisualPeople();
    for (let index = 0; index < Math.min(peopleForSky.length, 10); index += 1) {
      const person = peopleForSky[index];
      const x = 34 + (index % 5) * 72 + Math.sin(time + index) * 5;
      const y = 78 + Math.floor(index / 5) * 78 + Math.cos(time * 1.3 + index) * 6;
      drawVisualProfile(
        ctx,
        person,
        x,
        y,
        10 + musicBass * 4,
        hue + index * 24,
        0.20 + musicEnergy * 0.12
      );
    }

    for (let i = 0; i < 18; i += 1) {
      const p = (i / 18 + time * (0.05 + musicEnergy * 0.08)) % 1;
      const y = 72 + p * 330;
      const alpha = (1 - p) * (0.08 + musicBass * 0.12);
      ctx.strokeStyle = `hsla(${hue + i * 18}, 100%, 62%, ${alpha})`;
      ctx.lineWidth = 1 + p * 4 + musicBass * 5;
      ctx.beginPath();
      ctx.moveTo(width * 0.5, height * 0.50);
      ctx.lineTo((i % 2 ? width * 1.08 : -width * 0.08), y);
      ctx.stroke();
    }

    ctx.restore();

    const vignette = ctx.createRadialGradient(
      width * 0.5,
      height * 0.50,
      height * 0.18,
      width * 0.5,
      height * 0.50,
      height * 0.82
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.68, "rgba(0,0,0,.10)");
    vignette.addColorStop(1, "rgba(0,0,0,.58)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function shrinkPoint(point, center, amount) {
    return {
      x: center.x + (point.x - center.x) * amount,
      y: center.y + (point.y - center.y) * amount,
    };
  }

  function drawTriangle(ctx, points, fill, stroke) {
    const center = {
      x: (points[0].x + points[1].x + points[2].x) / 3,
      y: (points[0].y + points[1].y + points[2].y) / 3,
    };
    const gap = 0.83;
    const a = shrinkPoint(points[0], center, gap);
    const b = shrinkPoint(points[1], center, gap);
    const c = shrinkPoint(points[2], center, gap);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.62;
    ctx.stroke();
  }

  function drawEnergyLine(ctx, a, b, hue, alpha, width) {
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, `hsla(${hue}, 100%, 58%, 0)`);
    grad.addColorStop(0.48, `hsla(${hue + 32}, 100%, 66%, ${alpha})`);
    grad.addColorStop(1, `hsla(${hue + 82}, 100%, 58%, 0)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function drawTriangleFloor(now) {
    const ctx = layoutOverlayCtx;
    const canvas = layoutOverlayCanvas;
    if (!ctx || !canvas) return;

    const width = canvas.width || 360;
    const height = canvas.height || 640;
    const horizon = height * 0.65;
    const top = height * 0.70;
    const bottom = height;
    const rows = 10;
    const cols = 10;
    const time = now * 0.001;
    const hue = (visualHue + time * 70 + musicBass * 180) % 360;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const base = ctx.createLinearGradient(0, horizon, 0, bottom);
    base.addColorStop(0, "rgba(0, 0, 0, 0)");
    base.addColorStop(0.10, "rgba(8, 9, 30, .38)");
    base.addColorStop(0.26, "rgba(8, 10, 29, .88)");
    base.addColorStop(0.68, "rgba(6, 8, 20, .98)");
    base.addColorStop(1, "rgba(0, 2, 10, 1)");
    ctx.fillStyle = base;
    ctx.fillRect(0, horizon, width, bottom - horizon);

    for (let row = 0; row < rows; row += 1) {
      const p0 = row / rows;
      const p1 = (row + 1) / rows;
      const y0 = top + Math.pow(p0, 1.55) * (bottom - top);
      const y1 = top + Math.pow(p1, 1.55) * (bottom - top);
      const tileTop = 34 + p0 * 26;
      const tileBottom = 34 + p1 * 26;
      const offset0 = row % 2 === 0 ? -tileTop * 0.5 : 0;
      const offset1 = row % 2 === 0 ? -tileBottom * 0.25 : -tileBottom * 0.75;
        const rowAlpha = 0.72 + p0 * 0.24;
      const startCol = -2;
      const endCol = cols + 2;

      for (let col = startCol; col < endCol; col += 1) {
        const x0 = offset0 + col * tileTop;
        const x1 = offset0 + (col + 1) * tileTop;
        const xb0 = offset1 + col * tileBottom;
        const xb1 = offset1 + (col + 1) * tileBottom;
        const p00 = { x: x0, y: y0 };
        const p01 = { x: x1, y: y0 };
        const p10 = { x: (xb0 + xb1) * 0.5, y: y1 };
        const p11 = { x: xb1, y: y1 };
        const seed = row * 37 + col * 19;
        const tileHue =
          col % 5 === 0
            ? 216
            : col % 4 === 0
              ? 280
              : col % 3 === 0
                ? 186
                : 235;
        const light = 9 + (seed % 5) * 2 + p0 * 5;
        const fill = `hsla(${tileHue + musicEnergy * 28}, ${58 + musicEnergy * 18}%, ${light}%, ${rowAlpha})`;
        const stroke = `rgba(18, 24, 42, .92)`;

        drawTriangle(ctx, [p00, p01, p10], fill, stroke);
        drawTriangle(ctx, [p01, p11, p10], fill, stroke);

        if ((seed + Math.floor(time * 7)) % 6 === 0) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          drawEnergyLine(
            ctx,
            p01,
            p10,
            hue + seed * 3,
            0.48 + musicBass * 0.42,
            2.0 + p0 * 2.4 + musicBass * 4.0
          );
          ctx.restore();
        }
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let row = 0; row <= rows; row += 1) {
      const p = row / rows;
      const y = top + Math.pow(p, 1.55) * (bottom - top);
      const alpha = 0.16 + p * 0.36 + musicEnergy * 0.26;
      drawEnergyLine(
        ctx,
        { x: -32, y },
        { x: width + 32, y },
        hue + row * 19 + time * 95,
        alpha,
        1.5 + p * 4.8 + musicBass * 4.4
      );
    }

    const groundLines = [
      { x: width * 0.04, lean: 92, hue: 300 },
      { x: width * 0.22, lean: 48, hue: 198 },
      { x: width * 0.40, lean: 22, hue: 172 },
      { x: width * 0.60, lean: -22, hue: 282 },
      { x: width * 0.78, lean: -48, hue: 44 },
      { x: width * 0.96, lean: -92, hue: 318 },
    ];

    for (const line of groundLines) {
      const start = {
        x: line.x,
        y: top + 8,
      };
      const end = {
        x: line.x + line.lean,
        y: bottom + 10,
      };
      const lineHue =
        hue + line.hue + Math.sin(time + line.x) * 24;
      drawEnergyLine(
        ctx,
        start,
        end,
        lineHue,
        0.40 + musicBass * 0.48,
        2.4 + musicBass * 5.0
      );
    }

    for (let row = 2; row <= rows; row += 2) {
      const p = row / rows;
      const y = top + Math.pow(p, 1.55) * (bottom - top);
      const tileWidth = 34 + p * 26;
      const offset = row % 2 === 0 ? -tileWidth * 0.5 : 0;

      for (let col = 0; col <= cols; col += 3) {
        const x = offset + col * tileWidth;
        ctx.fillStyle = `hsla(${hue + row * 24 + col * 18}, 100%, 70%, ${0.32 + musicBass * 0.48})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.3 + p * 2.0 + musicBass * 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const footShadow = ctx.createRadialGradient(
      width * 0.5,
      height * 0.84,
      8,
      width * 0.5,
      height * 0.88,
      width * 0.46
    );
    footShadow.addColorStop(0, "rgba(0,0,0,.08)");
    footShadow.addColorStop(0.38, "rgba(0,0,0,.32)");
    footShadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = footShadow;
    ctx.fillRect(0, top, width, bottom - top);

    ctx.restore();
  }

  registry.register({
    id: "neon_triangle_tower",
    name: "Torre Triangular Neon",

    init(context) {
      syncContext(context);
      if (context?.stage) {
        context.stage.dataset.layout = "neon_triangle_tower";
      }
      ensureTowerLayer();
      syncTower([]);
    },

    update(now, state, context) {
      syncContext(context, state);
      updateTower(now);
    },

    render(now, state, context) {
      syncContext(context, state);

      if (!isLayoutVisualMode()) {
        context?.clearLayoutOverlay?.();
        return false;
      }

      drawBackground(now);
      drawTriangleFloor(now);
      return true;
    },

    onState(payload, context) {
      syncContext(context);
      syncTower(collectPeople(payload));
    },

    destroy(context) {
      context?.clearLayoutOverlay?.();
      if (towerLayer) {
        towerLayer.remove();
      }
      towerLayer = null;
      towerStack = null;
      towerCubes = [];
      people = [];
      peopleSlots = Array(TOWER_SLOT_COUNT).fill(null);
      peopleSignature = "";
    },
  });
})();
