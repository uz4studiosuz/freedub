import { NextResponse } from 'next/server';
import { listTracks, pickTrack } from '@/lib/captions';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Video uchun mavjud taglavha tillari — manba tilini tanlash uchun. */
export async function GET(request: Request) {
  const videoId = new URL(request.url).searchParams.get('videoId');
  if (!videoId) {
    return NextResponse.json({ error: 'videoId kerak' }, { status: 400 });
  }

  try {
    const list = await listTracks(videoId);
    const auto = pickTrack(list, 'auto');
    return NextResponse.json({
      success: true,
      tracks: list.tracks.map(t => ({
        id: t.id,
        languageCode: t.languageCode,
        label: t.label,
        kind: t.kind,
      })),
      defaultAudioLanguage: list.defaultAudioLanguage,
      autoTrackId: auto?.id ?? null,
    });
  } catch {
    return NextResponse.json({
      success: true,
      tracks: [],
      autoTrackId: null,
    });
  }
}
