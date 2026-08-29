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

const CONSENT_COOKIE =
  'CONSENT=YES+cb.20210328-17-p0.en+FX+100; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AwGgJlbiIAEhkA; PREF=hl=en&gl=US';

/**
 * Qisqa muddatli kesh (faqat muvaffaqiyatli topilgan treklarni keshlaydi).
 */
const CACHE = new Map<string, { at: number; value: TrackList }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 60;

export async function listTracks(videoId: string): Promise<TrackList> {
  const cached = CACHE.get(videoId);
  if (cached && cached.value.tracks.length > 0 && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const value = await fetchTrackList(videoId);
  if (value.tracks.length > 0) {
    CACHE.set(videoId, { at: Date.now(), value });
    while (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value!);
  }
  return value;
}

async function fetchTrackList(videoId: string): Promise<TrackList> {
  let raw: RawTrack[] = [];
  let audioLang: string | undefined;

  // 1. Android Innertube orqali taglavhalarni olish (to'liq mijoz sarlavhalari bilan)
  try {
    const innertubeRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': INNERTUBE_CLIENT_VERSION,
        'Origin': 'https://www.youtube.com',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: INNERTUBE_CLIENT_VERSION,
            androidSdkVersion: 34,
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (innertubeRes.ok) {
      const data = await innertubeRes.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        raw = tracks;
      }
      audioLang = data?.videoDetails?.defaultAudioLanguage;
    }
  } catch {}

  // 2. Agar Innertube da topilmasa, YouTube watch sahifasini tahlil qilamiz (Cookie bilan)
  if (!raw.length) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
        headers: {
          'User-Agent': DESKTOP_UA,
          'Accept-Language': 'en-US,en;q=0.9',
          'Cookie': CONSENT_COOKIE,
        },
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
      }
    } catch {}
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
 */
export function pickTrack(list: TrackList, requested: string): CaptionTrack | null {
  const { tracks, defaultAudioLanguage } = list;
  if (!tracks.length) return null;

  if (requested && requested !== 'auto') {
    const exact = tracks.find(t => t.id === requested);
    if (exact) return exact;
    const byLang = tracks.filter(t => t.languageCode === requested || t.languageCode.split('-')[0] === requested);
    if (byLang.length) return byLang.find(t => t.kind === 'manual') ?? byLang[0];
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
  // 1. Dastlabki baseUrl orqali o'qish
  try {
    const res = await fetch(track.baseUrl, {
      headers: { 'User-Agent': DESKTOP_UA, 'Cookie': CONSENT_COOKIE },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const rawText = await res.text();
      const segments = parseCaptionsText(rawText);
      if (segments.length > 0) return segments;
    }
  } catch {}

  // 2. fmt=srv3 (XML timedtext formati)
  try {
    const srv3Url = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=srv3`;
    const resSrv3 = await fetch(srv3Url, {
      headers: { 'User-Agent': DESKTOP_UA, 'Cookie': CONSENT_COOKIE },
      signal: AbortSignal.timeout(20_000),
    });
    if (resSrv3.ok) {
      const textSrv3 = await resSrv3.text();
      const segments = parseCaptionsText(textSrv3);
      if (segments.length > 0) return segments;
    }
  } catch {}

  // 3. fmt=json3 (JSON3 formati)
  try {
    const json3Url = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`;
    const resJson = await fetch(json3Url, {
      headers: { 'User-Agent': DESKTOP_UA, 'Cookie': CONSENT_COOKIE },
      signal: AbortSignal.timeout(20_000),
    });
    if (resJson.ok) {
      const textJson = await resJson.text();
      const segments = parseCaptionsText(textJson);
      if (segments.length > 0) return segments;
    }
  } catch {}

  return [];
}
