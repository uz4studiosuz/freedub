/**
 * AI provayderlari orqali kontekstga sezgir dublyaj tarjimasi.
 *
 * Barcha provayderlar bir xil promptni oladi va bir xil JSON shaklini qaytaradi:
 *   [{ "i": <cue id>, "t": "<tarjima>" }, …]
 */

import type { Cue } from '../transcript';

const BATCH = 14;         // bir so'rovdagi cue soni
const CONTEXT_LINES = 4;  // oldingi/keyingi kontekst qatorlari
const CONCURRENCY = 5;
const TIMEOUT_MS = 90_000;

export interface AiOptions {
  provider: string;
  /** Foydalanuvchi kaliti; bo'lmasa server muhitidan olinadi */
  apiKey?: string;
  /** Maqsad tilning to'liq nomi (promptga tushadi) */
  langName: string;
}

// ─── Prompt ────────────────────────────────────────────

function buildPrompt(langName: string, batch: Cue[], before: Cue[], after: Cue[]): string {
  const ctx = (label: string, arr: Cue[]) =>
    arr.length ? `\n${label}:\n${arr.map(c => `- ${c.original}`).join('\n')}` : '';

  return `Sen professional video dublyaj tarjimonisan. YouTube videosining avtomatik taglavhalarini ${langName} tiliga tarjima qilyapsan.

TALABLAR:
1. Har bir raqamlangan qatorni alohida tarjima qil va AYNAN o'sha raqam bilan qaytar. Qatorlarni birlashtirma, tashlab ketma.
2. So'zma-so'z emas — MA'NOSINI ber. Tabiiy, jonli, og'zaki nutq bo'lsin, xuddi tajribali diktor gapirayotgandek.
3. Tinish belgilarini o'zing qo'y (avto-taglavhalarda ular yo'q). Bu ovoz ohangi to'g'ri chiqishi uchun zarur.
4. Uzunlik originalga yaqin bo'lsin — bu dublyaj, matn video vaqtiga sig'ishi kerak. Ortiqcha izoh yoki tushuntirish qo'shma.
5. Atamalar, brend nomlari va qisqartmalarni tarjima qilma, o'z holicha qoldir.
6. Raqamlarni so'z bilan yozma, raqamda qoldir.
7. Faqat lotin alifbosidan foydalan (agar maqsad tili shuni talab qilsa).

JAVOB FORMATI — faqat JSON massiv, boshqa hech narsa yozma:
[{"i": <qator raqami>, "t": "<tarjima>"}]
${ctx('OLDINGI KONTEKST (tarjima QILMA, faqat tushunish uchun)', before)}${ctx('KEYINGI KONTEKST (tarjima QILMA, faqat tushunish uchun)', after)}

TARJIMA QILINADIGAN QATORLAR:
${batch.map(c => `${c.id}. ${c.original}`).join('\n')}`;
}

// ─── Provayder adapterlari ─────────────────────────────

interface Adapter {
  envKey: string;
  modelEnv: string;
  defaultModel: string;
  call: (prompt: string, key: string, model: string) => Promise<string>;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    // Kalitni xato matniga tushirmaslik uchun faqat provayder javobini uzatamiz
    throw new Error(`${res.status}: ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Provayder JSON bo\'lmagan javob qaytardi');
  }
}

/** OpenAI `chat/completions` shakliga mos provayderlar (OpenAI, Groq, OpenRouter, DeepSeek). */
function openAiCompatible(baseUrl: string, extraHeaders: Record<string, string> = {}) {
  return async (prompt: string, key: string, model: string): Promise<string> => {
    const json = (await post(
      `${baseUrl}/chat/completions`,
      { Authorization: `Bearer ${key}`, ...extraHeaders },
      {
        model,
        temperature: 0.25,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }
    )) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  };
}

const ADAPTERS: Record<string, Adapter> = {
  gemini: {
    envKey: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-3.6-flash',
    call: async (prompt, key, model) => {
      const json = (await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {},
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.25,
            topP: 0.9,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { i: { type: 'INTEGER' }, t: { type: 'STRING' } },
                required: ['i', 't'],
              },
            },
          },
        }
      )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
    },
  },

  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-haiku-4-5-20251001',
    call: async (prompt, key, model) => {
      const json = (await post(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        {
          model,
          max_tokens: 8192,
          temperature: 0.25,
          messages: [{ role: 'user', content: prompt }],
        }
      )) as { content?: Array<{ text?: string }> };
      return json.content?.map(c => c.text ?? '').join('') ?? '';
    },
  },

  openai: {
    envKey: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-4o-mini',
    call: openAiCompatible('https://api.openai.com/v1'),
  },

  groq: {
    envKey: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    call: openAiCompatible('https://api.groq.com/openai/v1'),
  },

  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    defaultModel: 'openai/gpt-4o-mini',
    call: openAiCompatible('https://openrouter.ai/api/v1', { 'X-Title': 'AutoDub' }),
  },

  deepseek: {
    envKey: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultModel: 'deepseek-chat',
    call: openAiCompatible('https://api.deepseek.com/v1'),
  },
};

export function isAiProvider(id: string): boolean {
  return id in ADAPTERS;
}

/** Serverda shu provayder uchun kalit sozlanganmi. */
export function hasServerKey(id: string): boolean {
  const a = ADAPTERS[id];
  return !!a && !!process.env[a.envKey];
}

// ─── Javobni tahlil qilish ─────────────────────────────

/** Model matnni ```json bloki ichida yoki izoh bilan qaytarsa ham massivni ajratadi. */
function parseItems(raw: string): Array<{ i: number; t: string }> {
  let text = raw.trim();
  if (!text) return [];

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const tryParse = (s: string): unknown => {
    try { return JSON.parse(s); } catch { return null; }
  };

  let parsed = tryParse(text);
  if (!parsed) {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end > start) parsed = tryParse(text.slice(start, end + 1));
  }
  if (!parsed) return [];

  // `response_format: json_object` ba'zi modellarni massivni obyektga o'rashga majbur qiladi
  if (!Array.isArray(parsed) && typeof parsed === 'object') {
    const values = Object.values(parsed as Record<string, unknown>);
    const arr = values.find(v => Array.isArray(v));
    if (arr) parsed = arr;
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map(row => {
      const r = row as Record<string, unknown>;
      return { i: Number(r.i ?? r.id ?? r.index), t: String(r.t ?? r.text ?? r.translation ?? '') };
    })
    .filter(r => Number.isFinite(r.i) && r.t.trim().length > 0);
}

// ─── Asosiy kirish nuqtasi ─────────────────────────────

export async function translateWithAi(
  cues: Cue[],
  opts: AiOptions,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const adapter = ADAPTERS[opts.provider];
  if (!adapter) throw new Error(`Noma'lum AI provayderi: ${opts.provider}`);

  const key = opts.apiKey?.trim() || process.env[adapter.envKey] || '';
  if (!key) {
    throw new Error(
      `${opts.provider} uchun API kalit yo'q. Sozlamalarda o'z kalitingizni kiriting ` +
      `yoki serverda ${adapter.envKey} ni sozlang.`
    );
  }
  const model = process.env[adapter.modelEnv] || adapter.defaultModel;

  const batches: Cue[][] = [];
  for (let i = 0; i < cues.length; i += BATCH) batches.push(cues.slice(i, i + BATCH));

  let cursor = 0;
  let done = 0;
  let translated = 0;
  let firstError: string | undefined;

  const runBatch = async (batch: Cue[]) => {
    const first = batch[0].id;
    const last = batch[batch.length - 1].id;
    const prompt = buildPrompt(
      opts.langName,
      batch,
      cues.slice(Math.max(0, first - CONTEXT_LINES), first),
      cues.slice(last + 1, last + 1 + CONTEXT_LINES)
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const items = parseItems(await adapter.call(prompt, key, model));
        if (items.length) {
          const byId = new Map(batch.map(c => [c.id, c]));
          for (const item of items) {
            const cue = byId.get(item.i);
            if (cue) { cue.text = item.t.trim(); translated++; }
          }
          return;
        }
        if (!firstError) firstError = 'Model tushunarli javob qaytarmadi';
      } catch (e) {
        if (!firstError) firstError = (e as Error).message;
        // Kalit/kvota xatolarida qayta urinish befoyda
        if (/^(401|403|429)/.test((e as Error).message)) return;
      }
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
    while (cursor < batches.length) {
      await runBatch(batches[cursor++]);
      onProgress?.(++done, batches.length);
    }
  });
  await Promise.all(workers);

  if (translated === 0) {
    throw new Error(firstError ?? 'AI provayderi tarjima qaytarmadi');
  }
}
