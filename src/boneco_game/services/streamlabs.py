from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
import uuid


class StreamlabsTikTokError(RuntimeError):
    pass


class StreamlabsTikTokClient:
    API_BASE = "https://streamlabs.com/api/v5/slobs/tiktok"

    def __init__(self, token: str) -> None:
        token = token.strip()
        if not token:
            raise StreamlabsTikTokError("Token Streamlabs nao configurado.")
        self.token = token

    def _headers(self) -> dict[str, str]:
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "StreamlabsDesktop/1.20.4 Chrome/122.0.6261.156 "
                "Electron/29.3.1 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Authorization": f"Bearer {self.token}",
        }

    def _request_json(self, request: urllib.request.Request, *, timeout: int = 30) -> dict:
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise StreamlabsTikTokError(f"Streamlabs HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise StreamlabsTikTokError(f"Falha de rede Streamlabs: {exc.reason}") from exc
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise StreamlabsTikTokError(f"Streamlabs retornou resposta invalida: {raw[:300]}") from exc
        if isinstance(data, dict) and data.get("success") is False:
            raise StreamlabsTikTokError(f"Streamlabs recusou a operacao: {data}")
        if not isinstance(data, dict):
            raise StreamlabsTikTokError("Streamlabs retornou JSON inesperado.")
        return data

    def search_categories(self, game_name: str) -> list[dict]:
        game_name = (game_name or "").strip()
        if not game_name:
            return [{"full_name": "Other", "game_mask_id": ""}]
        query = urllib.parse.urlencode({"category": game_name[:25]})
        request = urllib.request.Request(f"{self.API_BASE}/info?{query}", headers=self._headers(), method="GET")
        data = self._request_json(request)
        categories = data.get("categories") or []
        if not isinstance(categories, list):
            categories = []
        categories.append({"full_name": "Other", "game_mask_id": ""})
        return categories

    def resolve_category_id(self, game_name: str) -> str:
        game_name = (game_name or "").strip()
        if not game_name:
            return ""
        categories = self.search_categories(game_name)
        lowered = game_name.lower()
        for category in categories:
            if str(category.get("full_name") or "").lower() == lowered:
                return str(category.get("game_mask_id") or "")
        for category in categories:
            full_name = str(category.get("full_name") or "").lower()
            if lowered in full_name or full_name in lowered:
                return str(category.get("game_mask_id") or "")
        return ""

    def start_stream(self, title: str, category: str, audience_type: str = "0") -> dict[str, str]:
        fields = {
            "title": (title or "Live Do Boneco do Abismo").strip(),
            "device_platform": "win32",
            "category": category or "",
            "audience_type": "1" if str(audience_type) == "1" else "0",
        }
        body, boundary = self._multipart_body(fields)
        headers = self._headers()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        request = urllib.request.Request(
            f"{self.API_BASE}/stream/start",
            data=body,
            headers=headers,
            method="POST",
        )
        data = self._request_json(request, timeout=45)
        rtmp = str(data.get("rtmp") or "").strip().rstrip("/")
        key = str(data.get("key") or "").strip().lstrip("/")
        stream_id = str(data.get("id") or "").strip()
        if not rtmp or not key:
            raise StreamlabsTikTokError(f"Streamlabs nao retornou rtmp/key: {data}")
        return {"rtmp": rtmp, "key": key, "id": stream_id, "rtmp_url": f"{rtmp}/{key}"}

    def end_stream(self, stream_id: str) -> bool:
        stream_id = str(stream_id or "").strip()
        if not stream_id:
            return False
        request = urllib.request.Request(
            f"{self.API_BASE}/stream/{urllib.parse.quote(stream_id)}/end",
            data=b"",
            headers=self._headers(),
            method="POST",
        )
        data = self._request_json(request, timeout=30)
        return bool(data.get("success", True))

    @staticmethod
    def _multipart_body(fields: dict[str, str]) -> tuple[bytes, str]:
        boundary = f"----TikTokLiveV2{uuid.uuid4().hex}"
        parts: list[bytes] = []
        for name, value in fields.items():
            parts.append(f"--{boundary}\r\n".encode("utf-8"))
            parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
            parts.append(str(value).encode("utf-8"))
            parts.append(b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode("utf-8"))
        return b"".join(parts), boundary
