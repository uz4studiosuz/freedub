import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { buildCues, type RawSegment } from '@/lib/transcript';
import { listTracks, pickTrack, fetchTrack } from '@/lib/captions';
import { translateCues } from '@/lib/translate';
import { getProfile } from '@/lib/voices';
import { DEFAULT_PROVIDER } from '@/lib/providers';
import { transcribeAudioStream } from '@/lib/transcribe';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface Loaded {
  segments: RawSegment[];
  /** Ishlatilgan trek (`en:asr` kabi) yoki `unknown` */
  trackId: string;
  languageCode: string;
  label: string;
}

/**
 * Avval o'z trek ro'yxatimizdan foydalanamiz — bu manba tilini tanlash imkonini
 * beradi. U ishlamasa `youtube-transcript` paketiga tushamiz.
 */
async function loadCaptions(videoId: string, sourceLang: string): Promise<Loaded> {
  try {
    const list = await listTracks(videoId);
    const track = pickTrack(list, sourceLang);
    if (track) {
      const segments = await fetchTrack(track);
      if (segments.length) {
        return {
          segments,
          trackId: track.id,
          languageCode: track.languageCode,
          label: track.label,
        };
      }
    }
  } catch {
    /* zaxira yo'lga o'tamiz */
  }

  const attempts = sourceLang && sourceLang !== 'auto'
    ? [{ lang: sourceLang.split(':')[0] }, undefined]
    : [undefined, { lang: 'en' }];

  let lastError: unknown;
  for (const opts of attempts) {
    try {
      const result = await YoutubeTranscript.fetchTranscript(videoId, opts as never);
      if (result?.length) {
        return {
          segments: result.map(i => ({ text: i.text, offset: i.offset, duration: i.duration })),
          trackId: 'unknown',
          languageCode: (opts as { lang?: string })?.lang ?? 'unknown',
          label: 'Avtomatik',
        };
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('Taglavhalar topilmadi');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      videoId,
      targetLang = "O'zbekiston",
      sourceLang = 'auto',
      provider = DEFAULT_PROVIDER,
      apiKey,
    } = body ?? {};

    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json({ error: 'Video ID kerak' }, { status: 400 });
    }

    const profile = getProfile(targetLang);

    let loaded: Loaded;
    try {
      loaded = await loadCaptions(videoId, String(sourceLang));
    } catch (e) {
      // Agar YouTube taglavhalari topilmasa, AI ASR (Speech-to-Text) orqali ovozdan transkripsiya qilamiz
      try {
        const asrResult = await transcribeAudioStream(
          videoId,
          typeof apiKey === 'string' ? apiKey : undefined,
          typeof provider === 'string' ? provider : undefined
        );
        loaded = {
          segments: asrResult.segments,
          trackId: 'asr:ai',
          languageCode: asrResult.languageCode,
          label: asrResult.label,
        };
      } catch (asrErr) {
        return NextResponse.json(
          {
            error:
              (asrErr as Error)?.message ||
              "Bu video uchun taglavhalar topilmadi. Taglavhasiz videolarni ovozidan eshitib tarjima qilish uchun Sozlamalarda Gemini yoki Groq API kalitingizni kiriting.",
            details: String((e as Error)?.message ?? e),
          },
          { status: 404 }
        );
      }
    }

    const cues = buildCues(loaded.segments);
    if (!cues.length) {
      return NextResponse.json({ error: 'Taglavhalarda o\'qiladigan matn yo\'q' }, { status: 404 });
    }

    // Manba va maqsad tili bir xil bo'lsa tarjima keraksiz — matnni shundayligicha o'qiymiz
    const sameLanguage = loaded.languageCode.split('-')[0] === profile.code.split('-')[0];

    let detected: string | undefined;
    if (!sameLanguage) {
      try {
        const result = await translateCues(cues, {
          provider: String(provider),
          targetCode: profile.code,
          targetName: profile.name,
          sourceCode: loaded.languageCode === 'unknown' ? 'auto' : loaded.languageCode,
          apiKey: typeof apiKey === 'string' ? apiKey : undefined,
        });
        detected = result.detected;
      } catch (e) {
        return NextResponse.json({
          error: 'Tarjima xatosi: ' + String((e as Error)?.message ?? e),
          provider,
        }, { status: 502 });
      }
    }

    return NextResponse.json({
      success: true,
      cues,
      langCode: profile.code,
      provider,
      source: {
        trackId: loaded.trackId,
        languageCode: detected ?? loaded.languageCode,
        label: loaded.label,
        translated: !sameLanguage,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Server xatosi: ' + String((error as Error)?.message ?? error) },
      { status: 500 }
    );
  }
}
