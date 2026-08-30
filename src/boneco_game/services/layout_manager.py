from __future__ import annotations

import random
import threading
import time
import uuid
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import RUNS_DIR


LAYOUT_STATE_FILE = RUNS_DIR / "layout_state.json"

_LAYOUT_LOCK = threading.RLock()
_RANDOM = random.SystemRandom()


LAYOUT_CATALOG: tuple[dict[str, object], ...] = (
    {
        "id": "classic",
        "name": "Classic",
        "description": "Cenário procedural clássico.",
        "enabled_by_default": True,
        "backend_module": "classic",
        "backend_route": "/api/layouts/classic",
        "frontend_module": "/static/js/layouts/classic.js",
        "css": "/static/css/layouts/classic.css",
    },
    {
        "id": "orbital_cathedral",
        "name": "Catedral Orbital",
        "description": "Plasma, piso orbital, linhas e Super Cubo Social.",
        "enabled_by_default": True,
        "backend_module": "orbital_cathedral",
        "backend_route": "/api/layouts/orbital_cathedral",
        "frontend_module": "/static/js/layouts/orbital_cathedral.js",
        "css": "/static/css/layouts/orbital_cathedral.css",
    },
    {
        "id": "neon_triangle_tower",
        "name": "Torre Triangular Neon",
        "description": "Piso triangular escuro, energia RGB e torre 3D com fotos dos usuarios.",
        "enabled_by_default": True,
        "backend_module": "neon_triangle_tower",
        "backend_route": "/api/layouts/neon_triangle_tower",
        "frontend_module": "/static/js/layouts/neon_triangle_tower.js",
        "css": "/static/css/layouts/neon_triangle_tower.css",
    },
)


def layout_catalog() -> list[dict[str, object]]:
    return [dict(item) for item in LAYOUT_CATALOG]


def _known_ids() -> list[str]:
    return [
        str(item["id"])
        for item in LAYOUT_CATALOG
    ]


def _default_enabled() -> list[str]:
    return [
        str(item["id"])
        for item in LAYOUT_CATALOG
        if bool(item.get("enabled_by_default"))
    ]


def default_layout_state() -> dict[str, Any]:
    return {
        "layout_mode": "random",
        "active_layout": "",
        "manual_layout": "",
        "enabled_layouts": _default_enabled(),
        "layout_session_id": "",
        "layout_reservation": {},
        "rotation_remaining": [],
        "last_used": "",
        "updated_at": time.time(),
    }


def _clean_enabled(value: object) -> list[str]:
    known = _known_ids()

    raw = value if isinstance(value, list) else []

    selected = {
        str(item).strip()
        for item in raw
        if str(item).strip() in known
    }

    return [
        layout_id
        for layout_id in known
        if layout_id in selected
    ]


def _normalize_state(raw: object) -> dict[str, Any]:
    state = default_layout_state()

    if isinstance(raw, dict):
        state.update(raw)

    known = _known_ids()

    enabled = _clean_enabled(
        state.get("enabled_layouts")
    )

    if not enabled:
        enabled = _default_enabled()
    else:
        for layout_id in _default_enabled():
            if layout_id not in enabled:
                enabled.append(layout_id)

    mode = str(
        state.get("layout_mode") or "random"
    ).strip().lower()

    if mode not in {"random", "manual"}:
        mode = "random"

    manual = str(
        state.get("manual_layout") or ""
    ).strip()

    if manual not in known:
        manual = ""

    if mode == "manual" and manual not in enabled:
        mode = "random"

    active = str(
        state.get("active_layout") or ""
    ).strip()

    if active not in known:
        active = ""

    last_used = str(
        state.get("last_used") or ""
    ).strip()

    if last_used not in known:
        last_used = ""

    remaining_raw = state.get(
        "rotation_remaining"
    )

    remaining: list[str] = []

    if isinstance(remaining_raw, list):
        for item in remaining_raw:
            layout_id = str(item).strip()

            if (
                layout_id in enabled
                and layout_id not in remaining
            ):
                remaining.append(layout_id)

    reservation_raw = state.get("layout_reservation")
    reservation: dict[str, Any] = {}

    if isinstance(reservation_raw, dict):
        reservation_id = str(
            reservation_raw.get("id") or ""
        ).strip()

        reservation_layout = str(
            reservation_raw.get("layout") or ""
        ).strip()

        reservation_mode = str(
            reservation_raw.get("mode") or ""
        ).strip().lower()

        if (
            reservation_id
            and reservation_layout in known
            and reservation_mode in {"random", "manual"}
        ):
            remaining_after: list[str] = []

            raw_after = reservation_raw.get(
                "rotation_remaining_after"
            )

            if isinstance(raw_after, list):
                for item in raw_after:
                    layout_id = str(item).strip()

                    if (
                        layout_id in known
                        and layout_id not in remaining_after
                    ):
                        remaining_after.append(layout_id)

            previous_active = str(
                reservation_raw.get(
                    "previous_active_layout"
                )
                or ""
            ).strip()

            if previous_active not in known:
                previous_active = ""

            reservation = {
                "id": reservation_id,
                "layout": reservation_layout,
                "mode": reservation_mode,
                "rotation_remaining_after": remaining_after,
                "previous_active_layout": previous_active,
                "previous_layout_session_id": str(
                    reservation_raw.get(
                        "previous_layout_session_id"
                    )
                    or ""
                ),
                "previous_layout_hint": str(
                    reservation_raw.get(
                        "previous_layout_hint"
                    )
                    or ""
                ),
                "created_at": float(
                    reservation_raw.get(
                        "created_at"
                    )
                    or 0
                ),
            }

    return {
        "layout_mode": mode,
        "active_layout": active,
        "manual_layout": manual,
        "enabled_layouts": enabled,
        "layout_session_id": str(
            state.get("layout_session_id") or ""
        ),
        "layout_reservation": reservation,
        "rotation_remaining": remaining,
        "last_used": last_used,
        "updated_at": float(
            state.get("updated_at") or 0
        ),
    }


def _read_unlocked() -> dict[str, Any]:
    return _normalize_state(
        read_json(
            LAYOUT_STATE_FILE,
            {},
        )
    )


def read_layout_state() -> dict[str, Any]:
    with _LAYOUT_LOCK:
        return _read_unlocked()


def _public(
    state: dict[str, Any],
) -> dict[str, Any]:
    return {
        **state,
        "catalog": layout_catalog(),
    }


def public_layout_state() -> dict[str, Any]:
    with _LAYOUT_LOCK:
        return _public(
            _read_unlocked()
        )


def save_layout_config(
    *,
    layout_mode: object = None,
    manual_layout: object = None,
    enabled_layouts: object = None,
) -> dict[str, Any]:
    with _LAYOUT_LOCK:
        state = _read_unlocked()

        old_enabled = list(
            state["enabled_layouts"]
        )

        if enabled_layouts is not None:
            enabled = _clean_enabled(
                enabled_layouts
            )

            if not enabled:
                raise ValueError(
                    "Habilite pelo menos um layout."
                )

            state["enabled_layouts"] = enabled

        if manual_layout is not None:
            manual = str(
                manual_layout or ""
            ).strip()

            if manual and manual not in _known_ids():
                raise ValueError(
                    f"Layout desconhecido: {manual}"
                )

            state["manual_layout"] = manual

        if layout_mode is not None:
            mode = str(
                layout_mode or "random"
            ).strip().lower()

            if mode not in {
                "random",
                "manual",
            }:
                raise ValueError(
                    "layout_mode deve ser random ou manual."
                )

            state["layout_mode"] = mode

        if (
            state["layout_mode"] == "manual"
            and not state["manual_layout"]
        ):
            raise ValueError(
                "Escolha um layout para o modo forçado."
            )

        if (
            state["layout_mode"] == "manual"
            and state["manual_layout"]
            not in state["enabled_layouts"]
        ):
            raise ValueError(
                "O layout forçado precisa estar habilitado."
            )

        if old_enabled != state["enabled_layouts"]:
            state["rotation_remaining"] = []

        state["updated_at"] = time.time()

        write_json_atomic(
            LAYOUT_STATE_FILE,
            state,
        )

        return _public(state)


def _new_random_bag(
    enabled: list[str],
    *,
    avoid_first: str = "",
) -> list[str]:
    bag = list(enabled)
    _RANDOM.shuffle(bag)

    if (
        len(bag) > 1
        and avoid_first
        and bag[0] == avoid_first
    ):
        for index in range(1, len(bag)):
            if bag[index] != avoid_first:
                bag[0], bag[index] = (
                    bag[index],
                    bag[0],
                )
                break

    return bag


def _restore_pending_reservation(
    state: dict[str, Any],
) -> str:
    reservation = state.get("layout_reservation")

    if not isinstance(reservation, dict) or not reservation:
        return ""

    previous_hint = str(
        reservation.get("previous_layout_hint")
        or ""
    ).strip()

    previous_active = str(
        reservation.get("previous_active_layout")
        or ""
    ).strip()

    if previous_active not in _known_ids():
        previous_active = ""

    state["active_layout"] = previous_active

    state["layout_session_id"] = str(
        reservation.get(
            "previous_layout_session_id"
        )
        or ""
    )

    state["layout_reservation"] = {}

    return previous_hint


def reserve_layout_session(
    *,
    previous_layout: str = "",
) -> dict[str, Any]:
    with _LAYOUT_LOCK:
        state = _read_unlocked()

        stale_previous_hint = (
            _restore_pending_reservation(state)
        )

        enabled = list(
            state["enabled_layouts"]
        )

        if not enabled:
            enabled = _default_enabled()
            state["enabled_layouts"] = enabled

        previous_active = str(
            state.get("active_layout")
            or ""
        )

        previous_session_id = str(
            state.get("layout_session_id")
            or ""
        )

        mode = str(
            state["layout_mode"]
        )

        if (
            mode == "manual"
            and state["manual_layout"] in enabled
        ):
            selected = str(
                state["manual_layout"]
            )

            remaining_after = list(
                state["rotation_remaining"]
            )

        else:
            remaining = [
                item
                for item in state["rotation_remaining"]
                if item in enabled
            ]

            avoid = (
                str(state.get("last_used") or "").strip()
                or stale_previous_hint
                or str(previous_layout or "").strip()
            )

            if (
                remaining
                and len(remaining) > 1
                and remaining[0] == avoid
            ):
                for index in range(
                    1,
                    len(remaining),
                ):
                    if remaining[index] != avoid:
                        remaining[0], remaining[index] = (
                            remaining[index],
                            remaining[0],
                        )
                        break

            if (
                len(remaining) == 1
                and len(enabled) > 1
                and remaining[0] == avoid
            ):
                remaining = []

            if not remaining:
                remaining = _new_random_bag(
                    enabled,
                    avoid_first=avoid,
                )

            selected = remaining[0]
            remaining_after = remaining[1:]

        reservation_id = uuid.uuid4().hex

        state["active_layout"] = selected
        state["layout_session_id"] = reservation_id

        state["layout_reservation"] = {
            "id": reservation_id,
            "layout": selected,
            "mode": mode,
            "rotation_remaining_after": (
                remaining_after
            ),
            "previous_active_layout": (
                previous_active
            ),
            "previous_layout_session_id": (
                previous_session_id
            ),
            "previous_layout_hint": (
                stale_previous_hint
                or str(previous_layout or "").strip()
            ),
            "created_at": time.time(),
        }

        # IMPORTANTE:
        # rotation_remaining e last_used ainda NÃO mudam.
        state["updated_at"] = time.time()

        write_json_atomic(
            LAYOUT_STATE_FILE,
            state,
        )

        return _public(state)


def confirm_layout_session(
    session_id: str,
) -> dict[str, Any]:
    with _LAYOUT_LOCK:
        state = _read_unlocked()

        clean_id = str(
            session_id or ""
        ).strip()

        reservation = state.get(
            "layout_reservation"
        )

        # Confirmação idempotente.
        if not isinstance(reservation, dict) or not reservation:
            if (
                clean_id
                and clean_id
                == str(
                    state.get(
                        "layout_session_id"
                    )
                    or ""
                )
            ):
                return _public(state)

            raise ValueError(
                "Reserva de layout inexistente."
            )

        reservation_id = str(
            reservation.get("id")
            or ""
        )

        if (
            not clean_id
            or clean_id != reservation_id
        ):
            raise ValueError(
                "Reserva de layout não corresponde à sessão."
            )

        selected = str(
            reservation.get("layout")
            or ""
        )

        mode = str(
            reservation.get("mode")
            or "random"
        )

        if selected not in _known_ids():
            raise ValueError(
                "Layout reservado é inválido."
            )

        if mode == "random":
            enabled = set(
                state["enabled_layouts"]
            )

            remaining_after = [
                item
                for item in reservation.get(
                    "rotation_remaining_after",
                    [],
                )
                if item in enabled
            ]

            state["rotation_remaining"] = (
                remaining_after
            )

            state["last_used"] = selected

        # Manual não consome nem altera o shuffle bag.
        state["active_layout"] = selected
        state["layout_session_id"] = reservation_id
        state["layout_reservation"] = {}
        state["updated_at"] = time.time()

        write_json_atomic(
            LAYOUT_STATE_FILE,
            state,
        )

        return _public(state)


def cancel_layout_session(
    session_id: str,
) -> dict[str, Any]:
    with _LAYOUT_LOCK:
        state = _read_unlocked()

        reservation = state.get(
            "layout_reservation"
        )

        if not isinstance(reservation, dict) or not reservation:
            return _public(state)

        clean_id = str(
            session_id or ""
        ).strip()

        reservation_id = str(
            reservation.get("id")
            or ""
        )

        # Não cancela uma reserva diferente.
        if (
            clean_id
            and clean_id != reservation_id
        ):
            return _public(state)

        previous_active = str(
            reservation.get(
                "previous_active_layout"
            )
            or ""
        )

        if previous_active not in _known_ids():
            previous_active = ""

        state["active_layout"] = (
            previous_active
        )

        state["layout_session_id"] = str(
            reservation.get(
                "previous_layout_session_id"
            )
            or ""
        )

        # rotation_remaining e last_used nunca foram
        # consumidos, portanto não precisam de restauração.
        state["layout_reservation"] = {}
        state["updated_at"] = time.time()

        write_json_atomic(
            LAYOUT_STATE_FILE,
            state,
        )

        return _public(state)


def begin_layout_session(
    *,
    previous_layout: str = "",
) -> dict[str, Any]:
    """Compatibilidade: seleciona e confirma imediatamente."""
    reserved = reserve_layout_session(
        previous_layout=previous_layout
    )

    return confirm_layout_session(
        str(
            reserved.get(
                "layout_session_id"
            )
            or ""
        )
    )
