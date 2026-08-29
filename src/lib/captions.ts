/**
 * YouTube taglavha treklarini ro'yxatlash va o'qish.
 *
 * `youtube-transcript` paketi faqat bitta trekni oladi va qaysi tillar
 * mavjudligini aytmaydi. Bu yerda watch sahifasidan va Android Innertube dan
 * `captionTracks` ro'yxati olinadi — shu bilan foydalanuvchi manba tilini o'zi tanlashi mumkin bo'ladi.
 *
 * Ishlab chiquvchi: InnoHub & Usmoxan Design
 */

import type { RawSegment } from './transcript';
import {
  INNERTUBE_CLIENT_VERSION,
  INNERTUBE_USER_AGENT,
  DESKTOP_UA,
  parseCaptionsText,
} from './youtube';

export interface CaptionTrack {
  /** Trek identifikatori: `<languageCode>:<kind>` */
  id: string;
  languageCode: string;
  label: string;
  /** `asr` — YouTube avtomatik yozgan, `manual` — qo'lda kiritilgan */
  kind: 'asr' | 'manual';
  baseUrl: string;
}

export interface TrackList {
  tracks: CaptionTrack[];
  /** Videoning asl audio tili, YouTube aytsa */
  defaultAudioLanguage?: string;
}

interface RawTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
}

function trackLabel(t: RawTrack): string {
  return t.name?.simpleText ?? t.name?.runs?.[0]?.text ?? t.languageCode ?? "Noma'lum";
}

/**
 * Watch sahifasini takror-takror olish YouTube tomonidan cheklanadi, natijada
 * bir seansda /api/tracks va /api/dub turli natija qaytarishi mumkin edi.
 * Qisqa muddatli kesh buni bartaraf qiladi.
 */
const CACHE = new Map<string, { at: number; value: TrackList }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 60;

export async function listTracks(videoId: string): Promise<TrackList> {
  const cached = CACHE.get(videoId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const value = await fetchTrackList(videoId);
  CACHE.set(videoId, { at: Date.now(), value });
  while (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value!);
  return value;
}

async function fetchTrackList(videoId: string): Promise<TrackList> {
  let raw: RawTrack[] = [];
  let audioLang: string | undefined;

  // 1. Birinchi navbatda tezkor va ishonchli Android Innertube orqali tekshiramiz
  try {
    const innertubeRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
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
      signal: AbortSignal.timeout(15_000),
    });

    if (innertubeRes.ok) {
      const data = await innertubeRes.json();
      const status = data?.playabilityStatus?.status;
      if (status === 'ERROR' || status === 'LOGIN_REQUIRED' || status === 'UNPLAYABLE') {
        const reason = data?.playabilityStatus?.reason || 'Video mavjud emas yoki yoshga cheklangan';
        throw new Error(reason);
      }
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        raw = tracks;
      }
      audioLang = data?.videoDetails?.defaultAudioLanguage;
    }
  } catch (e: any) {
    if (e?.message && !e.message.includes('fetch failed')) {
      throw e;
    }
  }

  // 2. Agar Innertube da topilmasa, YouTube watch sahifasini tahlil qilamiz
  if (!raw.length) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
        headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const html = await res.text();
        const match = html.match(/"captionTracks":(\[.*?\])/);
        if (match) {
          try {
            raw = JSON.parse(match[1]);
          } catch {
            raw = [];
          }
        }
        if (!audioLang) {
          audioLang = html.match(/"defaultAudioLanguage":"([\w-]+)"/)?.[1];
        }
        if (!raw.length && /"playabilityStatus":\{"status":"(LOGIN_REQUIRED|UNPLAYABLE|ERROR)"/.test(html)) {
          throw new Error('Video ochiq emas yoki yoshga cheklangan');
        }
      }
    } catch (e: any) {
      if (e?.message && e.message.includes('Video ochiq emas')) {
        throw e;
      }
    }
  }

  if (!raw.length) {
    return { tracks: [] };
  }

  const tracks: CaptionTrack[] = raw
    .filter(t => t.baseUrl && t.languageCode)
    .map(t => ({
      id: `${t.languageCode}:${t.kind === 'asr' ? 'asr' : 'manual'}`,
      languageCode: t.languageCode!,
      label: trackLabel(t),
      kind: t.kind === 'asr' ? ('asr' as const) : ('manual' as const),
      baseUrl: t.baseUrl!,
    }));

  return { tracks, defaultAudioLanguage: audioLang };
}

/**
 * `auto` uchun trek tanlash: gapirilayotgan tilni topish maqsadi.
 * ASR treki har doim asl til bo'ladi, lekin qo'lda kiritilgan matn sifatliroq —
 * shuning uchun ASR tili bo'yicha qo'lda trek bo'lsa, o'shani olamiz.
 */
export function pickTrack(list: TrackList, requested: string): CaptionTrack | null {
  const { tracks, defaultAudioLanguage } = list;
  if (!tracks.length) return null;

  if (requested && requested !== 'auto') {
    // Aniq id (`en:asr`) bo'lsa aynan o'shani, aks holda til kodi bo'yicha
    const exact = tracks.find(t => t.id === requested);
    if (exact) return exact;
    const byLang = tracks.filter(t => t.languageCode === requested || t.languageCode.split('-')[0] === requested);
    if (byLang.length) return byLang.find(t => t.kind === 'manual') ?? byLang[0];
    // So'ralgan til yo'q — avtomatik tanlashga tushamiz
  }

  const asr = tracks.find(t => t.kind === 'asr');
  const spoken = defaultAudioLanguage?.split('-')[0] ?? asr?.languageCode.split('-')[0];

  if (spoken) {
    const manual = tracks.find(t => t.kind === 'manual' && t.languageCode.split('-')[0] === spoken);
    if (manual) return manual;
  }
  return asr ?? tracks[0];
}

/** Tanlangan trekni o'qib, xom segmentlarga aylantiradi (XML va JSON formatlarini to'liq qo'llab-quvvatlaydi). */
export async function fetchTrack(track: CaptionTrack): Promise<RawSegment[]> {
  const res = await fetch(track.baseUrl, {
    headers: { 'User-Agent': DESKTOP_UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Taglavha yuklanmadi (${res.status})`);

  const rawText = await res.text();
  const segments = parseCaptionsText(rawText);

  if (!segments.length) {
    // Agar dastlabki format bo'sh bo'lsa, `fmt=json3` bilan qayta urinib ko'ramiz
    const json3Url = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`;
    const resJson = await fetch(json3Url, {
      headers: { 'User-Agent': DESKTOP_UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (resJson.ok) {
      const textJson = await resJson.text();
      return parseCaptionsText(textJson);
    }
  }

  return segments;
}
