/** Cue larni yuklab olinadigan subtitr/matn formatlariga aylantirish. */

import type { Cue } from './transcript';

export type SubFormat = 'srt' | 'vtt' | 'txt';

function pad(n: number, len = 2) {
  return String(Math.floor(n)).padStart(len, '0');
}

function stamp(ms: number, sep: ',' | '.') {
  const h = ms / 3_600_000;
  const m = (ms % 3_600_000) / 60_000;
  const s = (ms % 60_000) / 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

function pick(cue: Cue, source: 'translated' | 'original') {
  return source === 'original' ? cue.original : cue.text;
}

export function toSrt(cues: Cue[], source: 'translated' | 'original' = 'translated'): string {
  return cues
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${pick(c, source)}\n`)
    .join('\n');
}

export function toVtt(cues: Cue[], source: 'translated' | 'original' = 'translated'): string {
  const body = cues
    .map(c => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${pick(c, source)}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** Vaqt belgisi bilan oddiy matn — o'qish yoki nusxalash uchun. */
export function toTxt(cues: Cue[], source: 'translated' | 'original' = 'translated'): string {
  return cues
    .map(c => {
      const total = Math.floor(c.start / 1000);
      return `[${pad(total / 60)}:${pad(total % 60)}] ${pick(c, source)}`;
    })
    .join('\n');
}

/** Ikki tilli matn — tarjimani original bilan solishtirish uchun. */
export function toBilingualTxt(cues: Cue[]): string {
  return cues
    .map(c => {
      const total = Math.floor(c.start / 1000);
      return `[${pad(total / 60)}:${pad(total % 60)}]\n  ${c.original}\n  ${c.text}`;
    })
    .join('\n\n');
}

export function build(cues: Cue[], format: SubFormat, source: 'translated' | 'original'): string {
  if (format === 'srt') return toSrt(cues, source);
  if (format === 'vtt') return toVtt(cues, source);
  return toTxt(cues, source);
}

export const MIME: Record<SubFormat, string> = {
  srt: 'application/x-subrip;charset=utf-8',
  vtt: 'text/vtt;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
};
