#!/usr/bin/env python3
from __future__ import annotations

import argparse
import signal
import subprocess
import sys

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GLib", "2.0")
from gi.repository import GLib, Gst  # noqa: E402


WIDTH = 720
HEIGHT = 1280
FPS = 30


def main() -> None:
    args = parse_args()
    Gst.init(None)
    attempts = 0
    while True:
        error, stopped = run_pipeline(args)
        if stopped or not error:
            return
        if not should_retry_rtmp(args, attempts):
            raise SystemExit(1)
        attempts += 1
        print(
            f"[html-capture] RTMP remoto fechou a conexao; reiniciando captura {attempts}/{args.rtmp_restart_max}",
            file=sys.stderr,
            flush=True,
        )


def run_pipeline(args: argparse.Namespace) -> tuple[bool, bool]:
    ffmpeg_process: subprocess.Popen | None = None
    if should_forward_with_ffmpeg(args):
        ffmpeg_process = start_ffmpeg_forwarder(args)
        if ffmpeg_process.stdin is None:
            raise RuntimeError("Falha ao abrir stdin do ffmpeg.")
        args.ffmpeg_fd = int(ffmpeg_process.stdin.fileno())
    pipeline = Gst.parse_launch(build_pipeline(args))
    if not isinstance(pipeline, Gst.Pipeline):
        raise RuntimeError("Falha ao criar pipeline GStreamer.")

    loop = GLib.MainLoop()
    state = {"error": False, "stopping": False}
    bus = pipeline.get_bus()
    bus.add_signal_watch()
    bus.connect("message", on_bus_message, loop, state)

    def stop(_signum: int, _frame: object) -> None:
        state["stopping"] = True
        loop.quit()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)
        if ffmpeg_process is not None:
            try:
                if ffmpeg_process.stdin:
                    ffmpeg_process.stdin.close()
            except BrokenPipeError:
                pass
            except Exception:
                pass
            try:
                ffmpeg_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                ffmpeg_process.terminate()
                try:
                    ffmpeg_process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    ffmpeg_process.kill()
                    ffmpeg_process.wait(timeout=3)
            if ffmpeg_process.returncode not in (None, 0) and not state.get("stopping"):
                state["error"] = True
                print(f"[html-capture] ffmpeg encerrou rc={ffmpeg_process.returncode}", file=sys.stderr, flush=True)
    return bool(state.get("error")), bool(state.get("stopping"))


def build_pipeline(args: argparse.Namespace) -> str:
    bitrate = max(300, min(12000, int(args.video_bitrate)))
    return " ".join([
        *video_branch(args, bitrate),
        *audio_branch(args),
        *output_branch(args),
    ])


def video_branch(args: argparse.Namespace, bitrate: int) -> list[str]:
    return [
        "ximagesrc",
        f"display-name={gst_quote(args.display)}",
        "use-damage=false",
        "show-pointer=false",
        "do-timestamp=true",
        "!",
        f"video/x-raw,framerate={FPS}/1",
        "!",
        "queue",
        "leaky=downstream",
        "max-size-buffers=2",
        "!",
        "videoconvert",
        "!",
        "videoscale",
        "!",
        f"video/x-raw,width={WIDTH},height={HEIGHT},format=BGRA",
        "!",
        "compositor",
        "name=comp",
        "force-live=true",
        "ignore-inactive-pads=true",
        "background=black",
        "sink_0::xpos=0",
        "sink_0::ypos=0",
        "sink_0::zorder=0",
        "!",
        "queue",
        "leaky=downstream",
        "max-size-buffers=2",
        "max-size-time=0",
        "max-size-bytes=0",
        "!",
        "videoconvert",
        "!",
        "queue",
        "!",
        *encoder_branch(args, bitrate),
        "h264parse",
        "config-interval=1",
        "!",
        "queue",
        "!",
        "mux.",
    ]


def encoder_branch(args: argparse.Namespace, bitrate: int) -> list[str]:
    requested = str(args.video_encoder or "x264").lower().strip()
    if requested == "nvenc" and Gst.ElementFactory.find("nvh264enc") is not None:
        print("[html-capture] video encoder=nvh264enc", file=sys.stderr, flush=True)
        return [
            f"video/x-raw,format=NV12,width={WIDTH},height={HEIGHT},framerate={FPS}/1",
            "!",
            "nvh264enc",
            f"bitrate={bitrate}",
            f"gop-size={FPS * 2}",
            "preset=low-latency-hp",
            "rc-mode=cbr",
            "zerolatency=true",
            "bframes=0",
            "!",
        ]
    print("[html-capture] video encoder=x264enc", file=sys.stderr, flush=True)
    return [
        f"video/x-raw,format=I420,width={WIDTH},height={HEIGHT},framerate={FPS}/1",
        "!",
        "x264enc",
        "tune=zerolatency",
        "speed-preset=ultrafast",
        "threads=0",
        "sliced-threads=true",
        "bframes=0",
        "byte-stream=true",
        f"bitrate={bitrate}",
        f"key-int-max={FPS * 2}",
        "!",
    ]


def audio_branch(args: argparse.Namespace) -> list[str]:
    if not args.audio_source:
        raise RuntimeError("audio-source vazio; informe uma fonte .monitor para evitar capturar microfone.")
    return [
        "pulsesrc",
        "do-timestamp=true",
        f"device={gst_quote(args.audio_source)}",
        "!",
        "queue",
        "leaky=downstream",
        "max-size-buffers=8",
        "!",
        "audioconvert",
        "!",
        "audioresample",
        "!",
        "audio/x-raw,rate=44100,channels=2",
        "!",
        "level",
        "name=html_audio_level",
        "interval=1000000000",
        "message=true",
        "!",
        "avenc_aac",
        "bitrate=128000",
        "!",
        "aacparse",
        "!",
        "queue",
        "!",
        "mux.",
    ]


def output_branch(args: argparse.Namespace) -> list[str]:
    base = ["flvmux", "name=mux", "streamable=true", "!"]
    if args.output_file:
        return [*base, "filesink", f"location={gst_quote(args.output_file)}", "sync=false"]
    if not args.rtmp_url:
        raise RuntimeError("rtmp-url vazio e output-file vazio.")
    if args.rtmp_sink == "ffmpeg":
        fd = int(getattr(args, "ffmpeg_fd", 1))
        return [
            *base,
            "queue",
            "leaky=downstream",
            "max-size-buffers=8",
            "max-size-time=0",
            "max-size-bytes=0",
            "!",
            "fdsink",
            f"fd={fd}",
            "sync=false",
        ]
    sink = "rtmp2sink" if args.rtmp_sink == "rtmp2sink" else "rtmpsink"
    return [
        *base,
        "queue",
        "leaky=downstream",
        "max-size-buffers=8",
        "max-size-time=0",
        "max-size-bytes=0",
        "!",
        sink,
        f"location={gst_quote(args.rtmp_url)}",
        "sync=false",
        "async=false",
    ]


def on_bus_message(_bus: Gst.Bus, message: Gst.Message, loop: GLib.MainLoop, state: dict[str, bool]) -> None:
    if message.type == Gst.MessageType.ERROR:
        err, debug = message.parse_error()
        state["error"] = True
        print(f"[html-capture] erro GStreamer: {err} {debug or ''}", file=sys.stderr, flush=True)
        loop.quit()
    elif message.type == Gst.MessageType.EOS:
        loop.quit()
    elif message.type == Gst.MessageType.WARNING:
        err, debug = message.parse_warning()
        print(f"[html-capture] aviso GStreamer: {err} {debug or ''}", file=sys.stderr, flush=True)
    elif message.type == Gst.MessageType.ELEMENT:
        structure = message.get_structure()
        if structure is not None and structure.get_name() == "level":
            rms = structure.get_value("rms")
            peak = structure.get_value("peak")
            print(f"[html-capture] audio level rms={rms} peak={peak}", file=sys.stderr, flush=True)


def should_retry_rtmp(args: argparse.Namespace, attempts: int) -> bool:
    if attempts >= max(0, int(args.rtmp_restart_max)):
        return False
    if args.output_file:
        return False
    return bool(str(args.rtmp_url or "").strip())


def should_forward_with_ffmpeg(args: argparse.Namespace) -> bool:
    return str(args.rtmp_sink or "").strip().lower() == "ffmpeg" and bool(str(args.rtmp_url or "").strip()) and not args.output_file


def start_ffmpeg_forwarder(args: argparse.Namespace) -> subprocess.Popen:
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "info",
        "-nostdin",
        "-analyzeduration",
        "5M",
        "-probesize",
        "10M",
        "-thread_queue_size",
        "8192",
        "-f",
        "flv",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-c:v",
        "copy",
        "-map",
        "0:a:0",
        "-c:a",
        "copy",
        "-flvflags",
        "no_duration_filesize",
        "-f",
        "flv",
        str(args.rtmp_url).strip(),
    ]
    print("[html-capture] saida RTMP via ffmpeg", file=sys.stderr, flush=True)
    return subprocess.Popen(command, stdin=subprocess.PIPE)


def gst_quote(value: object) -> str:
    text = str(value or "")
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Captura renderer HTML 720x1280 para RTMP/arquivo.")
    parser.add_argument("--display", required=True)
    parser.add_argument("--audio-source", required=True)
    parser.add_argument("--rtmp-url", default="")
    parser.add_argument("--rtmp-sink", choices=("ffmpeg", "rtmpsink", "rtmp2sink"), default="rtmp2sink")
    parser.add_argument("--output-file", default="")
    parser.add_argument("--video-bitrate", type=int, default=3100)
    parser.add_argument("--video-encoder", choices=("x264", "nvenc", "auto"), default="nvenc")
    parser.add_argument("--rtmp-restart-max", type=int, default=1)
    return parser.parse_args()


if __name__ == "__main__":
    main()
