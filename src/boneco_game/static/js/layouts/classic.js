(() => {
  const registry = window.BonecoLayoutRegistry;

  if (!registry) {
    console.error(
      "BonecoLayoutRegistry ausente para classic."
    );
    return;
  }

  function rectanglePerimeterPoint(rect, t) {
    const value =
      ((Number(t) % 1) + 1) % 1;

    const side = value * 4;

    if (side < 1) {
      return {
        x:
          rect.left
          + (rect.right - rect.left) * side,
        y: rect.top,
      };
    }

    if (side < 2) {
      return {
        x: rect.right,
        y:
          rect.top
          + (rect.bottom - rect.top)
          * (side - 1),
      };
    }

    if (side < 3) {
      return {
        x:
          rect.right
          - (rect.right - rect.left)
          * (side - 2),
        y: rect.bottom,
      };
    }

    return {
      x: rect.left,
      y:
        rect.bottom
        - (rect.bottom - rect.top)
        * (side - 3),
    };
  }

  function distanceToNearestCornerPhase(t) {
    const value =
      ((Number(t) % 1) + 1) % 1;

    return Math.min(
      Math.abs(value - 0),
      Math.abs(value - 0.25),
      Math.abs(value - 0.5),
      Math.abs(value - 0.75),
      Math.abs(value - 1)
    );
  }

  function drawCornerSaber(
    ctx,
    outer,
    center,
    hue,
    power,
    time,
    phase
  ) {
    ctx.save();

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    ctx.strokeStyle =
      `hsla(${hue}, 100%, 52%, ${0.26 + power * 0.18})`;

    ctx.lineWidth =
      31 + power * 12;

    ctx.beginPath();
    ctx.moveTo(outer.x, outer.y);
    ctx.lineTo(center.x, center.y);
    ctx.stroke();

    ctx.strokeStyle =
      `hsla(${hue + 14}, 100%, 68%, ${0.74 + power * 0.16})`;

    ctx.lineWidth =
      13 + power * 5;

    ctx.beginPath();
    ctx.moveTo(outer.x, outer.y);
    ctx.lineTo(center.x, center.y);
    ctx.stroke();

    ctx.strokeStyle =
      `rgba(255,255,255,${0.76 + power * 0.18})`;

    ctx.lineWidth =
      3 + power * 2;

    ctx.beginPath();
    ctx.moveTo(outer.x, outer.y);
    ctx.lineTo(center.x, center.y);
    ctx.stroke();

    const dx = center.x - outer.x;
    const dy = center.y - outer.y;

    for (let i = 0; i < 4; i += 1) {
      const t =
        (
          time * (0.42 + power * 0.55)
          + phase
          + i * 0.25
        ) % 1;

      const start =
        Math.max(0, t - 0.055);

      const end =
        Math.min(1, t + 0.055);

      const x1 =
        outer.x + dx * start;

      const y1 =
        outer.y + dy * start;

      const x2 =
        outer.x + dx * end;

      const y2 =
        outer.y + dy * end;

      ctx.strokeStyle =
        `rgba(255,255,255,${0.42 + power * 0.34})`;

      ctx.lineWidth =
        8 + power * 4;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.fillStyle =
        `hsla(${hue + 25}, 100%, 76%, ${0.34 + power * 0.26})`;

      ctx.beginPath();

      ctx.arc(
        x2,
        y2,
        5 + power * 5,
        0,
        Math.PI * 2
      );

      ctx.fill();
    }

    ctx.restore();
  }

  function tunnelRingPoint(
    anchor,
    center,
    scale,
    wobble
  ) {
    return {
      x:
        center.x
        + (anchor.x - center.x) * scale
        + wobble.x,

      y:
        center.y
        + (anchor.y - center.y) * scale
        + wobble.y,
    };
  }

  function drawTunnelRing(
    ctx,
    anchors,
    center,
    scale,
    hue,
    alpha,
    width,
    time,
    index
  ) {
    const wobbleAmp =
      0.8 + scale * 1.25;

    const points = anchors.map(
      (anchor, pos) =>
        tunnelRingPoint(
          anchor,
          center,
          scale,
          {
            x:
              Math.sin(
                time * 1.3
                + index * 0.7
                + pos * 1.9
              ) * wobbleAmp,

            y:
              Math.cos(
                time * 1.1
                + index * 0.8
                + pos * 1.6
              ) * wobbleAmp,
          }
        )
    );

    ctx.save();

    ctx.globalCompositeOperation =
      "lighter";

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.strokeStyle =
      `hsla(${hue}, 100%, 58%, ${alpha})`;

    ctx.lineWidth = width;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (
      let i = 1;
      i < points.length;
      i += 1
    ) {
      ctx.lineTo(
        points[i].x,
        points[i].y
      );
    }

    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle =
      `rgba(255,255,255,${alpha * 0.42})`;

    ctx.lineWidth =
      Math.max(
        0.8,
        width * 0.22
      );

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (
      let i = 1;
      i < points.length;
      i += 1
    ) {
      ctx.lineTo(
        points[i].x,
        points[i].y
      );
    }

    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawTunnelDepthLines(
    ctx,
    center,
    hue,
    power,
    time,
    wallOrbit,
    env
  ) {
    const {
      width,
      height,
      people,
      drawProfile,
    } = env;

    const outer = {
      left: -20,
      top: -20,
      right: width + 20,
      bottom: height + 20,
    };

    const innerW =
      34 + power * 20;

    const innerH =
      56 + power * 28;

    const inner = {
      left: center.x - innerW,
      top: center.y - innerH,
      right: center.x + innerW,
      bottom: center.y + innerH,
    };

    const count = 38;

    const maxPhotoSlots =
      Math.min(
        10,
        people.length
      );

    const photoEvery =
      maxPhotoSlots
        ? Math.max(
            1,
            Math.floor(
              count / maxPhotoSlots
            )
          )
        : 0;

    ctx.save();

    ctx.globalCompositeOperation =
      "lighter";

    ctx.lineCap = "round";

    for (
      let i = 0;
      i < count;
      i += 1
    ) {
      const t =
        (
          i / count
          + wallOrbit
          + Math.sin(
              time * 0.8
              + i * 0.31
            ) * 0.004
        ) % 1;

      const cornerGap =
        distanceToNearestCornerPhase(t);

      if (cornerGap < 0.018) {
        continue;
      }

      const start =
        rectanglePerimeterPoint(
          outer,
          t
        );

      const end =
        rectanglePerimeterPoint(
          inner,
          t
          + Math.sin(
              time * 0.55 + i
            ) * 0.006
        );

      const localHue =
        (
          hue
          + i * 11
          + wallOrbit * 260
        ) % 360;

      const alpha =
        0.1
        + power * 0.14
        + Math.min(
            0.08,
            cornerGap * 1.2
          );

      ctx.strokeStyle =
        `hsla(${localHue}, 100%, 64%, ${alpha})`;

      ctx.lineWidth =
        0.9 + power * 1.45;

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      const travel =
        (
          time * 0.42
          + i * 0.047
        ) % 1;

      const sparkX =
        start.x
        + (end.x - start.x)
        * travel;

      const sparkY =
        start.y
        + (end.y - start.y)
        * travel;

      const personSlot =
        photoEvery
        && i % photoEvery === 0;

      const person =
        personSlot
          ? people[
              Math.floor(
                i / photoEvery
              ) % people.length
            ]
          : null;

      const perspective =
        1 - travel;

      const photoRadius =
        (
          person?.weight > 1
            ? 8.5
            : 7.2
        )
        + perspective * 12
        + power * 2.8;

      const photoAlpha =
        0.28
        + perspective * 0.45
        + power * 0.18;

      const profileDrawn =
        Boolean(
          person
          && typeof drawProfile === "function"
          && drawProfile(
            ctx,
            person,
            sparkX,
            sparkY,
            photoRadius,
            localHue + 24,
            photoAlpha
          )
        );

      if (!profileDrawn) {
        ctx.fillStyle =
          `hsla(${localHue + 24}, 100%, 78%, ${0.16 + power * 0.2})`;

        ctx.beginPath();

        ctx.arc(
          sparkX,
          sparkY,
          1.8 + power * 2.4,
          0,
          Math.PI * 2
        );

        ctx.fill();
      }
    }

    ctx.restore();
  }

  function renderClassic(
    now,
    state,
    context
  ) {
    const ctx =
      context?.tunnelCtx;

    if (!ctx) {
      return false;
    }

    const width =
      Number(
        context?.tunnelWidth
        || 360
      );

    const height =
      Number(
        context?.tunnelHeight
        || 640
      );

    const time =
      Number(now || 0) * 0.001;

    const energy =
      Math.max(
        0,
        Math.min(
          1,
          Number(
            state?.musicEnergy
            || 0
          )
        )
      );

    const bass =
      Math.max(
        0,
        Math.min(
          1,
          Number(
            state?.musicBass
            || 0
          )
        )
      );

    const tunnelHue =
      Number(
        state?.tunnelHue
        || 0
      );

    const people =
      Array.isArray(
        state?.tunnelPeople
      )
        ? state.tunnelPeople
        : [];

    if (
      typeof context
        ?.clearTunnelFloorOverlay
      === "function"
    ) {
      context
        .clearTunnelFloorOverlay();
    }

    ctx.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );

    ctx.fillStyle =
      "#02030a";

    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    const center = {
      x:
        width * 0.5
        + Math.sin(
            time * 0.7
          ) * (5 + bass * 10),

      y:
        height * 0.31
        + Math.cos(
            time * 0.52
          ) * (4 + energy * 7),
    };

    const pulse =
      Math.max(
        0.12,
        Math.min(
          1,
          bass * 1.4
          + energy * 0.55
        )
      );

    const wallOrbit =
      time * 0.046;

    const batons = [
      {
        outer: {
          x: -14,
          y: -14,
        },
        hue:
          (tunnelHue + 312) % 360,
        phase: 0,
      },
      {
        outer: {
          x: width + 14,
          y: -14,
        },
        hue:
          (tunnelHue + 28) % 360,
        phase: 0.18,
      },
      {
        outer: {
          x: width + 14,
          y: height + 14,
        },
        hue:
          (tunnelHue + 90) % 360,
        phase: 0.36,
      },
      {
        outer: {
          x: -14,
          y: height + 14,
        },
        hue:
          (tunnelHue + 276) % 360,
        phase: 0.54,
      },
    ];

    const cornerAnchors =
      batons.map(
        baton => baton.outer
      );

    const bg =
      ctx.createRadialGradient(
        center.x,
        center.y,
        8,
        center.x,
        center.y,
        430
      );

    bg.addColorStop(
      0,
      `hsla(${(tunnelHue + 85) % 360}, 100%, 58%, .35)`
    );

    bg.addColorStop(
      0.28,
      `hsla(${(tunnelHue + 170) % 360}, 96%, 40%, .1)`
    );

    bg.addColorStop(
      0.7,
      "rgba(3, 8, 18, .9)"
    );

    bg.addColorStop(
      1,
      "#010106"
    );

    ctx.fillStyle = bg;

    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    ctx.globalCompositeOperation =
      "lighter";

    for (const baton of batons) {
      drawCornerSaber(
        ctx,
        baton.outer,
        center,
        baton.hue,
        pulse,
        time,
        baton.phase
      );
    }

    drawTunnelDepthLines(
      ctx,
      center,
      tunnelHue,
      pulse,
      time,
      wallOrbit,
      {
        width,
        height,
        people,
        drawProfile:
          context
            ?.drawTunnelProfile,
      }
    );

    for (
      let i = 0;
      i < 40;
      i += 1
    ) {
      const p =
        (
          i / 40
          + time
          * (
            0.075
            + energy * 0.14
          )
        ) % 1;

      const scale =
        0.12
        + p * p * 1.08;

      const alpha =
        (1 - p) * 0.54
        + 0.075;

      const hue =
        (
          tunnelHue
          + i * 10
          + bass * 150
        ) % 360;

      drawTunnelRing(
        ctx,
        cornerAnchors,
        center,
        scale,
        hue,
        alpha,
        1.8
          + pulse * 4.2
          + p * 3.2,
        time,
        i
      );
    }

    ctx.globalCompositeOperation =
      "source-over";

    const floor =
      ctx.createLinearGradient(
        0,
        height * 0.66,
        0,
        height
      );

    floor.addColorStop(
      0,
      "rgba(2, 5, 11, 0)"
    );

    floor.addColorStop(
      0.4,
      `hsla(${(tunnelHue + 34) % 360}, 80%, 18%, .26)`
    );

    floor.addColorStop(
      1,
      "#010102"
    );

    ctx.fillStyle = floor;

    ctx.fillRect(
      0,
      height * 0.62,
      width,
      height * 0.38
    );

    return true;
  }

  registry.register({
    id: "classic",
    name: "Túnel Classic",

    init(context) {
      if (context?.stage) {
        context.stage.dataset.layout =
          "classic";
      }

      context?.clearTunnelFloorOverlay?.();
      context?.legacy?.syncSocialGiftCube?.(
        [],
        "",
        null
      );
      context?.legacy?.syncSuperCube?.(
        [],
        ""
      );
    },

    update() {},

    render(
      now,
      state,
      context
    ) {
      return renderClassic(
        now,
        state,
        context
      );
    },

    onState() {},

    destroy() {},
  });
})();
