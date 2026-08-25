import { synthesize } from '@/lib/edge-tts';
import { findPreset } from '@/lib/voices';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Bir xil matn qayta so'ralganda Edge ga qayta bormaslik uchun oddiy LRU. */
const CACHE = new Map<string, Buffer>();
const CACHE_LIMIT = 400;

function cacheGet(key: string): Buffer | undefined {
  const hit = CACHE.get(key);
  if (hit) { CACHE.delete(key); CACHE.set(key, hit); } // eng yangi qilib qo'yamiz
  return hit;
}

function cacheSet(key: string, buf: Buffer) {
  CACHE.set(key, buf);
  while (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value!);
}

export async function POST(request: Request) {
  try {
    const { text, targetLang = "O'zbekiston", voiceId = 'Sardor', speed = 0 } = await request.json();

    const clean = String(text ?? '').trim();
    if (!clean) return Response.json({ error: 'Matn bo\'sh' }, { status: 400 });

    const preset = findPreset(targetLang, voiceId);
    // Cue vaqtiga sig'dirish uchun klient qo'shimcha tezlik so'rashi mumkin (-30..+50%)
    const extra = Math.max(-30, Math.min(50, Math.round(Number(speed) || 0)));
    const total = (parseInt(preset.rate, 10) || 0) + extra;
    const rate = `${total >= 0 ? '+' : ''}${total}%`;

    const key = crypto
      .createHash('sha1')
      .update(`${preset.voice}|${preset.pitch}|${rate}|${clean}`)
      .digest('hex');

    let audio = cacheGet(key);
    if (!audio) {
      audio = await synthesize({ text: clean, voice: preset.voice, pitch: preset.pitch, rate });
      cacheSet(key, audio);
    }

    return new Response(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.length),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    return Response.json(
      { error: 'TTS xatosi: ' + String((error as Error)?.message ?? error) },
      { status: 500 }
    );
  }
}
