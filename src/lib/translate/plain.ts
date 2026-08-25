/**
 * Kalitsiz, bepul tarjima provayderlari.
 *
 * Bular kontekstni tushunmaydi, shuning uchun har bir cue alohida yuboriladi.
 * Cue lar allaqachon to'liq gap bo'lakchalari (`transcript.ts` birlashtiradi),
 * shuning uchun bu yo'l ham qabul qilarli natija beradi.
 */

import type { Cue } from '../transcript';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';

const CONCURRENCY = 8;
const TIMEOUT_MS = 15_000;

export interface PlainResult {
  text: string;
  /** Provayder aniqlagan manba tili (bilsa) */
  detected?: string;
}

async function get(url: string): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Google Tarjima. `translate.googleapis.com` ko'p IP lardan bot sifatida
 * bloklanadi, `clients5.google.com` (Chrome lug'at kengaytmasi endpointi) esa
 * barqaror ishlaydi.
 */
async function google(text: string, target: string, source: string): Promise<PlainResult> {
  const url =
    'https://clients5.google.com/translate_a/single?client=dict-chrome-ex' +
    `&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&dt=t` +
    `&q=${encodeURIComponent(text)}`;
  const res = await get(url);
  if (!res.ok) throw new Error(`Google Tarjima ${res.status}`);
  const data = await res.json();
  // Shakl: [[[tarjima, original, …], …], null, "aniqlangan-til", …]
  const chunks = Array.isArray(data?.[0]) ? data[0] : [];
  const out = chunks.map((c: unknown[]) => String(c?.[0] ?? '')).join('');
  if (!out.trim()) throw new Error('Google Tarjima bo\'sh javob qaytardi');
  return { text: out.trim(), detected: typeof data?.[2] === 'string' ? data[2] : undefined };
}

/** Google ga ochiq proksi — asosiy endpoint ishlamaganda zaxira. */
async function simplytranslate(text: string, target: string, source: string): Promise<PlainResult> {
  const url =
    'https://simplytranslate.org/api/translate/?engine=google' +
    `&from=${encodeURIComponent(source)}&to=${encodeURIComponent(target)}` +
    `&text=${encodeURIComponent(text)}`;
  const res = await get(url);
  if (!res.ok) throw new Error(`SimplyTranslate ${res.status}`);
  const data = await res.json();
  const out = String(data?.translated_text ?? '').trim();
  if (!out) throw new Error('SimplyTranslate bo\'sh javob qaytardi');
  return { text: out, detected: data?.source_language };
}

async function mymemory(text: string, target: string, source: string): Promise<PlainResult> {
  const from = source === 'auto' ? 'en' : source; // MyMemory `auto` ni qabul qilmaydi
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}` +
    `&langpair=${encodeURIComponent(from)}|${encodeURIComponent(target)}`;
  const res = await get(url);
  const data = await res.json().catch(() => null);
  const out = String(data?.responseData?.translatedText ?? '');
  // MyMemory limit tugaganda 200 bilan ogohlantirish matnini qaytaradi
  if (!res.ok || data?.responseStatus !== 200 || /MYMEMORY WARNING/i.test(out)) {
    throw new Error(out.slice(0, 120) || `MyMemory ${res.status}`);
  }
  return { text: out.trim() };
}

const ENGINES: Record<string, (t: string, target: string, source: string) => Promise<PlainResult>> = {
  google,
  simplytranslate,
  mymemory,
};

export function isPlainProvider(id: string): boolean {
  return id in ENGINES;
}

/**
 * Cue larni joyida tarjima qiladi. Bitta cue tushib qolsa originali qoladi;
 * hech biri tarjima bo'lmasa xato ko'tariladi (UI da ko'rsatish uchun).
 */
export async function translatePlain(
  cues: Cue[],
  providerId: string,
  targetCode: string,
  sourceCode: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ detected?: string }> {
  const engine = ENGINES[providerId];
  if (!engine) throw new Error(`Noma'lum provayder: ${providerId}`);

  let cursor = 0;
  let done = 0;
  let ok = 0;
  let detected: string | undefined;
  let firstError: string | undefined;

  const workers = Array.from({ length: Math.min(CONCURRENCY, cues.length) }, async () => {
    while (cursor < cues.length) {
      const cue = cues[cursor++];
      try {
        const res = await engine(cue.original, targetCode, sourceCode);
        if (res.text) {
          cue.text = res.text;
          ok++;
        }
        if (!detected && res.detected) detected = res.detected;
      } catch (e) {
        if (!firstError) firstError = (e as Error).message;
      }
      onProgress?.(++done, cues.length);
    }
  });
  await Promise.all(workers);

  if (ok === 0) {
    throw new Error(firstError ?? 'Tarjima provayderi javob bermadi');
  }
  return { detected };
}
