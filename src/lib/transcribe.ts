/**
 * Ovozni matnga aylantirish (Speech-to-Text / AI ASR) moduli.
 * Agar YouTube videosida tayyor taglavhalar topilmasa, bu modul video audiosidan
 * foydalanib sun'iy intellekt (Gemini Audio yoki Groq Whisper) orqali
 * matn va timestamplarni to'liq tiklab beradi.
 *
 * Ishlab chiquvchi: InnoHub & Usmoxan Design
 */

import ytdl from '@distube/ytdl-core';
import type { RawSegment } from './transcript';

export async function transcribeAudioStream(
  videoId: string,
  apiKey?: string,
  provider?: string
): Promise<{ segments: RawSegment[]; languageCode: string; label: string }> {
  // 1. YouTube audio oqimini olish
  const info = await ytdl.getInfo(videoId);
  const formats = ytdl.filterFormats(info.formats, 'audioonly');
  if (!formats.length) throw new Error('Video audio oqimi topilmadi');

  const bestAudio = ytdl.chooseFormat(formats, { quality: 'lowestaudio', filter: 'audioonly' }) || formats[0];
  const audioRes = await fetch(bestAudio.url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(45_000),
  });

  if (!audioRes.ok) throw new Error(`Audio yuklanmadi: ${audioRes.status}`);
  const arrayBuffer = await audioRes.arrayBuffer();
  const base64Audio = Buffer.from(arrayBuffer).toString('base64');
  const mimeType = bestAudio.mimeType?.split(';')[0] || 'audio/mp4';

  // 2. Agar Gemini kaliti bo'lsa (Google AI Multimodal Audio Transcription)
  const geminiKey = apiKey || process.env.GEMINI_API_KEY;
  if (geminiKey && (provider === 'gemini' || !provider || geminiKey.startsWith('AIza') || geminiKey.startsWith('AQ.'))) {
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
  }

  // 3. Agar Groq Whisper kaliti bo'lsa
  const groqKey = apiKey || process.env.GROQ_API_KEY;
  if (groqKey && (provider === 'groq' || groqKey.startsWith('gsk_'))) {
    const formData = new FormData();
    const blob = new Blob([arrayBuffer], { type: mimeType });
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
  }

  throw new Error(
    "Bu videoda YouTube taglavhasi topilmadi. Taglavhasiz videolarni ovozidan eshitib tarjima qilish uchun Sozlamalarda Gemini yoki Groq API kalitingizni kiriting."
  );
}
