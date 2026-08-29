import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { buildCues, type RawSegment } from '@/lib/transcript';
import { listTracks, pickTrack, fetchTrack } from '@/lib/captions';
import { translateCues } from '@/lib/translate';
import { getProfile } from '@/lib/voices';
import { DEFAULT_PROVIDER, getProviderMeta } from '@/lib/providers';
import { transcribeAudioStream } from '@/lib/transcribe';
import { sanitizeYouTubeError } from '@/lib/youtube';

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
  } catch (e: any) {
    if (e?.message && (e.message.includes('yoshga cheklangan') || e.message.includes('mavjud emas'))) {
      throw e;
    }
  }

  const attempts =
    sourceLang && sourceLang !== 'auto'
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

  throw lastError ?? new Error('Ushbu videoda YouTube taglavhalari (subtitrlar) topilmadi.');
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
    const providerMeta = getProviderMeta(provider);
    const userApiKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : undefined;

    // AI kalit mavjudligini tekshirish
    const hasAiKey = Boolean(
      userApiKey ||
      (provider === 'gemini' && process.env.GEMINI_API_KEY) ||
      (provider === 'groq' && process.env.GROQ_API_KEY)
    );

    let loaded: Loaded;
    try {
      loaded = await loadCaptions(videoId, String(sourceLang));
    } catch (e: any) {
      // Agar foydalanuvchi bepul provayderda bo'lsa va AI kalit kiritmagan bo'lsa:
      if (!hasAiKey && providerMeta.kind === 'free') {
        const errMessage = e?.message || '';
        const isBotError = /bot|sign in|confirm you're not a bot|captcha/i.test(errMessage);
        const isUnavailable = /yoshga cheklangan|mavjud emas|unavailable|unplayable|login_required|private/i.test(errMessage);

        if (isBotError) {
          return NextResponse.json(
            { error: "YouTube tizimi xavfsizlik (Bot) cheklovini o'rnatdi. Videoning taglavhasi yoki audiosini hozircha yuklab bo'lmayapti. Iltimos, birozdan so'ng qayta urinib ko'ring yoki API kalit kiriting." },
            { status: 403 }
          );
        }
        if (isUnavailable) {
          return NextResponse.json(
            { error: "Ushbu YouTube videosi mavjud emas, yosh cheklovi mavjud yoki maxfiy (yopiq)." },
            { status: 403 }
          );
        }

        return NextResponse.json(
          {
            error:
              `Ushbu videoda YouTube taglavhalari (subtitrlari) topilmadi. ` +
              `Bepul tarjima xizmati (${providerMeta.label}) faqat videoda mavjud subtitrlar asosida ishlaydi. ` +
              `Subtitrsiz videolarni ovozidan eshitib tarjima qilish uchun Sozlamalardan Gemini yoki Groq AI kalitini kiritishingiz mumkin.`,
          },
          { status: 404 }
        );
      }

      // Agar AI kalit bo'lsa yoki AI provayder tanlangan bo'lsa, ASR (Speech-to-Text) orqali transkripsiya qilamiz
      try {
        const asrResult = await transcribeAudioStream(
          videoId,
          userApiKey,
          typeof provider === 'string' ? provider : undefined
        );
        loaded = {
          segments: asrResult.segments,
          trackId: 'asr:ai',
          languageCode: asrResult.languageCode,
          label: asrResult.label,
        };
      } catch (asrErr: any) {
        const cleanErr = sanitizeYouTubeError(asrErr?.message || String(asrErr));
        return NextResponse.json(
          {
            error: cleanErr,
          },
          { status: 404 }
        );
      }
    }

    const cues = buildCues(loaded.segments);
    if (!cues.length) {
      return NextResponse.json({ error: "Taglavhalarda o'qiladigan matn yo'q" }, { status: 404 });
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
          apiKey: userApiKey,
        });
        detected = result.detected;
      } catch (e) {
        return NextResponse.json(
          {
            error: 'Tarjima xatosi: ' + String((e as Error)?.message ?? e),
            provider,
          },
          { status: 502 }
        );
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
    const rawMsg = String((error as Error)?.message ?? error);
    return NextResponse.json(
      { error: sanitizeYouTubeError(rawMsg) },
      { status: 500 }
    );
  }
}
