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

    install_timestamp_probes(pipeline, state)
    pipeline.set_state(Gst.State.PLAYING)
    install_pipeline_diagnostics(pipeline, state)
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



def install_timestamp_probes(
    pipeline: Gst.Pipeline,
    state: dict,
) -> None:
    snapshots: dict[str, dict[str, int]] = {}
    state["timestamp_diag"] = snapshots

    def attach(label: str, element_name: str) -> None:
        element = pipeline.get_by_name(element_name)

        if element is None:
            raise RuntimeError(
                f"elemento de diagnostico ausente: {element_name}"
            )

        pad = element.get_static_pad("src")

        if pad is None:
            raise RuntimeError(
                f"src pad ausente: {element_name}"
            )

        snapshots[label] = {
            "count": 0,
            "first_pts": -1,
            "last_pts": -1,
            "last_dts": -1,
            "last_duration": -1,
        }

        def probe(_pad, info):
            buffer = info.get_buffer()

            if buffer is None:
                return Gst.PadProbeReturn.OK

            snap = snapshots[label]

            pts = (
                int(buffer.pts)
                if buffer.pts != Gst.CLOCK_TIME_NONE
                else -1
            )

            dts = (
                int(buffer.dts)
                if buffer.dts != Gst.CLOCK_TIME_NONE
                else -1
            )

            duration = (
                int(buffer.duration)
                if buffer.duration != Gst.CLOCK_TIME_NONE
                else -1
            )

            snap["count"] += 1

            if snap["first_pts"] < 0 and pts >= 0:
                snap["first_pts"] = pts

            snap["last_pts"] = pts
            snap["last_dts"] = dts
            snap["last_duration"] = duration

            return Gst.PadProbeReturn.OK

        pad.add_probe(
            Gst.PadProbeType.BUFFER,
            probe,
        )

    attach("aac", "html_audio_parse")
    attach("h264", "html_video_parse")
    attach("flv", "mux")


def install_pipeline_diagnostics(pipeline: Gst.Pipeline, state: dict[str, bool]) -> None:
    state["clock_logged"] = False

    def tick() -> bool:
        if state.get("stopping"):
            return False

        clock = pipeline.get_clock()
        clock_name = clock.get_name() if clock is not None else "none"

        if not state.get("clock_logged"):
            state["clock_logged"] = True
            print(
                f"[html-capture] pipeline clock={clock_name} base_time={pipeline.get_base_time()}",
                file=sys.stderr,
                flush=True,
            )

        audio_src = pipeline.get_by_name("html_audio_src")
        audio_rate = pipeline.get_by_name("html_audio_rate")

        def prop_int(element, name: str) -> int:
            if element is None:
                return -1
            try:
                return int(element.get_property(name))
            except Exception:
                return -1

        try:
            base_ns = int(pipeline.get_base_time())
        except Exception:
            base_ns = 0

        try:
            clock_ns = int(clock.get_time()) if clock is not None else 0
        except Exception:
            clock_ns = 0

        running_ns = (
            clock_ns - base_ns
            if base_ns > 0 and clock_ns >= base_ns
            else 0
        )

        def caps_text(element, pad_name: str) -> str:
            if element is None:
                return "missing"

            pad = element.get_static_pad(pad_name)

            if pad is None:
                return "no-pad"

            try:
                caps = pad.get_current_caps()
            except Exception:
                return "error"

            if caps is None:
                return "none"

            try:
                return caps.to_string()
            except Exception:
                return "error"

        print(
            "[html-capture] timing "
            f"clock={clock_name} "
            f"base_ns={base_ns} "
            f"clock_ns={clock_ns} "
            f"running_ns={running_ns} "
            f"rate_in={prop_int(audio_rate, 'in')} "
            f"rate_out={prop_int(audio_rate, 'out')} "
            f"rate_add={prop_int(audio_rate, 'add')} "
            f"rate_drop={prop_int(audio_rate, 'drop')} "
            f"buffer_us={prop_int(audio_src, 'actual-buffer-time')} "
            f"latency_us={prop_int(audio_src, 'actual-latency-time')} "
            f"rate_in_caps={caps_text(audio_rate, 'sink')!r} "
            f"rate_out_caps={caps_text(audio_rate, 'src')!r}",
            file=sys.stderr,
            flush=True,
        )

        queue_parts: list[str] = []
        for name in (
            "video_in_q",
            "video_post_comp_q",
            "audio_in_q",
            "audio_mux_q",
            "rtmp_out_q",
            "file_out_q",
        ):
            element = pipeline.get_by_name(name)
            if element is None:
                continue
            try:
                buffers = int(element.get_property("current-level-buffers"))
                level_time = int(element.get_property("current-level-time"))
            except Exception:
                continue
            queue_parts.append(
                f"{name}:buffers={buffers},ms={level_time / 1_000_000:.1f}"
            )

        if queue_parts:
            print(
                "[html-capture] queues " + " | ".join(queue_parts),
                file=sys.stderr,
                flush=True,
            )

        rtmp_sink = pipeline.get_by_name("html_rtmp_sink")
        if rtmp_sink is not None:
            try:
                stats = rtmp_sink.get_property("stats")
            except Exception:
                stats = None

            if stats is not None:
                def stat_int(name: str) -> int:
                    try:
                        return int(stats.get_value(name))
                    except Exception:
                        return -1

                out_total = stat_int("out-bytes-total")
                out_acked = stat_int("out-bytes-acked")
                unacked = (
                    out_total - out_acked
                    if out_total >= 0 and out_acked >= 0
                    else -1
                )
                print(
                    "[html-capture] rtmp2sink "
                    f"out_total={out_total} "
                    f"out_acked={out_acked} "
                    f"unacked={unacked} "
                    f"in_chunk={stat_int('in-chunk-size')} "
                    f"out_chunk={stat_int('out-chunk-size')} "
                    f"in_window_ack={stat_int('in-window-ack-size')} "
                    f"out_window_ack={stat_int('out-window-ack-size')}",
                    file=sys.stderr,
                    flush=True,
                )

        timestamp_diag = state.get("timestamp_diag") or {}
        timestamp_parts: list[str] = []

        for label in ("aac", "h264", "flv"):
            snap = timestamp_diag.get(label) or {}

            first_pts = int(snap.get("first_pts", -1))
            last_pts = int(snap.get("last_pts", -1))

            delta_pts = (
                last_pts - first_pts
                if first_pts >= 0 and last_pts >= first_pts
                else -1
            )

            timestamp_parts.append(
                f"{label}:"
                f"count={int(snap.get('count', 0))},"
                f"pts_ns={last_pts},"
                f"delta_ns={delta_pts},"
                f"dts_ns={int(snap.get('last_dts', -1))},"
                f"dur_ns={int(snap.get('last_duration', -1))}"
            )

        print(
            "[html-capture] pts "
            + " | ".join(timestamp_parts),
            file=sys.stderr,
            flush=True,
        )

        return True

    GLib.timeout_add_seconds(1, tick)

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
        "name=video_in_q",
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
        "name=video_post_comp_q",
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
        "name=html_video_parse",
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
        "name=html_audio_src",
        "do-timestamp=true",
        f"device={gst_quote(args.audio_source)}",
        "!",
        "queue",
        "name=audio_in_q",
        "max-size-buffers=0",
        "max-size-bytes=0",
        "max-size-time=2000000000",
        "!",
        "audioconvert",
        "!",
        "audioresample",
        "!",
        "audiorate",
        "name=html_audio_rate",
        "skip-to-first=true",
        "!",
        "audio/x-raw,rate=44100,channels=2",
        "!",
        "level",
        "name=html_audio_level",
        "interval=1000000000",
        "message=true",
        "!",
        "avenc_aac",
        "name=html_aac_enc",
        "bitrate=128000",
        "!",
        "aacparse",
        "name=html_audio_parse",
        "!",
        "queue",
        "name=audio_mux_q",
        "max-size-buffers=0",
        "max-size-bytes=0",
        "max-size-time=2000000000",
        "!",
        "mux.",
    ]

def output_branch(args: argparse.Namespace) -> list[str]:
    base = ["flvmux", "name=mux", "streamable=true", "!"]
    if args.output_file:
        return [
            *base,
            "queue",
            "name=file_out_q",
            "max-size-buffers=0",
            "max-size-bytes=0",
            "max-size-time=2000000000",
            "!",
            "filesink",
            f"location={gst_quote(args.output_file)}",
            "sync=true",
        ]
    if not args.rtmp_url:
        raise RuntimeError("rtmp-url vazio e output-file vazio.")
    if args.rtmp_sink == "ffmpeg":
        fd = int(getattr(args, "ffmpeg_fd", 1))
        return [
            *base,
            "queue",
            "name=rtmp_out_q",
            "max-size-buffers=0",
            "max-size-bytes=0",
            "max-size-time=2000000000",
            "!",
            "fdsink",
            f"fd={fd}",
            "sync=true",
        ]
    sink = "rtmp2sink" if args.rtmp_sink == "rtmp2sink" else "rtmpsink"
    return [
        *base,
        "queue",
        "name=rtmp_out_q",
        "max-size-buffers=0",
        "max-size-bytes=0",
        "max-size-time=2000000000",
        "!",
        sink,
        "name=html_rtmp_sink",
        f"location={gst_quote(args.rtmp_url)}",
        "sync=true",
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
    elif message.type == Gst.MessageType.QOS:
        try:
            live, running_time, stream_time, timestamp, duration = message.parse_qos()
            print(
                f"[html-capture] QOS live={live} running={running_time} stream={stream_time} ts={timestamp} duration={duration}",
                file=sys.stderr,
                flush=True,
            )
        except Exception as exc:
            print(f"[html-capture] QOS parse failed: {exc}", file=sys.stderr, flush=True)
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
