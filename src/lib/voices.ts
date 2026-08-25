/** Til va ovoz kataloglari — client va server o'rtasida bo'lishiladi. */

export interface VoicePreset {
  /** UI da ko'rinadigan nom */
  id: string;
  /** Edge TTS ShortName */
  voice: string;
  pitch: string;
  rate: string;
}

export interface LangProfile {
  /** BCP-47 til kodi (tarjima uchun) */
  code: string;
  /** To'liq nomi — Gemini promptida ishlatiladi */
  name: string;
  male: VoicePreset[];
  female: VoicePreset[];
}

/**
 * Edge TTS o'zbek tili uchun ikkita haqiqiy neural ovoz beradi (Sardor / Madina).
 * Qolgan nomlar shu ikkisining pitch va tezlik variantlari — hammasi
 * baribir sof o'zbek talaffuzida gapiradi.
 */
export const LANG_PROFILES: Record<string, LangProfile> = {
  "O'zbekiston": {
    code: 'uz',
    name: "o'zbek (lotin alifbosida)",
    male: [
      { id: 'Sardor', voice: 'uz-UZ-SardorNeural', pitch: '+0Hz', rate: '+0%' },
      { id: 'Jasur', voice: 'uz-UZ-SardorNeural', pitch: '-12Hz', rate: '-3%' },
      { id: 'Nodir', voice: 'uz-UZ-SardorNeural', pitch: '+10Hz', rate: '+4%' },
      { id: 'Bobur', voice: 'uz-UZ-SardorNeural', pitch: '-20Hz', rate: '-6%' },
    ],
    female: [
      { id: 'Madina', voice: 'uz-UZ-MadinaNeural', pitch: '+0Hz', rate: '+0%' },
      { id: 'Nodira', voice: 'uz-UZ-MadinaNeural', pitch: '+12Hz', rate: '+2%' },
      { id: 'Zilola', voice: 'uz-UZ-MadinaNeural', pitch: '-10Hz', rate: '-3%' },
      { id: 'Feruza', voice: 'uz-UZ-MadinaNeural', pitch: '+6Hz', rate: '-4%' },
    ],
  },
  Qozoqiston: {
    code: 'kk', name: 'qozoq',
    male: [{ id: 'Daulet', voice: 'kk-KZ-DauletNeural', pitch: '+0Hz', rate: '+0%' }],
    female: [{ id: 'Aigul', voice: 'kk-KZ-AigulNeural', pitch: '+0Hz', rate: '+0%' }],
  },
  Turkiya: {
    code: 'tr', name: 'turk',
    male: [{ id: 'Ahmet', voice: 'tr-TR-AhmetNeural', pitch: '+0Hz', rate: '+0%' }],
    female: [{ id: 'Emel', voice: 'tr-TR-EmelNeural', pitch: '+0Hz', rate: '+0%' }],
  },
  Rossiya: {
    code: 'ru', name: 'rus',
    male: [{ id: 'Dmitriy', voice: 'ru-RU-DmitryNeural', pitch: '+0Hz', rate: '+0%' }],
    female: [{ id: 'Svetlana', voice: 'ru-RU-SvetlanaNeural', pitch: '+0Hz', rate: '+0%' }],
  },
  Germaniya: {
    code: 'de', name: 'nemis',
    male: [{ id: 'Conrad', voice: 'de-DE-ConradNeural', pitch: '+0Hz', rate: '+0%' }],
    female: [{ id: 'Katja', voice: 'de-DE-KatjaNeural', pitch: '+0Hz', rate: '+0%' }],
  },
  Fransiya: {
    code: 'fr', name: 'fransuz',
    male: [{ id: 'Henri', voice: 'fr-FR-HenriNeural', pitch: '+0Hz', rate: '+0%' }],
    female: [{ id: 'Denise', voice: 'fr-FR-DeniseNeural', pitch: '+0Hz', rate: '+0%' }],
  },
  Ispaniya: {
    code: 'es', name: 'ispan',
    male: [{ id: 'Alvaro', voice: 'es-ES-AlvaroNeural', pitch: '+0Hz', rate: '+0%' }],
    female: [{ id: 'Elvira', voice: 'es-ES-ElviraNeural', pitch: '+0Hz', rate: '+0%' }],
  },
  Xitoy: {
    code: 'zh-CN', name: 'xitoy (soddalashtirilgan)',
    male: [{ id: 'Yunxi', voice: 'zh-CN-YunxiNeural', pitch: '+0Hz', rate: '+0%' }],
    female: [{ id: 'Xiaoxiao', voice: 'zh-CN-XiaoxiaoNeural', pitch: '+0Hz', rate: '+0%' }],
  },
  Yaponiya: {
    code: 'ja', name: 'yapon',
    male: [{ id: 'Keita', voice: 'ja-JP-KeitaNeural', pitch: '+0Hz', rate: '+0%' }],
    female: [{ id: 'Nanami', voice: 'ja-JP-NanamiNeural', pitch: '+0Hz', rate: '+0%' }],
  },
};

export const LANGS = Object.keys(LANG_PROFILES);
export const DEFAULT_LANG = "O'zbekiston";

export function getProfile(lang: string): LangProfile {
  return LANG_PROFILES[lang] ?? LANG_PROFILES[DEFAULT_LANG];
}

export function findPreset(lang: string, presetId: string): VoicePreset {
  const p = getProfile(lang);
  return [...p.male, ...p.female].find(v => v.id === presetId) ?? p.male[0];
}
