/**
 * YouTube taglavha treklarini ro'yxatlash va o'qish.
 *
 * `youtube-transcript` paketi faqat bitta trekni oladi va qaysi tillar
 * mavjudligini aytmaydi. Bu yerda watch sahifasidan `captionTracks` ro'yxati
 * olinadi — shu bilan foydalanuvchi manba tilini o'zi tanlashi mumkin bo'ladi.
 */

import type { RawSegment } from './transcript';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';

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
  return t.name?.simpleText ?? t.name?.runs?.[0]?.text ?? t.languageCode ?? 'Noma\'lum';
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
  const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`YouTube sahifasi ochilmadi (${res.status})`);
  const html = await res.text();

  const match = html.match(/"captionTracks":(\[.*?\])/);
  if (!match) {
    if (/"playabilityStatus":\{"status":"(LOGIN_REQUIRED|UNPLAYABLE|ERROR)"/.test(html)) {
      throw new Error('Video ochiq emas yoki yoshga cheklangan');
    }
    return { tracks: [] };
  }

  let raw: RawTrack[];
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return { tracks: [] };
  }

  const audioLang = html.match(/"defaultAudioLanguage":"([\w-]+)"/)?.[1];

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

interface Json3 {
  events?: Array<{
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }>;
}

/** Tanlangan trekni o'qib, xom segmentlarga aylantiradi. */
export async function fetchTrack(track: CaptionTrack): Promise<RawSegment[]> {
  const url = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Taglavha yuklanmadi (${res.status})`);

  const data = (await res.json()) as Json3;
  const segments: RawSegment[] = [];

  for (const ev of data.events ?? []) {
    const text = (ev.segs ?? []).map(s => s.utf8 ?? '').join('');
    if (!text.trim()) continue;
    segments.push({
      text,
      offset: ev.tStartMs ?? 0,
      // Oxirgi bo'lakda dDurationMs yo'q bo'lishi mumkin
      duration: ev.dDurationMs ?? 2000,
    });
  }
  return segments;
}
