(() => {
  const layouts = new Map();

  let activeId = "";
  let activeLayout = null;
  let activeContext = null;
  let activationSequence = 0;

  function normalizeId(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function register(definition) {
    if (!definition || typeof definition !== "object") {
      throw new Error("Definição de layout inválida.");
    }

    const id = normalizeId(definition.id);

    if (!id) {
      throw new Error("Layout sem id.");
    }

    if (layouts.has(id)) {
      throw new Error(`Layout duplicado: ${id}`);
    }

    layouts.set(id, {
      id,
      name: String(definition.name || id),
      init:
        typeof definition.init === "function"
          ? definition.init
          : () => {},
      update:
        typeof definition.update === "function"
          ? definition.update
          : () => {},
      render:
        typeof definition.render === "function"
          ? definition.render
          : () => {},
      onState:
        typeof definition.onState === "function"
          ? definition.onState
          : () => {},
      destroy:
        typeof definition.destroy === "function"
          ? definition.destroy
          : () => {},
    });

    return layouts.get(id);
  }

  function has(id) {
    return layouts.has(normalizeId(id));
  }

  function list() {
    return Array.from(layouts.values()).map(item => ({
      id: item.id,
      name: item.name,
    }));
  }

  async function activate(id, context = {}) {
    const sequence = ++activationSequence;
    const cleanId = normalizeId(id);
    const next = layouts.get(cleanId);

    if (!next) {
      throw new Error(`Layout não registrado: ${cleanId}`);
    }

    if (activeId === cleanId) {
      activeContext = context || activeContext;
      return next;
    }

    if (activeLayout) {
      try {
        await activeLayout.destroy(activeContext);
      } catch (err) {
        console.warn(
          "layout destroy failed",
          activeId,
          err
        );
      }
    }

    if (sequence !== activationSequence) {
      return activeLayout;
    }

    activeId = cleanId;
    activeLayout = next;
    activeContext = context;

    await activeLayout.init(context);

    if (sequence !== activationSequence) {
      try {
        await next.destroy(context);
      } catch (err) {
        console.warn(
          "stale layout destroy failed",
          cleanId,
          err
        );
      }
      return activeLayout;
    }

    return activeLayout;
  }

  function onState(state) {
    if (!activeLayout) return;

    try {
      activeLayout.onState(
        state,
        activeContext
      );
    } catch (err) {
      console.warn(
        "layout onState failed",
        activeId,
        err
      );
    }
  }

  function update(now, state) {
    if (!activeLayout) return;

    return activeLayout.update(
      now,
      state,
      activeContext
    );
  }

  function render(now, state) {
    if (!activeLayout) return;

    return activeLayout.render(
      now,
      state,
      activeContext
    );
  }

  window.BonecoLayoutRegistry = {
    register,
    has,
    list,
    activate,
    onState,
    update,
    render,
    get activeId() {
      return activeId;
    },
  };
})();
