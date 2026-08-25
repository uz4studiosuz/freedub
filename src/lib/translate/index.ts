/** Tarjima provayderlarini bir joyga yig'uvchi dispetcher. */

import type { Cue } from '../transcript';
import { isAiProvider, translateWithAi, hasServerKey } from './ai';
import { isPlainProvider, translatePlain } from './plain';
import { PROVIDERS, DEFAULT_PROVIDER, type ProviderStatus } from '../providers';

export { hasServerKey };

export interface TranslateOptions {
  provider: string;
  /** Maqsad tilning BCP-47 kodi (bepul provayderlar uchun) */
  targetCode: string;
  /** Maqsad tilning to'liq nomi (AI promptlari uchun) */
  targetName: string;
  /** Manba tili yoki `auto` */
  sourceCode: string;
  /** Foydalanuvchining o'z API kaliti (ixtiyoriy) */
  apiKey?: string;
}

export interface TranslateResult {
  /** Bepul provayder aniqlagan manba tili, bilsa */
  detected?: string;
}

/** Cue larni joyida tarjima qiladi. */
export async function translateCues(
  cues: Cue[],
  opts: TranslateOptions,
  onProgress?: (done: number, total: number) => void
): Promise<TranslateResult> {
  if (isAiProvider(opts.provider)) {
    await translateWithAi(
      cues,
      { provider: opts.provider, apiKey: opts.apiKey, langName: opts.targetName },
      onProgress
    );
    return {};
  }
  if (isPlainProvider(opts.provider)) {
    return translatePlain(cues, opts.provider, opts.targetCode, opts.sourceCode, onProgress);
  }
  throw new Error(`Noma'lum tarjima provayderi: ${opts.provider}`);
}

/** Client uchun provayder ro'yxati — qaysilari kalitsiz ishlaydi. */
export function listProviderStatus(): ProviderStatus[] {
  return PROVIDERS.map(p => {
    const serverKey = p.kind === 'ai' ? hasServerKey(p.id) : true;
    return { ...p, hasServerKey: serverKey, keyRequired: p.kind === 'ai' && !serverKey };
  });
}

export { DEFAULT_PROVIDER };
