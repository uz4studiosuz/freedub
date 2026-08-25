/**
 * Microsoft Edge "Read Aloud" neural TTS klienti (server-only).
 *
 * Bepul, kalitsiz ishlaydi va o'zbek tili uchun haqiqiy neural ovozlarni beradi:
 *   uz-UZ-SardorNeural (erkak) / uz-UZ-MadinaNeural (ayol)
 *
 * Ogohlantirish: `Sec-MS-GEC` tokeni Windows FILETIME "tick"laridan hisoblanadi.
 * Bu son 2^53 dan katta, shuning uchun BigInt SHART — oddiy Number aniqlikni
 * yo'qotadi va server 403 qaytaradi.
 */
import crypto from 'node:crypto';
import WebSocket from 'ws';

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_VERSION = '140.0.3485.14';
const WIN_EPOCH_OFFSET = 11644473600; // 1601-01-01 dan 1970-01-01 gacha, sekundda
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

function secMsGec(): string {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH_OFFSET;
  ticks -= ticks % 300; // 5 daqiqalik oynaga yaxlitlanadi
  const filetime = (BigInt(ticks) * BigInt(10_000_000)).toString();
  return crypto
    .createHash('sha256')
    .update(filetime + TRUSTED_TOKEN, 'ascii')
    .digest('hex')
    .toUpperCase();
}

function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SynthesizeOptions {
  text: string;
  /** Edge ShortName, masalan `uz-UZ-SardorNeural` */
  voice: string;
  /** SSML prosody rate, masalan `+8%` */
  rate?: string;
  /** SSML prosody pitch, masalan `-10Hz` */
  pitch?: string;
  /** SSML prosody volume, masalan `+0%` */
  volume?: string;
}

function connectAndSynthesize(opts: SynthesizeOptions): Promise<Buffer> {
  const { text, voice, rate = '+0%', pitch = '+0Hz', volume = '+0%' } = opts;
  const locale = voice.split('-').slice(0, 2).join('-') || 'uz-UZ';

  return new Promise((resolve, reject) => {
    const url =
      'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
      `?TrustedClientToken=${TRUSTED_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec()}` +
      `&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;

    const ws = new WebSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
          `Chrome/${CHROMIUM_VERSION} Safari/537.36 Edg/${CHROMIUM_VERSION}`,
      },
    });

    const chunks: Buffer[] = [];
    let settled = false;
    const requestId = crypto.randomUUID().replace(/-/g, '');

    const finish = (err: Error | null, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* allaqachon yopiq */ }
      if (err) reject(err); else resolve(buf!);
    };

    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* ignore */ }
      finish(new Error('Edge TTS: vaqt tugadi'));
    }, 30_000);

    ws.on('open', () => {
      ws.send(
        `X-Timestamp:${new Date().toString()}\r\n` +
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                outputFormat: OUTPUT_FORMAT,
              },
            },
          },
        })
      );

      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'>` +
        `<voice name='${voice}'>` +
        `<prosody rate='${rate}' pitch='${pitch}' volume='${volume}'>${escapeSsml(text)}</prosody>` +
        `</voice></speak>`;

      ws.send(
        `X-RequestId:${requestId}\r\n` +
        'Content-Type:application/ssml+xml\r\n' +
        `X-Timestamp:${new Date().toString()}Z\r\n` +
        'Path:ssml\r\n\r\n' +
        ssml
      );
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        if (data.toString('utf8').includes('Path:turn.end')) {
          finish(null, Buffer.concat(chunks));
        }
        return;
      }
      // Binar freym: [2 bayt header uzunligi][header][mp3 bo'lagi]
      const buf = Buffer.from(data);
      if (buf.length < 2) return;
      chunks.push(buf.subarray(2 + buf.readUInt16BE(0)));
    });

    ws.on('error', (e: Error) => finish(new Error('Edge TTS: ' + e.message)));

    ws.on('close', () => {
      if (chunks.length) finish(null, Buffer.concat(chunks));
      else finish(new Error('Edge TTS: ulanish audiosiz uzildi'));
    });
  });
}

/** Matnni mp3 ga aylantiradi. Vaqtinchalik uzilishlarda qayta uriniladi. */
export async function synthesize(opts: SynthesizeOptions, attempts = 3): Promise<Buffer> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const buf = await connectAndSynthesize(opts);
      if (buf.length > 0) return buf;
      lastError = new Error('Edge TTS: bo\'sh audio');
    } catch (e) {
      lastError = e;
    }
    await new Promise(r => setTimeout(r, 300 * (i + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
