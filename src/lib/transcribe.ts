/**
 * Ovozni matnga aylantirish (Speech-to-Text / AI ASR) moduli.
 * Agar YouTube videosida tayyor taglavhalar topilmasa, bu modul video audiosidan
 * foydalanib sun'iy intellekt (Gemini Audio yoki Groq Whisper) orqali
 * matn va timestamplarni to'liq tiklab beradi.
 *
 * Ishlab chiquvchi: InnoHub & Usmoxan Design
 */

import type { RawSegment } from './transcript';
import { fetchYouTubeAudioBuffer, sanitizeYouTubeError } from './youtube';
import ytdl from '@distube/ytdl-core';

export async function transcribeAudioStream(
  videoId: string,
  apiKey?: string,
  provider?: string
): Promise<{ segments: RawSegment[]; languageCode: string; label: string }> {
  const geminiKey = apiKey || process.env.GEMINI_API_KEY;
  const groqKey = apiKey || process.env.GROQ_API_KEY;

  const hasGemini = Boolean(
    geminiKey && (provider === 'gemini' || !provider || geminiKey.startsWith('AIza') || geminiKey.startsWith('AQ.'))
  );
  const hasGroq = Boolean(
    groqKey && (provider === 'groq' || groqKey.startsWith('gsk_'))
  );

  // Agar AI kaliti bo'lmasa, audio yuklab resurs sarflamaymiz va xatoni to'g'ri qaytaramiz
  if (!hasGemini && !hasGroq) {
    throw new Error(
      "Ovozli tarjima (Audio ASR) funksiyasidan foydalanish uchun Sozlamalardan Gemini yoki Groq API kalitini kiritishingiz kerak."
    );
  }

  // 1. YouTube audio oqimini blokirovkasiz olish (Android Innertube orqali)
  let audioBuffer: Buffer;
  let mimeType: string;

  try {
    const audioData = await fetchYouTubeAudioBuffer(videoId);
    audioBuffer = audioData.buffer;
    mimeType = audioData.mimeType;
  } catch (innertubeErr: any) {
    // Zaxira: agar Innertube ishlamasa, ytdl orqali urinib ko'ramiz
    try {
      const info = await ytdl.getInfo(videoId, {
        requestOptions: {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          },
        },
      });
      const formats = ytdl.filterFormats(info.formats, 'audioonly');
      if (!formats.length) throw new Error('Video audio oqimi topilmadi');

      const bestAudio =
        ytdl.chooseFormat(formats, { quality: 'lowestaudio', filter: 'audioonly' }) || formats[0];
      const audioRes = await fetch(bestAudio.url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!audioRes.ok) throw new Error(`Audio yuklanmadi: ${audioRes.status}`);
      const arrayBuffer = await audioRes.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
      mimeType = bestAudio.mimeType?.split(';')[0] || 'audio/mp4';
    } catch (ytdlErr: any) {
      const cleanErr = sanitizeYouTubeError(ytdlErr?.message || innertubeErr?.message || '');
      throw new Error(cleanErr);
    }
  }

  const base64Audio = audioBuffer.toString('base64');

  // 2. Google Gemini Multimodal Audio Transcription
  if (hasGemini && geminiKey) {
    try {
      const prompt = `You are a speech-to-text transcriber. Listen carefully to this audio and generate a precise timestamped transcription with clear sentences.
Output ONLY a JSON array in the following exact format:
[
  { "offset": <start_time_in_milliseconds>, "duration": <duration_in_milliseconds>, "text": "<transcribed_speech>" }
]
Do not omit words. Return clean spoken text without extra commentary.`;

      const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: base64Audio,
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
          signal: AbortSignal.timeout(90_000),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const segments: RawSegment[] = parsed
                .map((p: any) => ({
                  text: String(p.text || '').trim(),
                  offset: Number(p.offset ?? (p.start ? p.start * 1000 : 0)),
                  duration: Number(p.duration ?? (p.end && p.start ? (p.end - p.start) * 1000 : 3000)),
                }))
                .filter(s => s.text.length > 0);

              if (segments.length) {
                return {
                  segments,
                  languageCode: 'auto',
                  label: 'Google Gemini AI (ASR Ovoz)',
                };
              }
            }
          } catch (e) {
            console.warn('Gemini audio parse error:', e);
          }
        }
      }
    } catch (e) {
      console.warn('Gemini ASR request error:', e);
    }
  }

  // 3. Groq Whisper AI Transcription
  if (hasGroq && groqKey) {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
      formData.append('file', blob, 'audio.mp4');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('response_format', 'verbose_json');

      const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}` },
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });

      if (groqRes.ok) {
        const data = await groqRes.json();
        const segments: RawSegment[] = (data.segments || []).map((s: any) => ({
          text: s.text,
          offset: Math.round(s.start * 1000),
          duration: Math.round((s.end - s.start) * 1000),
        }));

        if (segments.length) {
          return {
            segments,
            languageCode: data.language || 'en',
            label: 'Groq Whisper AI (ASR)',
          };
        }
      }
    } catch (e) {
      console.warn('Groq ASR request error:', e);
    }
  }

  throw new Error(
    "Videoni sun'iy intellekt orqali eshitib matnga aylantirib bo'lmadi. Iltimos API kalit to'g'riligini tekshiring yoki taglavhasi bor videoni tanlang."
  );
}
