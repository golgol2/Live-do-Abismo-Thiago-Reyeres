#!/usr/bin/env python3
"""Remove fundo verde dos videos do avatar e gera WebM VP9 com alpha."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import time
from pathlib import Path

try:
    import cv2
    import numpy as np
except ModuleNotFoundError:
    cv2 = None
    np = None


def backup_file(path: Path) -> None:
    if not path.exists():
        return
    backup_dir = path.parent / "bkp"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f"{path.stem}_antes_reprocess_{int(time.time())}{path.suffix}"
    shutil.copy2(path, backup)


def parse_color_tuple(value: str) -> tuple[int, int, int]:
    text = value.strip().lower().removeprefix("#").removeprefix("0x")
    if len(text) != 6:
        raise ValueError("Cor chave invalida. Use #RRGGBB.")
    return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)


def parse_color(value: str):
    rgb = parse_color_tuple(value)
    return np.array(rgb, dtype=np.float32)


def process_video(args: argparse.Namespace) -> None:
    if cv2 is not None and np is not None:
        process_video_opencv(args)
        return
    process_video_ffmpeg(args)


def build_alpha(frame_rgb, key_rgb, similarity: float, blend: float):
    distance = np.linalg.norm(frame_rgb.astype(np.float32) - key_rgb.reshape(1, 1, 3), axis=2)
    distance = distance / (np.sqrt(3) * 255.0)
    alpha = np.clip((distance - similarity) / max(0.001, blend), 0.0, 1.0)
    return (alpha * 255.0).astype(np.uint8)


def process_frame(
    frame_bgr,
    *,
    key_rgb,
    similarity: float,
    blend: float,
    edge_px: int,
    blur_px: float,
    despill: float,
    target_size: tuple[int, int] | None,
    fit: str,
):
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    alpha = build_alpha(frame_rgb, key_rgb, similarity, blend)

    if edge_px > 0:
        kernel = np.ones((3, 3), np.uint8)
        alpha = cv2.erode(alpha, kernel, iterations=edge_px)
    elif edge_px < 0:
        kernel = np.ones((3, 3), np.uint8)
        alpha = cv2.dilate(alpha, kernel, iterations=abs(edge_px))

    if blur_px > 0:
        k = max(3, int(round(blur_px * 4)) | 1)
        alpha = cv2.GaussianBlur(alpha, (k, k), blur_px)

    rgb = frame_rgb.astype(np.float32)
    if despill > 0:
        r = rgb[:, :, 0]
        g = rgb[:, :, 1]
        b = rgb[:, :, 2]
        excess = np.maximum(0.0, g - np.maximum(r, b))
        alpha_norm = alpha.astype(np.float32) / 255.0
        rgb[:, :, 1] = np.clip(g - excess * despill * (1.0 - alpha_norm * 0.25), 0, 255)

    rgba = np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), alpha])
    if target_size:
        if fit == "stretch":
            rgba = cv2.resize(rgba, target_size, interpolation=cv2.INTER_LANCZOS4)
        else:
            tw, th = target_size
            h, w = rgba.shape[:2]
            scale = max(tw / max(1, w), th / max(1, h))
            resized = cv2.resize(
                rgba,
                (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                interpolation=cv2.INTER_LANCZOS4,
            )
            rh, rw = resized.shape[:2]
            left = max(0, (rw - tw) // 2)
            top = max(0, (rh - th) // 2)
            rgba = resized[top : top + th, left : left + tw]
    return rgba


def ffprobe_fps(path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    text = (proc.stdout or "24/1").strip()
    try:
        if "/" in text:
            num, den = text.split("/", 1)
            den_f = float(den or 1)
            return float(num or 24) / (den_f if den_f else 1)
        return float(text or 24)
    except ValueError:
        return 24.0


def process_video_opencv(args: argparse.Namespace) -> None:
    source = Path(args.source).expanduser().resolve()
    destination = Path(args.destination).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Fonte nao encontrada: {source}")

    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise RuntimeError(f"Nao foi possivel abrir: {source}")

    source_fps = ffprobe_fps(source)
    speed = max(0.05, float(args.speed or 1.0))
    fps = (source_fps or 24.0) * speed
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    target_size = None
    if args.width and args.height:
        target_size = (int(args.width), int(args.height))
        out_w, out_h = target_size
    else:
        out_w, out_h = src_w, src_h

    destination.parent.mkdir(parents=True, exist_ok=True)
    backup_file(destination)
    temp = destination.with_suffix(".tmp.webm")
    if temp.exists():
        temp.unlink()

    ffmpeg_cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-s",
        f"{out_w}x{out_h}",
        "-r",
        f"{fps:.6f}",
        "-i",
        "-",
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-row-mt",
        "1",
        "-threads",
        "0",
        "-deadline",
        "good",
        "-cpu-used",
        str(args.cpu_used),
        "-metadata:s:v:0",
        "alpha_mode=1",
        "-b:v",
        "0",
        "-crf",
        str(args.crf),
        str(temp),
    ]
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None

    key_rgb = parse_color(args.key_color)
    written = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if args.mirror:
                frame = cv2.flip(frame, 1)
            rgba = process_frame(
                frame,
                key_rgb=key_rgb,
                similarity=float(args.similarity),
                blend=float(args.blend),
                edge_px=int(args.edge_px),
                blur_px=float(args.blur_px),
                despill=float(args.despill),
                target_size=target_size,
                fit=str(args.fit),
            )
            proc.stdin.write(rgba.tobytes())
            written += 1
    finally:
        cap.release()
        try:
            proc.stdin.close()
        except BrokenPipeError:
            pass

    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"ffmpeg falhou ao gravar {destination} rc={rc}")
    if written <= 0:
        raise RuntimeError("Nenhum frame foi processado.")
    temp.replace(destination)
    print(f"ok {destination} frames={written} src={src_w}x{src_h} out={out_w}x{out_h} speed={speed:.3f}x")


def process_video_ffmpeg(args: argparse.Namespace) -> None:
    source = Path(args.source).expanduser().resolve()
    destination = Path(args.destination).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Fonte nao encontrada: {source}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    backup_file(destination)
    temp = destination.with_suffix(".tmp.webm")
    if temp.exists():
        temp.unlink()

    rgb = parse_color_tuple(args.key_color)
    color_key = f"0x{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
    similarity = max(0.00001, min(1.0, float(args.similarity)))
    blend = max(0.0, min(1.0, float(args.blend)))
    despill = max(0.0, min(1.0, float(args.despill)))
    speed = max(0.05, float(args.speed or 1.0))
    edge = max(-8, min(8, int(args.edge_px or 0)))
    blur = max(0.0, min(8.0, float(args.blur_px or 0.0)))
    screen_type = "blue" if rgb[2] > rgb[1] and rgb[2] > rgb[0] else "green"

    filters = [f"setpts=PTS/{speed:.6f}"]
    if args.mirror:
        filters.append("hflip")
    if int(args.width) > 0 and int(args.height) > 0:
        if str(args.fit) == "stretch":
            filters.append(f"scale={int(args.width)}:{int(args.height)}:flags=lanczos")
        else:
            filters.append(
                f"scale={int(args.width)}:{int(args.height)}:force_original_aspect_ratio=increase:flags=lanczos"
            )
            filters.append(f"crop={int(args.width)}:{int(args.height)}")

    filters.append("format=rgba")
    if despill > 0:
        filters.append(f"despill=type={screen_type}:mix={despill:.3f}:green=-1")
    filters.extend([f"colorkey={color_key}:{similarity:.4f}:{blend:.4f}", "format=rgba"])

    alpha_filters: list[str] = []
    if edge > 0:
        alpha_filters.extend(["erosion=coordinates=255"] * edge)
    elif edge < 0:
        alpha_filters.extend(["dilation=coordinates=255"] * abs(edge))
    if blur > 0:
        alpha_filters.append(f"boxblur=lr={blur:.2f}:lp=1")
    alpha_chain = ",".join(alpha_filters) if alpha_filters else "null"

    filter_expr = (
        f"[0:v]{','.join(filters)}[cksrc];"
        f"[cksrc]split[ck][ckalpha];"
        f"[ckalpha]alphaextract,{alpha_chain}[a];"
        f"[ck][a]alphamerge,format=yuva420p[v]"
    )
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-filter_complex",
        filter_expr,
        "-map",
        "[v]",
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-row-mt",
        "1",
        "-threads",
        "0",
        "-deadline",
        "good",
        "-cpu-used",
        str(args.cpu_used),
        "-metadata:s:v:0",
        "alpha_mode=1",
        "-b:v",
        "0",
        "-crf",
        str(args.crf),
        str(temp),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "ffmpeg falhou").strip())
    temp.replace(destination)
    print(f"ok {destination} ffmpeg-alpha speed={speed:.3f}x")


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove chroma de video do avatar e gera VP9 alpha.")
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--key-color", default="#09e318")
    parser.add_argument("--similarity", type=float, default=0.165)
    parser.add_argument("--blend", type=float, default=0.106)
    parser.add_argument("--edge-px", type=int, default=2)
    parser.add_argument("--blur-px", type=float, default=0.7)
    parser.add_argument("--despill", type=float, default=0.75)
    parser.add_argument("--width", type=int, default=832)
    parser.add_argument("--height", type=int, default=1472)
    parser.add_argument("--fit", choices=["cover", "stretch"], default="cover")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--crf", type=int, default=20)
    parser.add_argument("--cpu-used", type=int, default=4)
    parser.add_argument("--mirror", action="store_true")
    args = parser.parse_args()
    process_video(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
