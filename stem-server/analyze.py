"""Análisis musical de las pistas ya separadas: tempo, tono, acordes,
notas del bajo y melodía de la voz. Todo con librosa (sin modelos extra).

Los resultados son una estimación automática: sirven de guía para sacar la
canción, no sustituyen a un cifrado revisado a mano.
"""
from __future__ import annotations

import numpy as np
import librosa

SR = 22050
HOP = 512

MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

LATIN = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"]
LATIN_B = ["Do", "Reb", "Re", "Mib", "Mi", "Fa", "Solb", "Sol", "Lab", "La", "Sib", "Si"]
AMER = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
AMER_B = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
# Tonalidades que se escriben con bemoles (mayor; la menor usa su relativa)
FLAT_MAJORS = {5, 10, 3, 8, 1}


def uses_flats(key: dict | None) -> bool:
    if not key:
        return False
    root = key["root"] if key["scale"] == "major" else (key["root"] + 3) % 12
    return root in FLAT_MAJORS


def pc_name(pc: int, notation: str = "latin", flats: bool = False) -> str:
    table = (LATIN_B if flats else LATIN) if notation == "latin" else (AMER_B if flats else AMER)
    return table[pc % 12]


def chord_name(c: dict, notation: str = "latin", flats: bool = False, shift: int = 0) -> str:
    return pc_name(c["root"] + shift, notation, flats) + ("m" if c["minor"] else "")


def _mono(x: np.ndarray, sr: int) -> np.ndarray:
    """(canales, muestras) → mono a 22 050 Hz."""
    y = x.mean(axis=0) if x.ndim > 1 else x
    return librosa.resample(y.astype(np.float32), orig_sr=sr, target_sr=SR)


def _beats(y_rhythm: np.ndarray, duration: float) -> tuple[float, np.ndarray]:
    tempo, frames = librosa.beat.beat_track(y=y_rhythm, sr=SR, hop_length=HOP)
    tempo = float(np.atleast_1d(tempo)[0])
    times = librosa.frames_to_time(frames, sr=SR, hop_length=HOP)
    if len(times) < 8 or tempo <= 0:
        tempo = 120.0
        times = np.arange(0.0, duration, 0.5)
    # Completar con pulsos antes del primero y después del último
    step = float(np.median(np.diff(times))) if len(times) > 1 else 0.5
    head = np.arange(times[0] - step, 0, -step)[::-1]
    tail = np.arange(times[-1] + step, duration, step)
    return tempo, np.concatenate([head, times, tail])


def _key(chroma_sum: np.ndarray) -> dict:
    best = (-2.0, 0, "major")
    for root in range(12):
        for scale, prof in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
            r = float(np.corrcoef(chroma_sum, np.roll(prof, root))[0, 1])
            if r > best[0]:
                best = (r, root, scale)
    return {"root": best[1], "scale": best[2]}


def _chords(y_harm: np.ndarray, y_bass: np.ndarray | None, beats: np.ndarray, duration: float) -> tuple[list[dict], np.ndarray]:
    """Un acorde (mayor/menor) por pulso, suavizado con Viterbi."""
    chroma = librosa.feature.chroma_cqt(y=y_harm, sr=SR, hop_length=HOP, n_chroma=12)
    bounds = librosa.time_to_frames(beats, sr=SR, hop_length=HOP)
    bounds = np.unique(np.clip(bounds, 0, chroma.shape[1] - 1))
    sync = librosa.util.sync(chroma, bounds, aggregate=np.median)  # (12, n+1)
    rms = librosa.util.sync(librosa.feature.rms(y=y_harm, hop_length=HOP), bounds, aggregate=np.mean)[0]
    bass_sync = None
    if y_bass is not None:
        bc = librosa.feature.chroma_cqt(y=y_bass, sr=SR, hop_length=HOP, n_chroma=12, fmin=librosa.note_to_hz("C1"), n_octaves=4)
        bass_sync = librosa.util.sync(bc, bounds, aggregate=np.median)

    n = sync.shape[1]
    # 24 plantillas: 12 mayores + 12 menores
    templates = np.zeros((24, 12))
    for r in range(12):
        templates[r, [r, (r + 4) % 12, (r + 7) % 12]] = [1.0, 0.8, 0.9]
        templates[12 + r, [r, (r + 3) % 12, (r + 7) % 12]] = [1.0, 0.8, 0.9]
    templates /= np.linalg.norm(templates, axis=1, keepdims=True)
    norm = sync / (np.linalg.norm(sync, axis=0, keepdims=True) + 1e-9)
    score = templates @ norm  # (24, n)
    if bass_sync is not None:
        # El bajo suele tocar la fundamental: empuja hacia esa raíz
        bn = bass_sync / (bass_sync.max(axis=0, keepdims=True) + 1e-9)
        score += 0.25 * np.concatenate([bn, bn], axis=0)

    # Viterbi: cambiar de acorde tiene un costo
    penalty = 0.18
    dp = np.zeros((24, n))
    back = np.zeros((24, n), dtype=int)
    dp[:, 0] = score[:, 0]
    for t in range(1, n):
        prev = dp[:, t - 1]
        best_prev = int(np.argmax(prev))
        stay = prev
        move = prev[best_prev] - penalty
        choose_move = move > stay
        back[:, t] = np.where(choose_move, best_prev, np.arange(24))
        dp[:, t] = score[:, t] + np.where(choose_move, move, stay)
    path = np.zeros(n, dtype=int)
    path[-1] = int(np.argmax(dp[:, -1]))
    for t in range(n - 1, 0, -1):
        path[t - 1] = back[path[t], t]

    quiet = rms < max(1e-4, 0.06 * float(np.percentile(rms, 95)))
    edges = np.concatenate([[0.0], librosa.frames_to_time(bounds, sr=SR, hop_length=HOP), [duration]])
    per_beat = []
    for i in range(n):
        per_beat.append(None if quiet[i] else int(path[i]))

    segs: list[dict] = []
    for i, c in enumerate(per_beat):
        t0, t1 = float(edges[i]), float(edges[i + 1])
        if t1 - t0 <= 0:
            continue
        if c is None:
            continue
        if segs and segs[-1]["_c"] == c and abs(segs[-1]["end"] - t0) < 1e-3:
            segs[-1]["end"] = t1
        else:
            segs.append({"t": t0, "end": t1, "root": c % 12, "minor": c >= 12, "_c": c})
    for s in segs:
        del s["_c"]
        s["t"] = round(s["t"], 3)
        s["end"] = round(s["end"], 3)
    return segs, chroma.sum(axis=1)


def _notes(y: np.ndarray, fmin: float, fmax: float, sr_work: int, min_dur: float, frame: int = 2048) -> list[dict]:
    """Línea melódica (una sola voz) → lista de notas {t, d, midi}."""
    if sr_work != SR:
        y = librosa.resample(y, orig_sr=SR, target_sr=sr_work)
    hop = 256
    f0, voiced, _ = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr_work, frame_length=frame, hop_length=hop)
    rms = librosa.feature.rms(y=y, frame_length=frame, hop_length=hop)[0]
    m = min(len(f0), len(rms))
    f0, voiced, rms = f0[:m], voiced[:m], rms[:m]
    gate = max(1e-4, 0.05 * float(np.percentile(rms, 98)))
    ok = voiced & ~np.isnan(f0) & (rms > gate)
    midi = np.full(m, -1, dtype=int)
    midi[ok] = np.round(librosa.hz_to_midi(f0[ok])).astype(int)
    # Quitar saltos de un solo cuadro
    for i in range(1, m - 1):
        if midi[i] != midi[i - 1] and midi[i - 1] == midi[i + 1]:
            midi[i] = midi[i - 1]
    onsets = set(librosa.onset.onset_detect(y=y, sr=sr_work, hop_length=hop, backtrack=False).tolist())
    dt = hop / sr_work
    notes: list[dict] = []
    start = None
    for i in range(m + 1):
        cur = midi[i] if i < m else -1
        if start is not None:
            same = cur == midi[start]
            # La misma nota vuelta a pulsar (nuevo ataque) es otra nota
            reattack = same and i in onsets and (i - start) * dt >= 0.12
            if not same or reattack:
                d = (i - start) * dt
                if d >= min_dur:
                    notes.append({"t": round(start * dt, 3), "d": round(d, 3), "midi": int(midi[start])})
                start = i if cur >= 0 else None
        elif cur >= 0:
            start = i
    return notes


def analyze(stems: dict[str, np.ndarray], sr: int, progress=lambda p, msg: None) -> dict:
    """stems: nombre → (canales, muestras). Devuelve el análisis completo."""
    mono = {k: _mono(v, sr) for k, v in stems.items()}
    duration = float(len(next(iter(mono.values()))) / SR)

    progress(0.05, "Detectando el tempo…")
    rhythm = mono.get("drums")
    full = np.sum(list(mono.values()), axis=0)
    if rhythm is None or float(np.abs(rhythm).max()) < 0.02:
        rhythm = full
    tempo, beats = _beats(rhythm, duration)

    progress(0.25, "Detectando acordes…")
    harm_parts = [mono[k] for k in ("other", "guitar", "piano") if k in mono]
    harm = np.sum(harm_parts, axis=0) if harm_parts else full
    bass = mono.get("bass")
    if bass is not None:
        harm = harm + 0.5 * bass
    chords, chroma_sum = _chords(harm, bass, beats, duration)
    key = _key(chroma_sum)

    # Compás de 4: se elige la fase donde caen más cambios de acorde
    changes = np.array([c["t"] for c in chords])
    phase = 0
    if len(changes) and len(beats) > 8:
        idx = np.searchsorted(beats, changes - 0.05)
        phase = int(np.argmax(np.bincount(idx % 4, minlength=4)))

    bass_notes: list[dict] = []
    if bass is not None and float(np.abs(bass).max()) > 0.01:
        progress(0.5, "Transcribiendo el bajo…")
        bass_notes = _notes(bass, fmin=30.0, fmax=400.0, sr_work=11025, min_dur=0.07)

    melody: list[dict] = []
    voc = mono.get("vocals")
    if voc is not None and float(np.abs(voc).max()) > 0.01:
        progress(0.75, "Transcribiendo la melodía…")
        melody = _notes(voc, fmin=80.0, fmax=1000.0, sr_work=11025, min_dur=0.1, frame=1024)

    progress(1.0, "Análisis listo")
    return {
        "duration": round(duration, 3),
        "bpm": round(tempo, 1),
        "key": key,
        "beats": [round(float(b), 3) for b in beats if 0 <= b <= duration],
        "phase": phase,
        "chords": chords,
        "bass": bass_notes,
        "melody": melody,
    }


# ── Texto y MIDI ────────────────────────────────────────────────────────────

def _fmt_t(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def _bars(an: dict, speed: float) -> list[tuple[float, float]]:
    beats = [b / speed for b in an["beats"]]
    if len(beats) < 4:
        return []
    start = an.get("phase", 0) % 4
    bars = []
    if start > 0:
        bars.append((0.0, beats[start]))
    for i in range(start, len(beats), 4):
        end = beats[i + 4] if i + 4 < len(beats) else an["duration"] / speed
        bars.append((beats[i], end))
    return bars


def notes_text(meta: dict, notation: str = "latin", semitones: int = 0, speed: float = 1.0) -> str:
    an = meta["analysis"]
    key = dict(an["key"], root=(an["key"]["root"] + semitones) % 12)
    flats = uses_flats(key)
    name = lambda pc: pc_name(pc + semitones, notation, flats)
    scale = ("mayor" if key["scale"] == "major" else "menor") if notation == "latin" else key["scale"]
    out = [
        f"{meta['title']}" + (f" — {meta['artist']}" if meta.get("artist") else ""),
        f"Tono: {pc_name(key['root'], notation, flats)} {scale} · {round(an['bpm'] * speed)} BPM · {_fmt_t(an['duration'] / speed)}",
    ]
    if semitones or speed != 1:
        out.append(f"(Editada: {semitones:+d} semitonos, velocidad {round(speed * 100)}%)")
    if meta.get("url"):
        out.append(f"Fuente: {meta['url']}")
    out += ["", "Detección automática: úsala como guía y corrige de oído lo que haga falta.", ""]

    bars = _bars(an, speed)

    def by_bar(title: str, cell) -> None:
        out.append(title)
        out.append("-" * len(title))
        for i in range(0, len(bars), 4):
            row = [cell(a, b) or "·" for a, b in bars[i : i + 4]]
            if all(c == "·" for c in row):
                continue
            out.append(f"{_fmt_t(bars[i][0]):>5} | " + " | ".join(row) + " |")
        out.append("")

    def chord_cell(a: float, b: float) -> str:
        names: list[str] = []
        for c in an["chords"]:
            t0, t1 = c["t"] / speed, c["end"] / speed
            if min(b, t1) - max(a, t0) > 0.2 * (b - a):
                n = chord_name(c, notation, flats, semitones)
                if not names or names[-1] != n:
                    names.append(n)
        return " ".join(names)

    def note_cell(notes: list[dict]):
        def cell(a: float, b: float) -> str:
            return " ".join(name(n["midi"]) for n in notes if a <= n["t"] / speed < b)
        return cell

    by_bar("ACORDES (un compás por casilla)", chord_cell)
    if an["bass"]:
        by_bar("BAJO (notas por compás)", note_cell(an["bass"]))
    if an["melody"]:
        by_bar("MELODÍA DE LA VOZ (notas por compás)", note_cell(an["melody"]))
    return "\n".join(out)


def chord_sheet(meta: dict, notation: str = "latin", semitones: int = 0) -> str:
    """Cifrado solo de acordes, 4 compases por línea (formato que entiende la app)."""
    an = meta["analysis"]
    key = dict(an["key"], root=(an["key"]["root"] + semitones) % 12)
    flats = uses_flats(key)
    bars = _bars(an, 1.0)
    lines: list[str] = []
    row: list[str] = []
    for a, b in bars:
        names: list[str] = []
        for c in an["chords"]:
            if min(b, c["end"]) - max(a, c["t"]) > 0.2 * (b - a):
                n = chord_name(c, notation, flats, semitones)
                if not names or names[-1] != n:
                    names.append(n)
        if names:
            row.append(" ".join(names))
        if len(row) == 4:
            lines.append("   ".join(row))
            row = []
    if row:
        lines.append("   ".join(row))
    return "\n".join(lines)


def _vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def midi_file(meta: dict, semitones: int = 0, speed: float = 1.0) -> bytes:
    """MIDI tipo 1: pista de bajo (canal 1) y melodía (canal 2), con acordes como marcadores."""
    an = meta["analysis"]
    ppq = 480
    bpm = max(30.0, an["bpm"] * speed)
    tick = lambda t: int(round(t / speed * bpm / 60 * ppq))

    def track(events: list[tuple[int, bytes]]) -> bytes:
        events.sort(key=lambda e: e[0])
        data = b""
        last = 0
        for t, ev in events:
            data += _vlq(max(0, t - last)) + ev
            last = max(last, t)
        data += b"\x00\xff\x2f\x00"
        return b"MTrk" + len(data).to_bytes(4, "big") + data

    def meta_ev(kind: int, payload: bytes) -> bytes:
        return bytes([0xFF, kind]) + _vlq(len(payload)) + payload

    flats = uses_flats(an["key"])
    tempo_events = [(0, meta_ev(0x51, int(60_000_000 / bpm).to_bytes(3, "big")))]
    for c in an["chords"]:
        tempo_events.append((tick(c["t"]), meta_ev(0x06, chord_name(c, "american", flats, semitones).encode())))
    tracks = [track(tempo_events)]
    for ch, prog, name, notes in ((0, 33, "Bajo", an["bass"]), (1, 73, "Melodia", an["melody"])):
        if not notes:
            continue
        ev = [(0, meta_ev(0x03, name.encode())), (0, bytes([0xC0 | ch, prog]))]
        for n in notes:
            m = max(0, min(127, n["midi"] + semitones))
            a, b = tick(n["t"]), tick(n["t"] + n["d"])
            ev.append((a, bytes([0x90 | ch, m, 96])))
            ev.append((max(a + 1, b - 1), bytes([0x80 | ch, m, 0])))
        tracks.append(track(ev))
    head = b"MThd" + (6).to_bytes(4, "big") + (1).to_bytes(2, "big") + len(tracks).to_bytes(2, "big") + ppq.to_bytes(2, "big")
    return head + b"".join(tracks)
