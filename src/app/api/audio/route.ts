import { NextResponse } from 'next/server';
import ytdl from '@distube/ytdl-core';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    if (!videoId) {
      return NextResponse.json({ error: 'videoId ko\'rsatilmadi' }, { status: 400 });
    }

    // YouTube dan audio formatlarini olish (15s timeout bilan)
    const info = await Promise.race([
      ytdl.getInfo(videoId, {
        requestOptions: {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('YouTube audio timeout')), 15_000)),
    ]);

    const formats = ytdl.filterFormats(info.formats, 'audioonly');

    if (!formats.length) {
      return NextResponse.json({ error: 'Audio oqim topilmadi' }, { status: 404 });
    }

    const bestAudio =
      ytdl.chooseFormat(formats, {
        quality: 'lowestaudio',
        filter: 'audioonly',
      }) || formats[0];

    const streamUrl = bestAudio.url;
    if (!streamUrl) {
      return NextResponse.json({ error: 'Audio URL olinmadi' }, { status: 500 });
    }

    const audioRes = await fetch(streamUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!audioRes.ok) {
      return NextResponse.json({ error: `Audio olinmadi (${audioRes.status})` }, { status: 500 });
    }

    const arrayBuffer = await audioRes.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        'Content-Type': bestAudio.mimeType?.split(';')[0] || 'audio/mp4',
        'Content-Length': String(arrayBuffer.byteLength),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'YouTube audio xatosi: ' + (err?.message || String(err)) },
      { status: 500 }
    );
  }
}
