/**
 * YouTube ma'lumotlarini (taglavhalar, audio oqim) ishonchli olish va
 * bot cheklovlarini chetlab o'tish yordamchi moduli.
 *
 * Ishlab chiquvchi: InnoHub & Usmoxan Design
 */

import type { RawSegment } from './transcript';

export const INNERTUBE_CLIENT_VERSION = '20.10.38';
export const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';

export interface CaptionTrackInfo {
  id: string;
  languageCode: string;
  label: string;
  kind: 'asr' | 'manual';
  baseUrl: string;
}

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/**
 * YouTube taglavhalari matnini universal tahlil qilish (JSON3, timedtext format 3 XML va classic XML).
 */
export function parseCaptionsText(rawText: string): RawSegment[] {
  const segments: RawSegment[] = [];
  const text = rawText.trim();
  if (!text) return segments;

  // 1. JSON3 formati
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const data = JSON.parse(text);
      const events = data.events || (Array.isArray(data) ? data : []);
      for (const ev of events) {
        const segText = (ev.segs || []).map((s: { utf8?: string }) => s.utf8 || '').join('');
        if (!segText.trim()) continue;
        segments.push({
          text: decodeHtmlEntities(segText).trim(),
          offset: Number(ev.tStartMs ?? 0),
          duration: Number(ev.dDurationMs ?? 2000),
        });
      }
      if (segments.length > 0) return segments;
    } catch {
      // XML ga o'tamiz
    }
  }

  // 2. XML <p t="ms" d="ms"> formati (timedtext format 3)
  const pRegex = /<p\s+[^>]*?t="(\d+)"[^>]*?(?:d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(text)) !== null) {
    const startMs = parseInt(pMatch[1], 10);
    const durMs = pMatch[2] ? parseInt(pMatch[2], 10) : 2000;
    let content = pMatch[3];
    content = content.replace(/<[^>]+>/g, '');
    content = decodeHtmlEntities(content).trim();
    if (content) {
      segments.push({
        text: content,
        offset: startMs,
        duration: durMs,
      });
    }
  }
  if (segments.length > 0) return segments;

  // 3. Klassik XML <text start="s" dur="s"> formati
  const textRegex = /<text\s+[^>]*?start="([\d.]+)"[^>]*?(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let tMatch: RegExpExecArray | null;
  while ((tMatch = textRegex.exec(text)) !== null) {
    const startSec = parseFloat(tMatch[1]);
    const durSec = tMatch[2] ? parseFloat(tMatch[2]) : 2;
    let content = tMatch[3].replace(/<[^>]+>/g, '');
    content = decodeHtmlEntities(content).trim();
    if (content) {
      segments.push({
        text: content,
        offset: Math.round(startSec * 1000),
        duration: Math.round(durSec * 1000),
      });
    }
  }

  return segments;
}

/**
 * YouTube Android Innertube orqali to'g'ridan-to'g'ri audio formatini yuklab olish.
 * Bu usul serverless / Vercel muhitida bot cheklovlarisiz ishlaydi.
 */
export async function fetchYouTubeAudioBuffer(videoId: string): Promise<{
  buffer: Buffer;
  mimeType: string;
  bitrate?: number;
}> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: INNERTUBE_CLIENT_VERSION,
            hl: 'en',
          },
        },
        videoId,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (res.ok) {
      const data = await res.json();
      const status = data?.playabilityStatus?.status;
      if (status === 'ERROR' || status === 'LOGIN_REQUIRED' || status === 'UNPLAYABLE') {
        const reason = data?.playabilityStatus?.reason || "Bu YouTube videosi mavjud emas yoki yopiq.";
        throw new Error(reason);
      }

      const adaptive = data?.streamingData?.adaptiveFormats || [];
      const audioFormats = adaptive.filter((f: any) => f.mimeType?.startsWith('audio/') && f.url);
      if (audioFormats.length > 0) {
        const best = audioFormats.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        const audioRes = await fetch(best.url, {
          headers: {
            'User-Agent': INNERTUBE_USER_AGENT,
          },
          signal: AbortSignal.timeout(45_000),
        });

        if (audioRes.ok) {
          const arrayBuffer = await audioRes.arrayBuffer();
          return {
            buffer: Buffer.from(arrayBuffer),
            mimeType: best.mimeType.split(';')[0] || 'audio/mp4',
            bitrate: best.bitrate,
          };
        }
      }
    }
  } catch (e: any) {
    if (e?.message && !e.message.includes('fetch failed')) {
      throw e;
    }
  }

  throw new Error("Videoning audio oqimini yuklab bo'lmadi yoki video mavjud emas.");
}

/**
 * YouTube xatolarini foydalanuvchiga tushunarli toza o'zbekcha matnga aylantirish.
 */
export function sanitizeYouTubeError(msg: string): string {
  if (!msg) return "Noma'lum xatolik yuz berdi.";
  if (/bot|sign in|confirm you're not a bot|captcha/i.test(msg)) {
    return "Ushbu videoda YouTube taglavhalari topilmadi. Bepul tarjima xizmatlari mavjud subtitrlar asosida ishlaydi. Subtitrsiz videolarni tarjima qilish uchun Sozlamalardan Gemini yoki Groq AI kalitini kiriting.";
  }
  if (/unavailable|unplayable|login_required|private/i.test(msg)) {
    return "Ushbu YouTube videosi mavjud emas, yosh cheklovi mavjud yoki maxfiy (yopiq).";
  }
  return msg;
}
