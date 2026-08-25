/**
 * Audio (MP3) va Video (MP4) eksport moduli.
 * Asl video ovozi va Dublyaj ovozini foydalanuvchi belgilagan foizlar bo'yicha
 * (Ovoz balansi) to'liq aralashtirib (mix qilib), sana va vaqt bilan nomlangan
 * toza .mp4 va .mp3 fayllarni hosil qiladi.
 *
 * Ishlab chiquvchi: InnoHub & Usmoxan Design
 */

import type { Cue } from './transcript';
import * as Mp4Muxer from 'mp4-muxer';
import { Mp3Encoder } from '@breezystack/lamejs';

export interface ExportProgress {
  step: 'fetching' | 'rendering' | 'encoding' | 'done';
  percent: number;
  message: string;
}

export interface MasterAudioOptions {
  cues: Cue[];
  targetLang: string;
  voiceId: string;
  videoId?: string;
  origVol?: number; // 0..100
  dubVol?: number;  // 0..100
  onProgress?: (p: ExportProgress) => void;
}

/** Sana va vaqt bo'yicha toza fayl nomini generatsiya qilish */
export function getExportFilename(videoId: string | undefined, ext: 'mp4' | 'mp3' | 'srt' | 'vtt' | 'txt'): string {
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const timeStr = `${YYYY}-${MM}-${DD}_${hh}-${mm}-${ss}`;
  const vId = videoId ? videoId.replace(/[^a-zA-Z0-9_-]/g, '') : 'video';
  return `AutoDub_${vId}_${timeStr}.${ext}`;
}

/** AudioBuffer ni toza MP3 formatidagi Blob ga aylantirish (LameJS) */
export function audioBufferToMp3(buffer: AudioBuffer, kbps = 160): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data: Uint8Array[] = [];

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;
  const sampleBlockSize = 1152;

  const leftInt16 = new Int16Array(left.length);
  const rightInt16 = new Int16Array(right.length);

  for (let i = 0; i < left.length; i++) {
    leftInt16[i] = Math.max(-1, Math.min(1, left[i])) * 0x7fff;
    rightInt16[i] = Math.max(-1, Math.min(1, right[i])) * 0x7fff;
  }

  for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
    const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
    const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
    const mp3buf =
      channels === 1
        ? mp3encoder.encodeBuffer(leftChunk)
        : mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  const endBuf = mp3encoder.flush();
  if (endBuf.length > 0) {
    mp3Data.push(endBuf);
  }

  return new Blob(mp3Data as BlobPart[], { type: 'audio/mp3' });
}

/**
 * Barcha cue lar uchun TTS ovozlarni va Asl video ovozini (YouTube stream)
 * foydalanuvchi belgilagan hajm (origVol & dubVol) bilan aralashtirib,
 * to'liq Master AudioBuffer va toza MP3 hosil qiladi.
 */
export async function generateMasterAudio(
  opts: MasterAudioOptions
): Promise<{ mp3Blob: Blob; buffer: AudioBuffer; totalDuration: number }> {
  const { cues, targetLang, voiceId, videoId, origVol = 20, dubVol = 100, onProgress } = opts;
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const totalCues = cues.length;
  if (!totalCues) throw new Error('Dublyaj matni mavjud emas');

  onProgress?.({
    step: 'fetching',
    percent: 5,
    message: 'Dublyaj ovozlari parallel yuklanmoqda (0/' + totalCues + ')…',
  });

  // 1. Dublyaj ovozlarini parallel yuklash
  const CONCURRENCY = 8;
  const decodedBuffers: { startMs: number; buffer: AudioBuffer }[] = new Array(totalCues);
  let completed = 0;
  let cursor = 0;

  const fetchWorker = async () => {
    while (cursor < totalCues) {
      const idx = cursor++;
      const cue = cues[idx];
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cue.text,
          targetLang,
          voiceId,
          speed: 0,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `TTS xatosi: ${res.status}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      decodedBuffers[idx] = { startMs: cue.start, buffer: audioBuffer };
      completed++;

      onProgress?.({
        step: 'fetching',
        percent: Math.round(5 + (completed / totalCues) * 35),
        message: `Dublyaj ovozlari yuklanmoqda (${completed}/${totalCues})…`,
      });
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, totalCues) }, () => fetchWorker());
  await Promise.all(workers);

  // 2. Asl video ovozini (Original Audio) olish (agar origVol > 0 bo'lsa)
  let origAudioBuffer: AudioBuffer | null = null;
  if (origVol > 0 && videoId) {
    try {
      onProgress?.({
        step: 'fetching',
        percent: 42,
        message: 'Asl video audio treki olinmoqda…',
      });
      const audioRes = await fetch(`/api/audio?videoId=${encodeURIComponent(videoId)}`);
      if (audioRes.ok) {
        const origAb = await audioRes.arrayBuffer();
        origAudioBuffer = await audioCtx.decodeAudioData(origAb);
      }
    } catch (e) {
      console.warn("Asl audio olinmadi, faqat dublyaj ovozi ishlatiladi:", e);
    }
  }

  // 3. Umumiy davomiylikni hisoblash
  let lastEndMs = 0;
  for (const item of decodedBuffers) {
    if (item) {
      const endMs = item.startMs + item.buffer.duration * 1000;
      if (endMs > lastEndMs) lastEndMs = endMs;
    }
  }
  if (origAudioBuffer) {
    const origDurationMs = origAudioBuffer.duration * 1000;
    if (origDurationMs > lastEndMs) lastEndMs = origDurationMs;
  }

  const totalDurationSec = Math.max(1, (lastEndMs + 1000) / 1000);
  const sampleRate = 44100;

  onProgress?.({
    step: 'rendering',
    percent: 50,
    message: 'Asl ovoz va dublyaj aralashtirilmoqda (Mix)…',
  });

  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDurationSec), sampleRate);

  // Dublyaj ovozi uchun Gain (ovoz balansi)
  const dubGain = offlineCtx.createGain();
  dubGain.gain.value = Math.max(0, Math.min(1.5, dubVol / 100));
  dubGain.connect(offlineCtx.destination);

  for (const item of decodedBuffers) {
    if (item) {
      const source = offlineCtx.createBufferSource();
      source.buffer = item.buffer;
      source.connect(dubGain);
      source.start(item.startMs / 1000);
    }
  }

  // Asl video ovozi uchun Gain (ovoz balansi)
  if (origAudioBuffer && origVol > 0) {
    const origGain = offlineCtx.createGain();
    origGain.gain.value = Math.max(0, Math.min(1.5, origVol / 100));
    origGain.connect(offlineCtx.destination);

    const origSource = offlineCtx.createBufferSource();
    origSource.buffer = origAudioBuffer;
    origSource.connect(origGain);
    origSource.start(0);
  }

  const masterBuffer = await offlineCtx.startRendering();

  onProgress?.({
    step: 'encoding',
    percent: 85,
    message: 'MP3 audio fayl formatlanmoqda…',
  });

  const mp3Blob = audioBufferToMp3(masterBuffer);

  onProgress?.({
    step: 'done',
    percent: 100,
    message: 'Audio tayyor!',
  });

  return { mp3Blob, buffer: masterBuffer, totalDuration: totalDurationSec };
}

/** Canvas da video kadrini chizuvchi yordamchi funksiya */
function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsedMs: number,
  totalDurationSec: number,
  cues: Cue[],
  videoTitle: string,
  targetLang: string
) {
  // 1. Fon (Charcoal Dark Matte #28292b gradient)
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#1f2022');
  bgGrad.addColorStop(1, '#28292b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Markaziy video sarlavhasi / logotipi
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(videoTitle.length > 50 ? videoTitle.slice(0, 48) + '…' : videoTitle, width / 2, height / 2 - 40);

  ctx.fillStyle = '#60a5fa';
  ctx.font = '600 19px Inter, sans-serif';
  ctx.fillText(`AutoDub · ${targetLang} tilidagi professional dublyaj`, width / 2, height / 2 + 10);

  // 3. Jonli subtitr
  const currentCue = cues.find(c => elapsedMs >= c.start && elapsedMs <= c.end + 400);
  if (currentCue) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    const boxWidth = Math.min(width - 80, 1000);
    const boxHeight = 70;
    const boxX = (width - boxWidth) / 2;
    const boxY = height - 140;

    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 12);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 23px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(currentCue.text, width / 2, boxY + 44);
    ctx.restore();
  }

  // 4. SUV BELGISI (WATERMARK) — Yuqori o'ng burchakda InnoHub & Usmoxan Design
  ctx.save();
  const wmX = width - 360;
  const wmY = 24;
  const wmWidth = 336;
  const wmHeight = 44;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.beginPath();
  ctx.roundRect(wmX, wmY, wmWidth, wmHeight, 8);
  ctx.fill();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('AutoDub', wmX + 14, wmY + 27);

  ctx.fillStyle = '#93c5fd';
  ctx.font = '500 12px Inter, sans-serif';
  ctx.fillText('• InnoHub & Usmoxan Design', wmX + 78, wmY + 27);
  ctx.restore();

  // Pastki chap burchakda mualliflik belgisi
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Created with AutoDub by InnoHub & Usmoxan Design', 24, height - 20);
  ctx.restore();
}

/**
 * 🚀 TEZKOR MP4 VIDEO EKSPORT (WebCodecs + MP4-Muxer)
 * Asl video audiosi va dublyaj audioini to'liq aralashtirib,
 * suv belgisi bilan toza .mp4 formatda bir necha soniyada eksport qiladi.
 */
export async function exportVideoWithWatermark(
  opts: MasterAudioOptions & { videoTitle?: string }
): Promise<Blob> {
  const { cues, targetLang, videoTitle = 'AutoDub Video', onProgress } = opts;

  const { buffer: audioBuffer, totalDuration } = await generateMasterAudio({
    ...opts,
    onProgress: p => onProgress?.({ ...p, percent: Math.round(p.percent * 0.4) }),
  });

  onProgress?.({
    step: 'rendering',
    percent: 45,
    message: 'Tezkor MP4 render boshlanmoqda…',
  });

  const width = 1280;
  const height = 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // WebCodecs orqali tezkor MP4 generatsiya
  if (typeof (window as any).VideoEncoder !== 'undefined') {
    try {
      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: {
          codec: 'avc',
          width,
          height,
        },
        audio: {
          codec: 'aac',
          numberOfChannels: 2,
          sampleRate: 44100,
        },
        fastStart: 'in-memory',
      });

      const videoEncoder = new (window as any).VideoEncoder({
        output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
        error: (e: any) => console.error('VideoEncoder xatosi:', e),
      });

      await videoEncoder.configure({
        codec: 'avc1.42001f', // H.264 Baseline 3.1
        width,
        height,
        bitrate: 2_500_000,
      });

      const audioEncoder = new (window as any).AudioEncoder({
        output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
        error: (e: any) => console.error('AudioEncoder xatosi:', e),
      });

      await audioEncoder.configure({
        codec: 'mp4a.40.2', // AAC LC
        numberOfChannels: 2,
        sampleRate: 44100,
        bitrate: 128_000,
      });

      // ─── 1. Aralashtirilgan (mixed) audioni kodlash ───
      onProgress?.({ step: 'encoding', percent: 50, message: 'Audio miks kodlanmoqda…' });
      const chunkSize = 1024;
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;

      for (let offset = 0; offset < audioBuffer.length; offset += chunkSize) {
        const frames = Math.min(chunkSize, audioBuffer.length - offset);
        const leftChunk = left.subarray(offset, offset + frames);
        const rightChunk = right.subarray(offset, offset + frames);

        const planarData = new Float32Array(frames * 2);
        planarData.set(leftChunk, 0);
        planarData.set(rightChunk, frames);

        const audioData = new (window as any).AudioData({
          format: 'f32-planar',
          sampleRate: 44100,
          numberOfFrames: frames,
          numberOfChannels: 2,
          timestamp: Math.round((offset / 44100) * 1_000_000),
          data: planarData,
        });

        audioEncoder.encode(audioData);
        audioData.close();
      }
      await audioEncoder.flush();

      // ─── 2. Video kadrlarini tezkor render qilish ───
      const fps = 15;
      const frameDurationUs = Math.round(1_000_000 / fps);
      const totalFrames = Math.ceil(totalDuration * fps);

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        const currentSec = frameIdx / fps;
        const currentMs = currentSec * 1000;

        drawVideoFrame(ctx, width, height, currentMs, totalDuration, cues, videoTitle, targetLang);

        const videoFrame = new (window as any).VideoFrame(canvas, {
          timestamp: frameIdx * frameDurationUs,
          duration: frameDurationUs,
        });

        videoEncoder.encode(videoFrame, { keyFrame: frameIdx % (fps * 2) === 0 });
        videoFrame.close();

        if (frameIdx % 45 === 0) {
          const pct = Math.min(96, Math.round(50 + (frameIdx / totalFrames) * 46));
          onProgress?.({
            step: 'rendering',
            percent: pct,
            message: `Video tezkor yozilmoqda (${Math.round((frameIdx / totalFrames) * 100)}%)…`,
          });
          await new Promise(r => setTimeout(r, 0));
        }
      }

      await videoEncoder.flush();
      muxer.finalize();

      const mp4Blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      onProgress?.({ step: 'done', percent: 100, message: 'MP4 Video tayyor!' });
      return mp4Blob;
    } catch (e) {
      console.warn('WebCodecs xatosi, MediaRecorder ga o\'tmoqda:', e);
    }
  }

  // Fallback: MediaRecorder
  return fallbackMediaRecorderExport(audioBuffer, totalDuration, cues, targetLang, videoTitle, onProgress);
}

/** MediaRecorder fallback funksiyasi */
function fallbackMediaRecorderExport(
  audioBuffer: AudioBuffer,
  totalDuration: number,
  cues: Cue[],
  targetLang: string,
  videoTitle: string,
  onProgress?: (p: ExportProgress) => void
): Promise<Blob> {
  const width = 1280;
  const height = 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const audioCtx = new AudioContext();
  const audioSource = audioCtx.createBufferSource();
  audioSource.buffer = audioBuffer;
  const mediaStreamDest = audioCtx.createMediaStreamDestination();
  audioSource.connect(mediaStreamDest);

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...mediaStreamDest.stream.getAudioTracks(),
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
    ? 'video/mp4;codecs=avc1'
    : 'video/webm';

  const recorder = new MediaRecorder(combinedStream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = e => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      audioCtx.close();
      const finalBlob = new Blob(chunks, { type: mimeType.split(';')[0] });
      onProgress?.({ step: 'done', percent: 100, message: 'Video tayyor!' });
      resolve(finalBlob);
    };
    recorder.onerror = e => {
      audioCtx.close();
      reject(e);
    };

    recorder.start(100);
    audioSource.start(0);
    const startTime = performance.now();

    function loop() {
      const elapsedSec = (performance.now() - startTime) / 1000;
      if (elapsedSec >= totalDuration) {
        recorder.stop();
        return;
      }
      drawVideoFrame(ctx, width, height, elapsedSec * 1000, totalDuration, cues, videoTitle, targetLang);
      requestAnimationFrame(loop);
    }
    loop();
  });
}

/** Faylni brauzerda yuklab berish */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
