/**
 * Tarjima provayderlari reyestri — client va server o'rtasida bo'lishiladi.
 *
 * `free` — kalitsiz, bepul va shundayligicha qoladi.
 * `ai`   — kontekstni tushunadigan modellar. Sifati ancha yuqori, lekin kredit
 *          yeydi; `premium: true` bo'lganlari keyinchalik pullik bo'ladi.
 *          Foydalanuvchi o'z API kalitini kiritsa, server kalitidan
 *          foydalanilmaydi va cheklov qo'yilmaydi.
 */

export type ProviderKind = 'free' | 'ai';

export interface ProviderMeta {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Qo'shni qatorlarni hisobga olib tarjima qiladimi */
  contextAware: boolean;
  /** Keyinchalik pullik bo'ladi (hozircha bepul) */
  premium: boolean;
  /** Kalitni qaerdan olish mumkin */
  keyUrl?: string;
  keyPlaceholder?: string;
  /** Model nomini o'zgartirish uchun muhit o'zgaruvchisi */
  modelEnv?: string;
  note?: string;
}

export const PROVIDERS: ProviderMeta[] = [
  // ─── Bepul, kalitsiz ───────────────────────────────
  {
    id: 'google',
    label: 'Google Tarjima',
    kind: 'free',
    contextAware: false,
    premium: false,
    note: 'Kalit shart emas. Har bir gap alohida tarjima qilinadi.',
  },
  {
    id: 'simplytranslate',
    label: 'SimplyTranslate (Google proksi)',
    kind: 'free',
    contextAware: false,
    premium: false,
    note: 'Google Tarjima ishlamasa zaxira variant.',
  },
  {
    id: 'mymemory',
    label: 'MyMemory',
    kind: 'free',
    contextAware: false,
    premium: false,
    note: 'Kunlik bepul limiti bor.',
  },

  // ─── AI modellar ───────────────────────────────────
  {
    id: 'gemini',
    label: 'Gemini (Google AI)',
    kind: 'ai',
    contextAware: true,
    premium: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza… yoki AQ.…',
    modelEnv: 'GEMINI_MODEL',
    note: 'Eng aniq tarjima. Hozircha bepul.',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    kind: 'ai',
    contextAware: true,
    premium: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    modelEnv: 'OPENAI_MODEL',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'ai',
    contextAware: true,
    premium: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    modelEnv: 'ANTHROPIC_MODEL',
  },
  {
    id: 'groq',
    label: 'Groq (Llama)',
    kind: 'ai',
    contextAware: true,
    premium: true,
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_…',
    modelEnv: 'GROQ_MODEL',
    note: 'Juda tez, saxiy bepul limit.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'ai',
    contextAware: true,
    premium: true,
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-…',
    modelEnv: 'OPENROUTER_MODEL',
    note: 'Bitta kalit bilan ko\'plab modellar.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'ai',
    contextAware: true,
    premium: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-…',
    modelEnv: 'DEEPSEEK_MODEL',
  },
];

export const DEFAULT_PROVIDER = 'google';

export function getProviderMeta(id: string): ProviderMeta {
  return PROVIDERS.find(p => p.id === id) ?? PROVIDERS.find(p => p.id === DEFAULT_PROVIDER)!;
}

/** Client `/api/providers` dan oladigan ko'rinish. */
export interface ProviderStatus extends ProviderMeta {
  /** Serverda kalit sozlanganmi (foydalanuvchi kalit kiritmasa ham ishlaydi) */
  hasServerKey: boolean;
  /** Foydalanuvchi kalit kiritishi shartmi */
  keyRequired: boolean;
}
