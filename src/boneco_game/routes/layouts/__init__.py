from __future__ import annotations

import importlib
from typing import Any

from fastapi import FastAPI

from boneco_game.services.layout_manager import layout_catalog


def _route_modules() -> list[str]:
    modules = ["control"]

    for layout in layout_catalog():
        module_name = str(
            layout.get("backend_module") or ""
        ).strip()

        if (
            module_name
            and module_name not in modules
        ):
            modules.append(module_name)

    return modules


def include_layout_routers(
    app: FastAPI,
) -> dict[str, str]:
    errors: dict[str, str] = {}

    package = __name__

    for module_name in _route_modules():
        try:
            module = importlib.import_module(
                f"{package}.{module_name}"
            )

            router = getattr(
                module,
                "router",
                None,
            )

            if router is None:
                raise RuntimeError(
                    "router ausente"
                )

            app.include_router(router)

        except Exception as exc:
            errors[module_name] = (
                f"{type(exc).__name__}: {exc}"
            )

    return errors
