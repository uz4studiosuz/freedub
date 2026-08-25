/**
 * Audio (MP3/WAV) va Video (MP4/WebM) eksport moduli.
 * Brauzerning OfflineAudioContext va Canvas + MediaRecorder texnologiyasi orqali
 * to'liq sinxronlangan dublyaj audio va suv belgili (watermark) videoni eksport qiladi.
 *
 * Ishlab chiquvchi: InnoHub & Usmoxan Design
 */

import type { Cue } from './transcript';

export interface ExportProgress {
  step: 'fetching' | 'rendering' | 'encoding' | 'done';
  percent: number;
  message: string;
}

/** AudioBuffer ni WAV formatidagi Blob ga aylantirish */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const length = buffer.length * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(wavBuffer);

  /* RIFF chunk descriptor */
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');

  /* FMT sub-chunk */
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  /* data sub-chunk */
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  /* Write interleaved samples */
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = channels[channel][i];
      // Clamp between -1 and 1
      sample = Math.max(-1, Math.min(1, sample));
      // Scale to 16-bit signed integer
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Barcha cue lar uchun TTS audiolarni yig'ib, OfflineAudioContext orqali
 * to'liq sinxronlangan bitta audio trek (WAV/MP3) hosil qiladi.
 */
export async function generateMasterAudio(
  cues: Cue[],
  targetLang: string,
  voiceId: string,
  onProgress?: (p: ExportProgress) => void
): Promise<{ blob: Blob; buffer: AudioBuffer; totalDuration: number }> {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const totalCues = cues.length;
  if (!totalCues) throw new Error('Dublyaj matni mavjud emas');

  onProgress?.({
    step: 'fetching',
    percent: 10,
    message: 'TTS ovoz fayllari tayyorlanmoqda (0/' + totalCues + ')…',
  });

  const decodedBuffers: { startMs: number; buffer: AudioBuffer }[] = [];
  let lastEndMs = 0;

  for (let i = 0; i < totalCues; i++) {
    const cue = cues[i];
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

    decodedBuffers.push({ startMs: cue.start, buffer: audioBuffer });
    const endMs = cue.start + audioBuffer.duration * 1000;
    if (endMs > lastEndMs) lastEndMs = endMs;

    onProgress?.({
      step: 'fetching',
      percent: Math.round(10 + (i / totalCues) * 50),
      message: `TTS ovoz fayllari tayyorlanmoqda (${i + 1}/${totalCues})…`,
    });
  }

  const totalDurationSec = Math.max(1, (lastEndMs + 1000) / 1000);
  const sampleRate = 44100;

  onProgress?.({
    step: 'rendering',
    percent: 65,
    message: 'Audio treklar sinxronlashtirilmoqda…',
  });

  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDurationSec), sampleRate);

  for (const item of decodedBuffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = item.buffer;
    source.connect(offlineCtx.destination);
    source.start(item.startMs / 1000);
  }

  const masterBuffer = await offlineCtx.startRendering();

  onProgress?.({
    step: 'encoding',
    percent: 90,
    message: 'Audio fayl formatlanmoqda…',
  });

  const wavBlob = audioBufferToWav(masterBuffer);

  onProgress?.({
    step: 'done',
    percent: 100,
    message: 'Tayyor!',
  });

  return { blob: wavBlob, buffer: masterBuffer, totalDuration: totalDurationSec };
}

/**
 * Suv belgili (Watermark) MP4/WebM video eksport qiluvchi yordamchi funksiya.
 * Canvas da zamonaviy fon, subtitr va burchagida "InnoHub & Usmoxan Design" suv belgisini chizadi.
 */
export async function exportVideoWithWatermark(
  cues: Cue[],
  targetLang: string,
  voiceId: string,
  videoTitle = 'AutoDub Video',
  onProgress?: (p: ExportProgress) => void
): Promise<Blob> {
  const { buffer: audioBuffer, totalDuration } = await generateMasterAudio(
    cues,
    targetLang,
    voiceId,
    p => onProgress?.({ ...p, percent: Math.round(p.percent * 0.4) })
  );

  onProgress?.({
    step: 'rendering',
    percent: 45,
    message: 'Video va suv belgisi render qilinmoqda…',
  });

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
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 3_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = e => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      audioCtx.close();
      const finalBlob = new Blob(chunks, { type: mimeType.split(';')[0] });
      onProgress?.({ step: 'done', percent: 100, message: 'Video eksport tayyor!' });
      resolve(finalBlob);
    };

    recorder.onerror = e => {
      audioCtx.close();
      reject(e);
    };

    recorder.start(100);
    audioSource.start(0);

    const startTime = performance.now();

    function renderFrame() {
      const elapsedSec = (performance.now() - startTime) / 1000;
      if (elapsedSec >= totalDuration) {
        recorder.stop();
        return;
      }

      const elapsedMs = elapsedSec * 1000;
      const progressPercent = Math.min(98, Math.round(45 + (elapsedSec / totalDuration) * 50));
      onProgress?.({
        step: 'rendering',
        percent: progressPercent,
        message: `Video yozilmoqda (${Math.floor(elapsedSec)}s / ${Math.floor(totalDuration)}s)…`,
      });

      // ─── 1. Fon gradienti ───
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, '#0f172a');
      bgGrad.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // ─── 2. Markaziy video sarlavhasi / logotipi ───
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(videoTitle.length > 50 ? videoTitle.slice(0, 48) + '…' : videoTitle, width / 2, height / 2 - 40);

      ctx.fillStyle = '#60a5fa';
      ctx.font = '600 20px Inter, sans-serif';
      ctx.fillText(`AutoDub · ${targetLang} tilidagi professional dublyaj`, width / 2, height / 2 + 10);

      // ─── 3. Jonli subtitr ───
      const currentCue = cues.find(c => elapsedMs >= c.start && elapsedMs <= c.end + 400);
      if (currentCue) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        const boxWidth = Math.min(width - 80, 1000);
        const boxHeight = 70;
        const boxX = (width - boxWidth) / 2;
        const boxY = height - 140;

        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 12);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(currentCue.text, width / 2, boxY + 44);
        ctx.restore();
      }

      // ─── 4. SUV BELGISI (WATERMARK) ───
      // Yuqori o'ng burchakda InnoHub & Usmoxan Design belgisi
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

      // Pastki chap burchakda qo'shimcha kichik mualliflik belgisi
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Created with AutoDub by InnoHub & Usmoxan Design', 24, height - 20);
      ctx.restore();

      requestAnimationFrame(renderFrame);
    }

    renderFrame();
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
