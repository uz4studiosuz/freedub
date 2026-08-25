'use client';

import type { Cue } from './transcript';

interface Clip {
  audio: HTMLAudioElement;
  url: string;
  /** Klipni cue oynasiga sig'dirish uchun tezlik koeffitsienti (>= 1) */
  fitRate: number;
  duration: number; // sekund
}

export interface EngineHost {
  /** Videoning joriy vaqti, sekundda */
  getTime: () => number;
  /** Videoning joriy tezligi (1 = normal) */
  getRate: () => number;
  isPlaying: () => boolean;
}

export interface EngineCallbacks {
  onCueChange?: (index: number, cue: Cue | null) => void;
  onReadyCount?: (ready: number, total: number) => void;
  onError?: (message: string) => void;
}

const TICK_MS = 100;
const PREFETCH_AHEAD = 8;
const CONCURRENCY = 3;
/** Shundan katta farq bo'lsa audio pozitsiyasi majburan to'g'rilanadi (sekund) */
const DRIFT_TOLERANCE = 0.32;
/** Klip cue oynasiga sig'ishi uchun bundan ortiq tezlashtirilmaydi */
const MAX_FIT_RATE = 1.5;
/** O'zbek neural ovozining taxminiy tezligi — TTS ni oldindan siqish uchun */
const CHARS_PER_SEC = 14.5;

export class DubEngine {
  private cues: Cue[] = [];
  private clips = new Map<number, Clip>();
  private loading = new Set<number>();
  private failed = new Set<number>();
  private queue: number[] = [];
  private workers = 0;

  private activeIdx = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private disposed = false;

  private volume = 1;
  private targetLang = "O'zbekiston";
  private voiceId = 'Sardor';

  constructor(private host: EngineHost, private cb: EngineCallbacks = {}) {}

  // ─── Umumiy boshqaruv ────────────────────────────────

  setCues(cues: Cue[]) {
    this.stop();
    this.releaseClips();
    this.cues = cues;
    this.activeIdx = -1;
    this.failed.clear();
  }

  setVoice(targetLang: string, voiceId: string) {
    const changed = targetLang !== this.targetLang || voiceId !== this.voiceId;
    this.targetLang = targetLang;
    this.voiceId = voiceId;
    // Ovoz o'zgarsa eski klip keshi yaroqsiz — qaytadan yuklanadi
    if (changed) {
      this.releaseClips();
      this.failed.clear();
      this.activeIdx = -1;
    }
  }

  setVolume(percent: number) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    for (const clip of this.clips.values()) clip.audio.volume = this.volume;
  }

  /**
   * Brauzerlar foydalanuvchi harakatisiz audio ijrosini bloklaydi.
   * Buni tugma bosilgan paytda chaqirish kerak.
   */
  async unlock() {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);
      setTimeout(() => ctx.close().catch(() => {}), 200);
    } catch {
      /* ruxsat bo'lmasa keyinroq qayta urinamiz */
    }
  }

  start() {
    if (this.disposed || this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pauseAll();
    if (this.activeIdx !== -1) {
      this.activeIdx = -1;
      this.cb.onCueChange?.(-1, null);
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.releaseClips();
  }

  get isRunning() {
    return this.running;
  }

  /** Ijrodan oldin birinchi bir necha cue ni tayyorlab qo'yadi. */
  async warmup(count = 4): Promise<void> {
    await Promise.all(this.cues.slice(0, count).map(c => this.ensureClip(c.id)));
  }

  // ─── Sinxronlash yuragi ──────────────────────────────

  private tick() {
    if (!this.running || !this.cues.length) return;

    const timeMs = this.host.getTime() * 1000;
    if (!Number.isFinite(timeMs)) return;

    const idx = this.findCueIndex(timeMs);
    this.schedulePrefetch(idx < 0 ? 0 : idx);

    if (idx !== this.activeIdx) {
      this.pauseAll();
      this.activeIdx = idx;
      this.cb.onCueChange?.(idx, idx >= 0 ? this.cues[idx] : null);
    }

    if (idx < 0) return;
    if (!this.host.isPlaying()) {
      this.pauseAll();
      return;
    }

    const cue = this.cues[idx];
    const clip = this.clips.get(cue.id);
    if (!clip) return; // hali yuklanmagan — tayyor bo'lishi bilan shu yerda boshlanadi

    // Video vaqtidan klip ichidagi pozitsiyani hisoblaymiz
    const elapsedSec = (timeMs - cue.start) / 1000;
    const expected = elapsedSec * clip.fitRate;

    // Klip tugagan — keyingi cue gacha jim turamiz
    if (expected >= clip.duration - 0.02) {
      if (!clip.audio.paused) clip.audio.pause();
      return;
    }

    const wantRate = clip.fitRate * (this.host.getRate() || 1);
    if (Math.abs(clip.audio.playbackRate - wantRate) > 0.01) clip.audio.playbackRate = wantRate;
    if (Math.abs(clip.audio.volume - this.volume) > 0.01) clip.audio.volume = this.volume;

    if (Math.abs(clip.audio.currentTime - expected) > DRIFT_TOLERANCE) {
      clip.audio.currentTime = Math.max(0, expected);
    }

    if (clip.audio.paused) {
      clip.audio.play().catch(() => {
        this.cb.onError?.('Brauzer ovozni bloqladi — sahifaning istalgan joyiga bosing.');
      });
    }
  }

  /** Cue faol: o'z boshlanishidan keyingi cue boshlanishigacha. */
  private findCueIndex(timeMs: number): number {
    const cues = this.cues;
    if (!cues.length || timeMs < cues[0].start) return -1;

    let lo = 0;
    let hi = cues.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= timeMs) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return -1;

    const next = cues[found + 1];
    const limit = next ? next.start : cues[found].end + 4000;
    return timeMs < limit ? found : -1;
  }

  private pauseAll() {
    for (const clip of this.clips.values()) {
      if (!clip.audio.paused) clip.audio.pause();
    }
  }

  // ─── Klip yuklash ────────────────────────────────────

  private schedulePrefetch(fromIdx: number) {
    const end = Math.min(this.cues.length, fromIdx + PREFETCH_AHEAD);
    for (let i = fromIdx; i < end; i++) {
      const id = this.cues[i].id;
      if (this.clips.has(id) || this.loading.has(id) || this.failed.has(id)) continue;
      if (!this.queue.includes(id)) this.queue.push(id);
    }
    this.pump();
  }

  private pump() {
    while (this.workers < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      this.workers++;
      void this.ensureClip(id).finally(() => {
        this.workers--;
        this.pump();
      });
    }
  }

  private async ensureClip(cueId: number): Promise<void> {
    if (this.disposed) return;
    if (this.clips.has(cueId) || this.loading.has(cueId) || this.failed.has(cueId)) return;

    const cue = this.cues.find(c => c.id === cueId);
    if (!cue) return;

    this.loading.add(cueId);
    try {
      const slotSec = Math.max(0.8, (cue.end - cue.start) / 1000);
      // Matn oynaga sig'masligi ehtimoli bo'lsa TTS ning o'zini tezroq gapirtiramiz —
      // bu playbackRate bilan cho'zishdan ancha tabiiyroq eshitiladi.
      const estimated = cue.text.length / CHARS_PER_SEC;
      const speedHint = Math.max(0, Math.min(40, Math.round((estimated / slotSec - 1) * 100)));

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cue.text,
          targetLang: this.targetLang,
          voiceId: this.voiceId,
          speed: speedHint,
        }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 160));

      const blob = await res.blob();
      if (this.disposed) return;

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.volume = this.volume;

      const duration = await new Promise<number>((resolve, reject) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          const d = audio.duration;
          resolve(Number.isFinite(d) && d > 0 ? d : slotSec);
        };
        audio.addEventListener('loadedmetadata', done, { once: true });
        audio.addEventListener('error', () => {
          if (settled) return;
          settled = true;
          reject(new Error('audio yuklanmadi'));
        }, { once: true });
        setTimeout(done, 8000);
      });

      const fitRate = Math.max(1, Math.min(MAX_FIT_RATE, duration / slotSec));
      this.clips.set(cueId, { audio, url, fitRate, duration });
      this.cb.onReadyCount?.(this.clips.size, this.cues.length);
    } catch (e) {
      this.failed.add(cueId);
      console.warn('[dub] cue', cueId, 'uchun ovoz olinmadi:', (e as Error).message);
    } finally {
      this.loading.delete(cueId);
    }
  }

  private releaseClips() {
    for (const clip of this.clips.values()) {
      try {
        clip.audio.pause();
        clip.audio.removeAttribute('src');
        clip.audio.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(clip.url);
    }
    this.clips.clear();
    this.loading.clear();
    this.queue = [];
  }
}
