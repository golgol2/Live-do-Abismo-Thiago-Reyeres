#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import unicodedata
from pathlib import Path

import torch
from TTS.api import TTS

XTTS_MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"


def main() -> None:
    parser = argparse.ArgumentParser(description="Sintese XTTS local da live v2.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--language", default="pt")
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if not torch.cuda.is_available():
        raise RuntimeError("GPU CUDA indisponivel para XTTS.")
    tts = TTS(model_name=XTTS_MODEL_NAME).to("cuda")
    tts.tts_to_file(
        text=unicodedata.normalize("NFC", args.text),
        speaker_wav=[str(Path(args.voice))],
        language=args.language,
        file_path=str(output),
        split_sentences=True,
    )
    del tts
    gc.collect()
    torch.cuda.empty_cache()
    if hasattr(torch.cuda, "ipc_collect"):
        torch.cuda.ipc_collect()
    print(output)


if __name__ == "__main__":
    main()
