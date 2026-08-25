'use client';

import { useEffect, useRef } from 'react';
import 'plyr/dist/plyr.css';

// Plyr ning tip fayli `export = Plyr` ishlatadi, shuning uchun default import
// tip darajasida ishlamaydi — konstruktor va instansiya tiplarini shundan olamiz.
type PlyrCtor = typeof import('plyr');
type PlyrInstance = InstanceType<PlyrCtor>;

/**
 * Dublyaj dvigateli pleyerdan nimani so'rashi.
 *
 * Vaqt va holat Plyr orqali emas, uning ostidagi YouTube `embed` obyektidan
 * o'qiladi: Plyr ning `playing` xossasi buferlash paytida ham `true` qoladi,
 * `getPlayerState() === 1` esa buni to'g'ri ajratadi — sinxron uchun muhim.
 */
export interface PlayerHandle {
  getTime: () => number;
  getRate: () => number;
  isPlaying: () => boolean;
  seek: (seconds: number) => void;
  play: () => void;
  setVolume: (percent: number) => void;
}

interface Props {
  videoId: string;
  /** 0–100 */
  originalVolume: number;
  onReady?: (handle: PlayerHandle) => void;
}

export default function VideoPlayer({ videoId, originalVolume, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plyrRef = useRef<PlyrInstance | null>(null);
  const volumeRef = useRef(originalVolume);
  /** Konstruksiya paytida data-atributdan olingan id — birinchi `source` yangilanishini o'tkazib yuborish uchun */
  const initialIdRef = useRef(videoId);

  // Plyr `document` ga import paytida tegadi, shuning uchun faqat brauzerda yuklaymiz.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let player: PlyrInstance | null = null;

    (async () => {
      const mod = await import('plyr');
      // dist/plyr.mjs default eksport beradi; CJS holatida modulning o'zi konstruktor
      const Plyr = (mod as unknown as { default?: PlyrCtor }).default ?? (mod as unknown as PlyrCtor);
      if (cancelled || !hostRef.current) return;

      player = new Plyr(hostRef.current, {
        ratio: '16:9',
        controls: [
          'play-large', 'play', 'progress', 'current-time', 'duration',
          'mute', 'volume', 'settings', 'pip', 'fullscreen',
        ],
        settings: ['quality', 'speed'],
        speed: { selected: 1, options: [0.75, 1, 1.25, 1.5, 2] },
        youtube: { rel: 0, modestbranding: 1, iv_load_policy: 3 },
        keyboard: { focused: true, global: false },
      });
      plyrRef.current = player;

      const instance = player;
      instance.on('ready', () => {
        instance.volume = Math.max(0, Math.min(1, volumeRef.current / 100));
      });

      // `embed` source almashganda qayta yaratiladi — shuning uchun har chaqiruvda o'qiymiz
      const embed = () =>
        (instance as unknown as { embed?: Record<string, () => unknown> }).embed;

      onReady?.({
        getTime: () => {
          const yt = embed();
          if (typeof yt?.getCurrentTime === 'function') return Number(yt.getCurrentTime());
          return Number(instance.currentTime);
        },
        getRate: () => {
          const yt = embed();
          if (typeof yt?.getPlaybackRate === 'function') return Number(yt.getPlaybackRate()) || 1;
          return Number(instance.speed) || 1;
        },
        isPlaying: () => {
          const yt = embed();
          // YT holatlari: 1 = ijro etilmoqda; 3 = buferlash (bunda ovoz to'xtaydi)
          if (typeof yt?.getPlayerState === 'function') return yt.getPlayerState() === 1;
          return instance.playing;
        },
        seek: seconds => { instance.currentTime = seconds; },
        play: () => { void instance.play(); },
        setVolume: percent => { instance.volume = Math.max(0, Math.min(1, percent / 100)); },
      });
    })();

    return () => {
      cancelled = true;
      plyrRef.current = null;
      try { player?.destroy(); } catch { /* allaqachon yo'q */ }
    };
    // Instansiya umr bo'yi bitta — qayta yaratish YouTube iframe ini uzadi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // videoId almashsa manbani yangilaymiz (birinchi id konstruksiyada berilgan)
  useEffect(() => {
    if (videoId === initialIdRef.current) return;
    const player = plyrRef.current;
    if (!player) return;
    player.source = {
      type: 'video',
      sources: [{ src: videoId, provider: 'youtube' }],
    };
  }, [videoId]);

  useEffect(() => {
    // Plyr `ready` dan keyin ovoz balandligini shu refdan oladi
    volumeRef.current = originalVolume;
    const player = plyrRef.current;
    if (!player) return;
    try {
      player.volume = Math.max(0, Math.min(1, originalVolume / 100));
    } catch { /* hali tayyor emas */ }
  }, [originalVolume]);

  return <div ref={hostRef} data-plyr-provider="youtube" data-plyr-embed-id={videoId} />;
}
