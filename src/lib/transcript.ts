/** YouTube taglavhalarini tozalash va dublyaj uchun "cue" larga birlashtirish. */

export interface RawSegment {
  text: string;
  offset: number;   // ms
  duration: number; // ms
}

export interface Cue {
  id: number;
  start: number; // ms
  end: number;   // ms
  original: string;
  text: string;  // tarjima (boshida original bilan bir xil)
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/** YouTube ba'zan ikki marta kodlaydi (`&amp;#39;`), shuning uchun ikki marta yechamiz. */
export function decodeEntities(s: string): string {
  let out = s;
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, m => ENTITIES[m] ?? m);
  }
  return out;
}

/** Musiqa/shovqin belgilarini olib tashlaydi. Bo'sh qolsa `''` qaytaradi. */
export function cleanLine(s: string): string {
  return decodeEntities(s)
    .replace(/\r?\n/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')   // [Music], [Applause]
    .replace(/\([^)]*\)/g, ' ')     // (laughs)
    .replace(/[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_CUE_MS = 5000;   // shundan qisqa cue lar keyingisiga qo'shiladi
const MAX_CUE_MS = 12000;  // shundan uzun cue majburan bo'linadi
const GAP_BREAK_MS = 900;  // jimlik shundan uzun bo'lsa yangi cue boshlanadi

/**
 * Avto-taglavhalar 2-4 so'zdan iborat bo'lakcha bo'lib keladi. Ularni to'g'ridan-to'g'ri
 * o'qitsak ohang buziladi va tarjima ham noto'g'ri chiqadi. Shuning uchun qo'shni
 * bo'laklarni ~5-12 soniyalik gap bo'laklariga birlashtiramiz.
 */
export function buildCues(raw: RawSegment[]): Cue[] {
  const segs = raw
    .map(s => ({ ...s, text: cleanLine(s.text) }))
    .filter(s => s.text.length > 0)
    .sort((a, b) => a.offset - b.offset);

  const cues: Cue[] = [];
  let buf: typeof segs = [];

  const flush = () => {
    if (!buf.length) return;
    const start = buf[0].offset;
    const last = buf[buf.length - 1];
    const end = Math.max(last.offset + last.duration, start + 700);
    const text = buf.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    if (text) cues.push({ id: cues.length, start, end, original: text, text });
    buf = [];
  };

  for (const seg of segs) {
    if (buf.length) {
      const start = buf[0].offset;
      const prev = buf[buf.length - 1];
      const prevEnd = prev.offset + prev.duration;
      const span = seg.offset + seg.duration - start;
      const gap = seg.offset - prevEnd;
      if (gap > GAP_BREAK_MS || span > MAX_CUE_MS) flush();
    }
    buf.push(seg);
    const span = seg.offset + seg.duration - buf[0].offset;
    if (span >= MIN_CUE_MS && /[.!?]$/.test(seg.text)) flush();
  }
  flush();

  // Juda qisqa qolgan cue larni keyingisiga yopishtiramiz
  const merged: Cue[] = [];
  for (const cue of cues) {
    const prev = merged[merged.length - 1];
    if (prev && cue.end - prev.start <= MAX_CUE_MS && prev.end - prev.start < 2000) {
      prev.end = cue.end;
      prev.original = `${prev.original} ${cue.original}`;
      prev.text = prev.original;
    } else {
      merged.push({ ...cue, id: merged.length });
    }
  }
  return merged.map((c, i) => ({ ...c, id: i }));
}
