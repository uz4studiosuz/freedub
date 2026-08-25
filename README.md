# AutoDub — YouTube avtomatik dublyaj

YouTube videosining taglavhalarini olib, tanlangan xizmat bilan tarjima qiladi va
Microsoft neural TTS ovozi bilan video vaqtiga sinxron o'qib beradi.

## Ishga tushirish

```bash
npm install
npm run dev
```

`.env.local` — kalitlar ixtiyoriy. Bittasi ham bo'lmasa bepul tarjima
xizmatlari (Google Tarjima, SimplyTranslate, MyMemory) baribir ishlaydi.

```
# AI provayderlar (ixtiyoriy — foydalanuvchi o'z kalitini UI dan ham kirita oladi)
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
DEEPSEEK_API_KEY=...

# Model nomlarini almashtirish (ixtiyoriy)
GEMINI_MODEL=gemini-3.6-flash
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
GROQ_MODEL=llama-3.3-70b-versatile
OPENROUTER_MODEL=openai/gpt-4o-mini
DEEPSEEK_MODEL=deepseek-chat
```

## Tarjima provayderlari

| Provayder | Turi | Kalit | Kontekst | Izoh |
|---|---|---|---|---|
| Google Tarjima | bepul | shart emas | yo'q | Tez (~3 s), so'zma-so'zroq |
| SimplyTranslate | bepul | shart emas | yo'q | Google ga proksi, zaxira |
| MyMemory | bepul | shart emas | yo'q | Kunlik limiti bor |
| Gemini | AI | server yoki o'zingiz | bor | Eng aniq (~15 s) |
| OpenAI, Anthropic, Groq, OpenRouter, DeepSeek | AI | o'zingiz | bor | BYOK |

Serverda kalit bo'lmagan AI provayder UI da «kalit kerak» deb belgilanadi.
Foydalanuvchi kiritgan kalit faqat brauzerning `localStorage` ida saqlanadi va
har so'rovda serverga uzatilib, o'sha provayderga yo'naltiriladi — yozib
qo'yilmaydi.

Yangi provayder qo'shish: `src/lib/providers.ts` ga metama'lumot, so'ng
`src/lib/translate/ai.ts` dagi `ADAPTERS` ga (yoki bepul bo'lsa
`src/lib/translate/plain.ts` dagi `ENGINES` ga) adapter qo'shiladi.

## Qanday ishlaydi

| Bosqich | Fayl | Izoh |
|---|---|---|
| Taglavha treklari | `src/lib/captions.ts` | Watch sahifasidan `captionTracks` o'qiladi — manba tilini tanlash uchun. 10 daqiqalik kesh bilan. |
| Cue lar | `src/lib/transcript.ts` | Avto-taglavhalarning 2-4 so'zli bo'laklari ~5-12 soniyalik gap bo'laklariga birlashtiriladi. Ohang va tarjima aniqligi shunga bog'liq. |
| Tarjima | `src/lib/translate/` | AI provayderlar partiyani kontekst bilan tarjima qiladi; bepul xizmatlar har cue ni alohida (8 parallel). |
| Ovoz | `src/lib/edge-tts.ts` | Edge "Read Aloud" neural TTS — `uz-UZ-SardorNeural` / `uz-UZ-MadinaNeural`. Bepul, kalitsiz. |
| Sinxron | `src/lib/dub-engine.ts` | Har 100 ms da pleyer vaqti o'qiladi va audio pozitsiyasi shunga qarab to'g'rilanadi. |
| Pleyer | `src/components/VideoPlayer.tsx` | Plyr (YouTube provayderi). Vaqt va holat Plyr ostidagi `embed` — YT API obyektidan o'qiladi. |

Ovoz nomlari (`Sardor`, `Jasur`, `Nodir`, `Bobur` va h.k.) `src/lib/voices.ts` da —
Edge o'zbek tili uchun ikkita haqiqiy ovoz beradi, qolganlari shu ikkisining
pitch/tezlik variantlari.

### Sinxronlik qanday ushlab turiladi

Dvigatel ovozni oldindan «rejalashtirmaydi» — har tikda video vaqtidan klip
ichidagi kerakli pozitsiyani hisoblaydi:

```
expected = (videoTime - cue.start) * fitRate
```

`fitRate` — klipni cue oynasiga sig'dirish koeffitsienti (1.0–1.5). Agar matn
oynadan uzun bo'lsa, avval TTS ning o'zi tezroq gapirtiriladi (`speed` parametri),
qolgani `playbackRate` bilan to'g'rilanadi. Farq 0.32 s dan oshsa audio pozitsiyasi
majburan tenglashtiriladi — shuning uchun pauza, seek va tezlik o'zgarishida ham
ovoz videodan ajralib qolmaydi.

Muhim tafsilot: holat Plyr ning `playing` xossasidan emas, YouTube ning
`getPlayerState()` idan o'qiladi — Plyr buferlash paytida ham `playing: true`
qaytaradi, bu esa ovozni videodan ajratib qo'yardi.

## Matnni yuklab olish

«Matn» yorlig'ida SRT, VTT, TXT va ikki tilli matn tugmalari bor. «Original»
belgisi qo'yilsa tarjima o'rniga asl matn eksport qilinadi.

## Cheklovlar

- Video YouTube taglavhalariga ega bo'lishi kerak (avtomatik taglavhalar ham bo'ladi).
- Manba va maqsad tili bir xil bo'lsa tarjima o'tkazib yuboriladi, matn shundayligicha o'qiladi.
- Klip ovozlari brauzer xotirasida; server tomonda oddiy LRU kesh (400 ta klip) bor.
