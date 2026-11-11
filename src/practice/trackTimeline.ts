import { keyUsesFlats, Notation, pcName } from '../audio/music';
import { parseLrc } from '../song/lyrics';
import { StoredTrack } from '../stems/db';
import { chordLabel, editedKey } from '../stems/notes';
import { fretFor, Timeline, TLBass, TLChord, TLLine } from './timeline';

/**
 * Línea de tiempo de práctica a partir de una pista separada (🎚 Pistas):
 * el acompañamiento es la grabación original y las notas a tocar son las
 * que toca el bajo en ella. No hay que elegir estilo ni tempo: salen de la
 * canción. Los «pulsos» de esta línea de tiempo son segundos.
 */
export function buildTrackTimeline(track: StoredTrack, notation: Notation): Timeline {
  const an = track.analysis;
  const { speed, semitones } = track.edit;
  const flats = keyUsesFlats(editedKey(an, semitones));
  const T = (t: number) => t / speed;

  // ── Letra (si hay) y acordes agrupados por línea ──
  const lyric = (track.lrc ? parseLrc(track.lrc) : []).filter((l): l is typeof l & { t: number } => l.t !== null);
  const lines: TLLine[] = [];
  const chords: TLChord[] = [];
  let lineKey = '';
  let instr = 0;
  an.chords.forEach((c) => {
    // Línea que se canta cuando entra este acorde
    let li = -1;
    for (let i = 0; i < lyric.length && lyric[i].t <= c.t + 0.3; i++) li = i;
    // Mucho después del inicio de la línea ya es un tramo instrumental
    const sung = li >= 0 && c.t - lyric[li].t < Math.max(6, (lyric[li + 1]?.t ?? Infinity) - lyric[li].t);
    let key = sung ? `l${li}` : `i${instr}`;
    if (!sung && lineKey === key && lines[lines.length - 1].chords.length >= 4) key = `i${++instr}`;
    if (key !== lineKey) {
      if (lineKey.startsWith('i') && key.startsWith('l')) instr++;
      lineKey = key;
      lines.push({ lyric: sung ? lyric[li].text : '', chords: [] });
    }
    const line = lines[lines.length - 1];
    const name = chordLabel(c, semitones, notation, flats);
    let pos = 0;
    if (sung) {
      const end = Math.min(lyric[li + 1]?.t ?? an.duration, lyric[li].t + 8);
      const frac = Math.max(0, Math.min(0.95, (c.t - lyric[li].t) / Math.max(1, end - lyric[li].t)));
      pos = Math.max(Math.round(frac * line.lyric.length), (line.chords[line.chords.length - 1]?.pos ?? -1) + 1);
    }
    line.chords.push({ pos, name });
    const root = (((c.root + semitones) % 12) + 12) % 12;
    chords.push({
      startBeat: T(c.t),
      endBeat: T(c.end),
      chord: { root, suffix: c.minor ? 'm' : '', bass: null, minor: c.minor },
      name,
      tones: [root, (root + (c.minor ? 3 : 4)) % 12, (root + 7) % 12],
      lineIdx: lines.length - 1,
      posInLine: line.chords.length - 1,
    });
  });

  // ── Notas del bajo: se descartan las muy cortas o pegadas (ruido del detector) ──
  const bass: TLBass[] = [];
  let prevFret = 3;
  let lastT = -1;
  for (const n of an.bass) {
    if (n.d < 0.09 || n.t - lastT < 0.11) continue;
    lastT = n.t;
    let midi = n.midi + semitones;
    while (midi < 28) midi += 12;
    while (midi > 55) midi -= 12;
    const pos = fretFor(midi, prevFret);
    prevFret = pos.fret || prevFret;
    const t = T(n.t);
    const found = chords.findIndex((c) => t < c.endBeat);
    bass.push({ beat: t, len: n.d / speed, midi, name: pcName(midi, notation, flats), chordIdx: found < 0 ? Math.max(0, chords.length - 1) : found, ...pos });
  }

  const bpm = Math.max(40, Math.round(an.bpm * speed));
  return {
    bpm,
    shift: 0,
    beatSec: 1,
    beatsPerBar: 4,
    countInBeats: 4,
    totalBeats: an.duration / speed,
    chords,
    lines,
    bass,
    hits: [],
    audio: true,
    clickSec: 60 / bpm,
  };
}
