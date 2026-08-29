/**
 * Kalitsiz, bepul tarjima provayderlari.
 *
 * Bular kontekstni tushunmaydi, lekin so'rovlarni ommaviy (batch) tarzda yuborish
 * orqali bir necha soniya ichida minglab gaplarni tezkor va xavfsiz tarjima qiladi.
 *
 * Ishlab chiquvchi: InnoHub & Usmoxan Design
 */

import type { Cue } from '../transcript';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';

const BATCH_SIZE = 25; // Har bir so'rovda 25 ta gap
const CONCURRENCY = 6;
const TIMEOUT_MS = 15_000;

export interface PlainResult {
  text: string;
  /** Provayder aniqlagan manba tili (bilsa) */
  detected?: string;
}

export interface BatchResult {
  texts: string[];
  detected?: string;
}

async function get(url: string): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Google Tarjima (bitta matn).
 */
async function google(text: string, target: string, source: string): Promise<PlainResult> {
  const url =
    'https://clients5.google.com/translate_a/single?client=dict-chrome-ex' +
    `&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&dt=t` +
    `&q=${encodeURIComponent(text)}`;
  const res = await get(url);
  if (!res.ok) throw new Error(`Google Tarjima ${res.status}`);
  const data = await res.json();
  const chunks = Array.isArray(data?.[0]) ? data[0] : [];
  const out = chunks.map((c: unknown[]) => String(c?.[0] ?? '')).join('');
  if (!out.trim()) throw new Error("Google Tarjima bo'sh javob qaytardi");
  return { text: out.trim(), detected: typeof data?.[2] === 'string' ? data[2] : undefined };
}

/**
 * Google Tarjima (ommaviy/batch rejim — 10x tezroq).
 */
async function googleBatch(texts: string[], target: string, source: string): Promise<BatchResult> {
  const joined = texts.join('\n');
  const url =
    'https://clients5.google.com/translate_a/single?client=dict-chrome-ex' +
    `&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&dt=t` +
    `&q=${encodeURIComponent(joined)}`;
  const res = await get(url);
  if (!res.ok) throw new Error(`Google Tarjima ${res.status}`);
  const data = await res.json();
  const chunks = Array.isArray(data?.[0]) ? data[0] : [];
  const out = chunks.map((c: unknown[]) => String(c?.[0] ?? '')).join('');
  const lines = out.split('\n');

  if (lines.length === texts.length) {
    return {
      texts: lines.map(l => l.trim()),
      detected: typeof data?.[2] === 'string' ? data[2] : undefined,
    };
  }

  // Agar qatorlar soni mos kelmasa, xato ko'tarib yagona so'rovlarga qaytamiz
  throw new Error('Batch split mismatch');
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
  if (!out) throw new Error("SimplyTranslate bo'sh javob qaytardi");
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
 * Cue larni tezkor va ommaviy tarzda tarjima qiladi.
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

  let detected: string | undefined;
  let firstError: string | undefined;
  let done = 0;
  let ok = 0;

  // 1. Agar Google provayderi bo'lsa, ommaviy (batch) tarzda tezkor tarjima qilamiz
  if (providerId === 'google') {
    const batches: Cue[][] = [];
    for (let i = 0; i < cues.length; i += BATCH_SIZE) {
      batches.push(cues.slice(i, i + BATCH_SIZE));
    }

    let batchIdx = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (batchIdx < batches.length) {
        const batch = batches[batchIdx++];
        try {
          const res = await googleBatch(
            batch.map(c => c.original),
            targetCode,
            sourceCode
          );
          for (let i = 0; i < batch.length; i++) {
            if (res.texts[i]) {
              batch[i].text = res.texts[i];
              ok++;
            }
          }
          if (!detected && res.detected) detected = res.detected;
          done += batch.length;
          onProgress?.(Math.min(done, cues.length), cues.length);
        } catch {
          // Agar ommaviy rejimda xato bo'lsa, shu bo'lakdagi har bir cueni alohida tarjima qilamiz
          for (const cue of batch) {
            try {
              const res = await google(cue.original, targetCode, sourceCode);
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
        }
      }
    });

    await Promise.all(workers);
  } else {
    // 2. Boshqa bepul provayderlar (SimplyTranslate, MyMemory)
    let cursor = 0;
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
  }

  if (ok === 0) {
    throw new Error(firstError ?? 'Tarjima provayderi javob bermadi');
  }

  return { detected };
}
