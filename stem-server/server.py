"""Motor de pistas de Live Stage Assistant.

Servidor local (solo 127.0.0.1) al que se conecta la página web:
  enlace de YouTube → yt-dlp → ffmpeg → Demucs (voz, batería, bajo, …)
  → análisis (acordes, notas del bajo, melodía) → MP3 por pista.

Uso personal: descarga solo música que tengas derecho a usar.
"""
from __future__ import annotations

import io
import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time
import traceback
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
os.environ.setdefault("TORCH_HOME", str(ROOT / "models"))

import imageio_ffmpeg
import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

import analyze as an

VERSION = "1.0.0"
PORT = int(os.environ.get("LSA_STEMS_PORT", "8765"))
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
MAX_SECONDS = 15 * 60
SR = 44100

# Solo estas páginas pueden hablar con el motor (evita que cualquier sitio
# web que visites lance descargas en tu PC).
ALLOWED_ORIGINS = {
    "https://autotune-nu.vercel.app",
    *[o.strip() for o in os.environ.get("LSA_STEMS_ORIGINS", "").split(",") if o.strip()],
}
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
MODELS = {"4": "htdemucs", "6": "htdemucs_6s"}
STEM_LABELS = {"vocals": "voz", "drums": "bateria", "bass": "bajo", "other": "otros", "guitar": "guitarra", "piano": "piano"}

app = FastAPI(title="LSA · Motor de pistas")


def origin_ok(origin: str | None) -> bool:
    return bool(origin) and (origin in ALLOWED_ORIGINS or bool(LOCAL_ORIGIN.match(origin)))


@app.middleware("http")
async def cors(request: Request, call_next):
    origin = request.headers.get("origin")
    headers = {}
    if origin_ok(origin):
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
            "Access-Control-Allow-Private-Network": "true",
            "Access-Control-Expose-Headers": "Content-Disposition",
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        }
    elif origin:
        return JSONResponse({"detail": "Origen no permitido"}, status_code=403)
    if request.method == "OPTIONS":
        return Response(status_code=204, headers=headers)
    response = await call_next(request)
    response.headers.update(headers)
    return response


# ── Utilidades ──────────────────────────────────────────────────────────────

def run_ffmpeg(args: list[str]) -> None:
    p = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True)
    if p.returncode != 0:
        raise RuntimeError("ffmpeg: " + p.stderr.decode("utf-8", "replace")[-400:])


def track_dir(tid: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", tid):
        raise HTTPException(400, "Identificador inválido")
    return DATA / tid


def load_meta(tid: str) -> dict:
    f = track_dir(tid) / "meta.json"
    if not f.exists():
        raise HTTPException(404, "Pista no encontrada")
    return json.loads(f.read_text("utf-8"))


def public_meta(meta: dict) -> dict:
    return meta


def slug(s: str) -> str:
    s = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", s).strip()
    return re.sub(r"\s+", " ", s)[:80] or "pista"


# ── Demucs ──────────────────────────────────────────────────────────────────

_models: dict[str, object] = {}
_device: str | None = None


def device() -> str:
    global _device
    if _device is None:
        import torch

        _device = "cuda" if torch.cuda.is_available() else "cpu"
    return _device


def gpu_name() -> str | None:
    import torch

    return torch.cuda.get_device_name(0) if torch.cuda.is_available() else None


def separate(wav: np.ndarray, model_name: str, on_progress) -> dict[str, np.ndarray]:
    """wav: (2, n) float32 a 44.1 kHz → {pista: (2, n)}."""
    import torch
    import demucs.apply as dapply
    from demucs.pretrained import get_model

    if model_name not in _models:
        on_progress(0.0, "Cargando el modelo (la primera vez se descarga)…")
        _models[model_name] = get_model(model_name)
    model = _models[model_name]
    model.eval()

    # Avance real: Demucs procesa por segmentos con tqdm
    class Bar:
        def __init__(self, it, **kw):
            self.it = list(it)

        def __iter__(self):
            total = max(1, len(self.it))
            for i, x in enumerate(self.it):
                yield x
                on_progress((i + 1) / total, "Separando instrumentos…")

    original = dapply.tqdm.tqdm
    dapply.tqdm.tqdm = Bar
    try:
        x = torch.from_numpy(wav)
        ref = x.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        x = (x - mean) / std

        def go(dev: str):
            with torch.no_grad():
                return dapply.apply_model(model, x[None], device=dev, shifts=1, split=True, overlap=0.25, progress=True)[0]

        try:
            out = go(device())
        except RuntimeError as e:  # sin memoria en la GPU → CPU
            if device() == "cuda" and "out of memory" in str(e).lower():
                torch.cuda.empty_cache()
                on_progress(0.0, "La GPU se quedó sin memoria; sigo con el procesador (más lento)…")
                out = go("cpu")
            else:
                raise
        out = (out * std + mean).cpu().numpy()
    finally:
        dapply.tqdm.tqdm = original
        if device() == "cuda":
            torch.cuda.empty_cache()
    return {name: out[i] for i, name in enumerate(model.sources)}


# ── Trabajos ────────────────────────────────────────────────────────────────

jobs: dict[str, dict] = {}
work: "queue.Queue[str]" = queue.Queue()
lock = threading.Lock()


def set_job(jid: str, **kw) -> None:
    with lock:
        jobs[jid].update(kw)


def youtube_id(url: str) -> str | None:
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or (u.hostname or "").lower() not in YOUTUBE_HOSTS:
        return None
    m = re.search(r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else None


def download(url: str, folder: Path, jid: str) -> dict:
    import yt_dlp

    def hook(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                set_job(jid, progress=0.02 + 0.08 * d.get("downloaded_bytes", 0) / total)

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(folder / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ffmpeg_location": FFMPEG,
        "progress_hooks": [hook],
        "match_filter": lambda info, *, incomplete=False: (
            "Es una transmisión en vivo" if info.get("is_live") else
            f"Dura más de {MAX_SECONDS // 60} minutos" if (info.get("duration") or 0) > MAX_SECONDS else None
        ),
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    if not info or not list(folder.glob("source.*")):
        raise RuntimeError("No se pudo descargar el audio (¿video privado, en vivo o demasiado largo?).")
    return {
        "title": info.get("track") or info.get("title") or "Sin título",
        "artist": info.get("artist") or info.get("uploader") or "",
        "thumbnail": info.get("thumbnail"),
    }


def publish(tmp: Path, folder: Path) -> None:
    """Mueve la carpeta terminada a su sitio. En Windows otro programa (antivirus,
    indexador, un servidor de desarrollo) puede tenerla tomada un instante."""
    for _ in range(6):
        try:
            tmp.rename(folder)
            return
        except OSError:
            time.sleep(0.5)
    shutil.copytree(tmp, folder, dirs_exist_ok=True)
    shutil.rmtree(tmp, ignore_errors=True)


def process(jid: str) -> None:
    job = jobs[jid]
    tid = job["trackId"]
    folder = DATA / tid
    tmp = DATA / f".tmp-{tid}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        info = {"title": job.get("title") or "Sin título", "artist": "", "thumbnail": None}
        if job.get("url"):
            set_job(jid, stage="download", progress=0.02, message="Descargando el audio de YouTube…")
            info = download(job["url"], tmp, jid)
        else:
            shutil.move(job["file"], tmp / ("source" + Path(job["file"]).suffix))
        src = next(tmp.glob("source.*"))

        set_job(jid, stage="convert", progress=0.1, message="Convirtiendo el audio…")
        wav_path = tmp / "mix.wav"
        run_ffmpeg(["-i", str(src), "-vn", "-ac", "2", "-ar", str(SR), "-t", str(MAX_SECONDS), "-c:a", "pcm_s16le", str(wav_path)])
        src.unlink(missing_ok=True)
        data, _ = sf.read(str(wav_path), dtype="float32", always_2d=True)
        wav = np.ascontiguousarray(data.T)
        if wav.shape[1] < SR * 3:
            raise RuntimeError("El audio es demasiado corto.")

        def sep_progress(p: float, msg: str) -> None:
            set_job(jid, stage="separate", progress=0.12 + 0.58 * p, message=msg)

        sep_progress(0.0, "Separando instrumentos…")
        stems = separate(wav, MODELS[job["model"]], sep_progress)
        # En el modelo de 6 pistas, un instrumento que no suena queda casi mudo: se descarta
        peak = max(float(np.abs(v).max()) for v in stems.values())
        stems = {k: v for k, v in stems.items() if k in ("vocals", "drums", "bass", "other") or float(np.abs(v).max()) > 0.03 * peak}

        def an_progress(p: float, msg: str) -> None:
            set_job(jid, stage="analyze", progress=0.7 + 0.2 * p, message=msg)

        analysis = an.analyze(stems, SR, an_progress)

        set_job(jid, stage="encode", progress=0.9, message="Guardando las pistas…")
        (tmp / "stems").mkdir()
        for name, audio in stems.items():
            w = tmp / f"{name}.wav"
            sf.write(str(w), np.clip(audio.T, -1, 1), SR, subtype="PCM_16")
            run_ffmpeg(["-i", str(w), "-c:a", "libmp3lame", "-b:a", "192k", str(tmp / "stems" / f"{name}.mp3")])
            w.unlink()
        run_ffmpeg(["-i", str(wav_path), "-c:a", "libmp3lame", "-b:a", "192k", str(tmp / "original.mp3")])
        wav_path.unlink()

        meta = {
            "id": tid,
            "title": info["title"],
            "artist": info["artist"],
            "url": job.get("url"),
            "thumbnail": info["thumbnail"],
            "model": job["model"],
            "stems": list(stems.keys()),
            "created": int(time.time() * 1000),
            "analysis": analysis,
        }
        (tmp / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), "utf-8")
        shutil.rmtree(folder, ignore_errors=True)
        publish(tmp, folder)
        set_job(jid, status="done", stage="done", progress=1.0, message="¡Listo!", track=meta)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        msg = str(e)
        msg = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?", "", msg)
        set_job(jid, status="error", message=msg[:400] or "Error desconocido")
        shutil.rmtree(tmp, ignore_errors=True)
    finally:
        f = job.get("file")
        if f and os.path.exists(f):
            os.unlink(f)


def worker() -> None:
    while True:
        jid = work.get()
        set_job(jid, status="running")
        process(jid)


threading.Thread(target=worker, daemon=True).start()


def new_job(track_id: str, model: str, **extra) -> dict:
    if model not in MODELS:
        raise HTTPException(400, "Modelo inválido")
    for j in jobs.values():
        if j["trackId"] == track_id and j["status"] in ("queued", "running"):
            return j
    jid = f"{track_id}-{int(time.time() * 1000)}"
    jobs[jid] = {"id": jid, "trackId": track_id, "model": model, "status": "queued", "stage": "queued", "progress": 0.0, "message": "En cola…", **extra}
    work.put(jid)
    return jobs[jid]


def job_view(j: dict) -> dict:
    return {k: v for k, v in j.items() if k not in ("file",)}


# ── API ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "app": "lsa-stems", "version": VERSION, "device": device(), "gpu": gpu_name()}


@app.post("/jobs")
async def create_job(request: Request):
    body = await request.json()
    url = str(body.get("url", "")).strip()
    model = str(body.get("model", "4"))
    vid = youtube_id(url)
    if not vid:
        raise HTTPException(400, "Pega un enlace de YouTube válido (youtube.com o youtu.be).")
    tid = f"{vid}-{model}"
    if not body.get("force") and (DATA / tid / "meta.json").exists():
        return {"id": None, "status": "done", "track": load_meta(tid)}
    return job_view(new_job(tid, model, url=f"https://www.youtube.com/watch?v={vid}"))


@app.post("/jobs/file")
async def create_job_file(request: Request, model: str = "4"):
    """Archivo de audio propio (cuerpo crudo; nombre en X-File-Name)."""
    name = slug(unquote(request.headers.get("x-file-name", "audio")))
    ext = Path(name).suffix.lower()
    if ext not in (".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm", ".opus", ".aac"):
        raise HTTPException(400, "Formato de audio no reconocido.")
    tid = f"f{int(time.time() * 1000):x}-{model}"
    path = DATA / f".upload-{tid}{ext}"
    size = 0
    with open(path, "wb") as f:
        async for chunk in request.stream():
            size += len(chunk)
            if size > 300 * 1024 * 1024:
                f.close()
                path.unlink(missing_ok=True)
                raise HTTPException(413, "Archivo demasiado grande.")
            f.write(chunk)
    return job_view(new_job(tid, model, file=str(path), title=Path(name).stem))


@app.get("/jobs/{jid}")
def get_job(jid: str):
    if jid not in jobs:
        raise HTTPException(404, "Trabajo no encontrado")
    return job_view(jobs[jid])


@app.get("/tracks")
def list_tracks():
    out = []
    for f in DATA.glob("*/meta.json"):
        if f.parent.name.startswith("."):
            continue
        m = json.loads(f.read_text("utf-8"))
        out.append({k: m[k] for k in ("id", "title", "artist", "url", "thumbnail", "model", "stems", "created")} | {"duration": m["analysis"]["duration"], "bpm": m["analysis"]["bpm"], "key": m["analysis"]["key"]})
    return sorted(out, key=lambda m: -m["created"])


@app.get("/tracks/{tid}")
def get_track(tid: str):
    return load_meta(tid)


@app.delete("/tracks/{tid}")
def delete_track(tid: str):
    shutil.rmtree(track_dir(tid), ignore_errors=True)
    return {"ok": True}


def clamp_edit(semitones: int, speed: float) -> tuple[int, float]:
    return max(-12, min(12, int(semitones))), max(0.5, min(1.5, round(float(speed), 2)))


def stem_file(tid: str, name: str, semitones: int, speed: float) -> Path:
    """MP3 de una pista; con tono/velocidad distintos se genera (y se guarda) la variante."""
    folder = track_dir(tid)
    src = folder / "original.mp3" if name == "original" else folder / "stems" / f"{name}.mp3"
    if not re.fullmatch(r"[a-z]+", name) or not src.exists():
        raise HTTPException(404, "Pista no encontrada")
    if semitones == 0 and speed == 1.0:
        return src
    vdir = folder / "variants" / f"{semitones}_{speed}"
    out = vdir / f"{name}.mp3"
    if not out.exists():
        vdir.mkdir(parents=True, exist_ok=True)
        # La batería no tiene tono: solo cambia de velocidad
        ratio = 1.0 if name == "drums" else 2 ** (semitones / 12)
        filters = []
        if ratio != 1.0:
            filters += [f"asetrate={SR * ratio:.4f}", f"aresample={SR}"]
        tempo = speed / ratio
        if abs(tempo - 1.0) > 1e-4:
            filters.append(f"atempo={tempo:.6f}")
        tmp = vdir / f".{name}.{threading.get_ident()}.mp3"
        run_ffmpeg(["-i", str(src), *(["-af", ",".join(filters)] if filters else []), "-c:a", "libmp3lame", "-b:a", "192k", str(tmp)])
        os.replace(tmp, out)
    return out


@app.get("/tracks/{tid}/stem/{name}.mp3")
def get_stem(tid: str, name: str, semitones: int = 0, speed: float = 1.0):
    semitones, speed = clamp_edit(semitones, speed)
    return FileResponse(stem_file(tid, name, semitones, speed), media_type="audio/mpeg")


@app.post("/tracks/{tid}/download")
async def download_zip(tid: str, request: Request):
    """ZIP con la mezcla (con tus volúmenes), cada pista, las notas en texto, el cifrado y un MIDI."""
    meta = load_meta(tid)
    body = await request.json()
    # Título y artista como los dejó el usuario en la app
    for k in ("title", "artist"):
        if isinstance(body.get(k), str) and body[k].strip():
            meta[k] = body[k].strip()[:200]
    semitones, speed = clamp_edit(body.get("semitones", 0), body.get("speed", 1.0))
    notation = "american" if body.get("notation") == "american" else "latin"
    vols = {k: max(0.0, min(2.0, float(v))) for k, v in (body.get("volumes") or {}).items() if k in meta["stems"]}
    start = max(0.0, float(body.get("start") or 0))
    end = float(body.get("end") or 0)
    files = {s: stem_file(tid, s, semitones, speed) for s in meta["stems"]}

    audible = [s for s in meta["stems"] if vols.get(s, 1.0) > 0.001]
    mix = track_dir(tid) / f".mix-{threading.get_ident()}.mp3"
    buf = io.BytesIO()
    try:
        if audible:
            args: list[str] = []
            for s in audible:
                args += ["-i", str(files[s])]
            chain = "".join(f"[{i}:a]volume={vols.get(s, 1.0):.3f}[a{i}];" for i, s in enumerate(audible))
            chain += "".join(f"[a{i}]" for i in range(len(audible))) + f"amix=inputs={len(audible)}:normalize=0,alimiter=limit=0.97[out]"
            cut = (["-ss", f"{start:.3f}"] if start > 0 else []) + (["-to", f"{end:.3f}"] if end > start else [])
            run_ffmpeg([*args, "-filter_complex", chain, "-map", "[out]", *cut, "-c:a", "libmp3lame", "-b:a", "192k", str(mix)])
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            if mix.exists():
                z.write(mix, "mezcla.mp3")
            for s, f in files.items():
                z.write(f, f"pistas/{STEM_LABELS.get(s, s)}.mp3")
            z.writestr("notas.txt", an.notes_text(meta, notation, semitones, speed))
            sheet = str(body.get("sheet") or "").strip() or an.chord_sheet(meta, notation, semitones)
            z.writestr("cifrado.txt", f"{meta['title']}\n{meta.get('artist', '')}\n\n{sheet}\n")
            z.writestr("notas.mid", an.midi_file(meta, semitones, speed))
    finally:
        mix.unlink(missing_ok=True)
    name = slug(meta["title"]).encode("ascii", "ignore").decode() or "pista"
    return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}.zip"'})


if __name__ == "__main__":
    import uvicorn

    print(f"\n  Motor de pistas listo en http://127.0.0.1:{PORT}  ({device()})")
    print("  Deja esta ventana abierta mientras usas «Pistas» en la app.\n")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
