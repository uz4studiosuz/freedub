"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  IconBrandYoutube,
  IconSettings,
  IconUserCircle,
  IconCrown,
  IconSearch,
  IconArrowRight,
  IconGenderMale,
  IconGenderFemale,
  IconMicrophone,
  IconPlayerPlay,
  IconVolume,
  IconVolume2,
  IconSubtitles,
  IconVideoPlus,
  IconLoader2,
  IconPlayerStop,
  IconX,
  IconKey,
  IconEye,
  IconEyeOff,
  IconCheck,
  IconFileDownload,
  IconLanguage,
  IconMusic,
  IconMovie,
  IconSun,
  IconMoon,
} from '@tabler/icons-react';
import s from './page.module.css';
import type { Cue } from '@/lib/transcript';
import { DubEngine } from '@/lib/dub-engine';
import { LANGS, DEFAULT_LANG, getProfile } from '@/lib/voices';
import { DEFAULT_PROVIDER, type ProviderStatus } from '@/lib/providers';
import { build as buildSubs, toBilingualTxt, MIME, type SubFormat } from '@/lib/subtitles';
import { generateMasterAudio, exportVideoWithWatermark, triggerDownload } from '@/lib/export';
import Landing from '@/components/Landing';
import VideoPlayer, { type PlayerHandle } from '@/components/VideoPlayer';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface Track {
  id: string;
  languageCode: string;
  label: string;
  kind: 'asr' | 'manual';
}

interface SourceInfo {
  trackId: string;
  languageCode: string;
  label: string;
  translated: boolean;
}

const LS_PROVIDER = 'autodub.provider';
const LS_KEYS = 'autodub.apiKeys';
const LS_LANG = 'autodub.targetLang';

function fmtTime(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(url) ? url : null);
}

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── Main Page ───────────────────────────────────
export default function Home() {
  // ─ URL / player
  const [urlInput, setUrlInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [landingError, setLandingError] = useState('');
  const playerRef = useRef<PlayerHandle | null>(null);

  // ─ Til
  const [targetLang, setTargetLang] = useState(DEFAULT_LANG);
  const [sourceLang, setSourceLang] = useState('auto');
  const [tracks, setTracks] = useState<Track[]>([]);

  // ─ Tarjima provayderi
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState(false);

  // ─ Ovoz
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [voiceName, setVoiceName] = useState('Sardor');
  const [origVol, setOrigVol] = useState(20);
  const [dubVol, setDubVol] = useState(100);
  const [showSubs, setShowSubs] = useState(true);
  const [activeTab, setActiveTab] = useState<'settings' | 'transcript'>('settings');

  // ─ Dublyaj holati
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [cues, setCues] = useState<Cue[]>([]);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [isDubbing, setIsDubbing] = useState(false);
  const [currentSub, setCurrentSub] = useState('');
  const [activeSegIdx, setActiveSegIdx] = useState(-1);
  const [voiceReady, setVoiceReady] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);

  // ─ Eksport holati (MP3 / MP4)
  const [isExporting, setIsExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [exportPct, setExportPct] = useState(0);

  // ─ Mavzu (Dark / Light mode)
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const saved = localStorage.getItem('autodub.theme') as 'light' | 'dark' | null;
    const pref = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(pref);
    document.documentElement.setAttribute('data-theme', pref);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('autodub.theme', next);
  };

  const engineRef = useRef<DubEngine | null>(null);

  const voices = getProfile(targetLang);
  const voiceList = gender === 'male' ? voices.male : voices.female;
  // Til yoki jins o'zgarganda tanlangan ovoz ro'yxatda qolmasligi mumkin.
  const activeVoice = voiceList.some(v => v.id === voiceName) ? voiceName : voiceList[0].id;

  const providerMeta = providers.find(p => p.id === provider);
  const needsKey = !!providerMeta?.keyRequired;
  const currentKey = apiKeys[provider] ?? '';
  const freeProviders = providers.filter(p => p.kind === 'free');
  const aiProviders = providers.filter(p => p.kind === 'ai');

  // ─── Saqlangan sozlamalar ─────────────────────
  // localStorage tashqi manba: uni render paytida o'qib bo'lmaydi (serverda yo'q,
  // hidratsiya mos kelmasligiga olib keladi), shuning uchun holatni mount dan
  // keyin bir marta shu yerda to'ldiramiz.
  useEffect(() => {
    try {
      const savedKeys = localStorage.getItem(LS_KEYS);
      const savedProvider = localStorage.getItem(LS_PROVIDER);
      const savedLang = localStorage.getItem(LS_LANG);
      /* eslint-disable react-hooks/set-state-in-effect */
      if (savedKeys) setApiKeys(JSON.parse(savedKeys));
      if (savedProvider) setProvider(savedProvider);
      if (savedLang && LANGS.includes(savedLang)) setTargetLang(savedLang);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch { /* localStorage yopiq bo'lsa e'tibor bermaymiz */ }
  }, []);

  useEffect(() => {
    fetch('/api/providers')
      .then(r => r.json())
      .then(d => setProviders(d.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  const saveKey = (value: string) => {
    const next = { ...apiKeys, [provider]: value };
    setApiKeys(next);
    try { localStorage.setItem(LS_KEYS, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const changeProvider = (id: string) => {
    setProvider(id);
    setShowKey(false);
    try { localStorage.setItem(LS_PROVIDER, id); } catch { /* ignore */ }
  };

  const changeTargetLang = (lang: string) => {
    setTargetLang(lang);
    try { localStorage.setItem(LS_LANG, lang); } catch { /* ignore */ }
  };

  // ─── Dublyaj dvigateli ────────────────────────
  useEffect(() => {
    const engine = new DubEngine(
      {
        getTime: () => playerRef.current?.getTime() ?? 0,
        getRate: () => playerRef.current?.getRate() ?? 1,
        isPlaying: () => playerRef.current?.isPlaying() ?? false,
      },
      {
        onCueChange: (idx, cue) => {
          setActiveSegIdx(idx);
          setCurrentSub(cue ? cue.text : '');
        },
        onReadyCount: ready => setVoiceReady(ready),
        onError: msg => setErrorMsg(msg),
      }
    );
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handlePlayerReady = useCallback((handle: PlayerHandle) => {
    playerRef.current = handle;
  }, []);

  // ─── Sozlamalarni dvigatelga uzatish ─────────
  useEffect(() => { engineRef.current?.setVolume(dubVol); }, [dubVol]);
  useEffect(() => { engineRef.current?.setVoice(targetLang, activeVoice); }, [targetLang, activeVoice]);

  // ─── Video almashganda taglavha tillarini olish ──
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    fetch(`/api/tracks?videoId=${encodeURIComponent(videoId)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.success) setTracks(d.tracks ?? []); })
      .catch(() => { /* ro'yxat bo'lmasa `auto` bilan davom etamiz */ });
    return () => { cancelled = true; };
  }, [videoId]);

  // ─── Video yuklash ───────────────────────────
  const loadVideo = (raw: string) => {
    const vid = extractVideoId(raw.trim());
    if (!vid) {
      setLandingError("Havola yaroqsiz. YouTube havolasini yoki 11 belgili video ID sini kiriting.");
      return;
    }
    setLandingError('');
    engineRef.current?.stop();
    setIsDubbing(false);
    setUrlInput(raw.trim());
    setVideoId(vid);
    setStatus('idle');
    setCues([]);
    setSourceInfo(null);
    setSourceLang('auto');
    setTracks([]);
    setVoiceReady(0);
    setCurrentSub('');
    setErrorMsg('');
    setProgress(0);
    setActiveTab('settings');
  };

  // ─── Transkript + tarjima + ovoz ─────────────
  const handleDub = async () => {
    if (!videoId) return;
    const engine = engineRef.current;
    if (!engine) return;

    if (needsKey && !currentKey.trim()) {
      setErrorMsg(`${providerMeta?.label} uchun API kalit kerak. Uni pastdagi maydonga kiriting yoki bepul xizmatni tanlang.`);
      return;
    }

    // Brauzer avtoijro siyosati: ovozni aynan shu bosish paytida ochib qo'yamiz
    await engine.unlock();

    engine.stop();
    setIsDubbing(false);
    setStatus('loading');
    setProgress(8);
    setProgressLabel('Taglavhalar olinmoqda…');
    setErrorMsg('');
    setCues([]);
    setSourceInfo(null);
    setVoiceReady(0);

    const bump = setInterval(() => setProgress(p => (p < 70 ? p + 2 : p)), 500);

    try {
      setProgressLabel(`${providerMeta?.label ?? 'Tarjimon'} tarjima qilmoqda…`);
      const res = await fetch('/api/dub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          targetLang,
          sourceLang,
          provider,
          apiKey: currentKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      clearInterval(bump);

      if (!res.ok || !data.success) {
        setStatus('error');
        setErrorMsg(data.error ?? "Noma'lum xatolik");
        setProgress(0);
        return;
      }

      const loaded: Cue[] = data.cues;
      setCues(loaded);
      setSourceInfo(data.source ?? null);
      setProgress(80);
      setProgressLabel('Ovoz tayyorlanmoqda…');

      engine.setCues(loaded);
      engine.setVoice(targetLang, activeVoice);
      engine.setVolume(dubVol);
      await engine.warmup(4);

      setProgress(100);
      setStatus('ready');
      setActiveTab('transcript');
      engine.start();
      setIsDubbing(true);
      playerRef.current?.play();
    } catch (e) {
      clearInterval(bump);
      setStatus('error');
      setProgress(0);
      setErrorMsg("Server bilan bog'lanishda xatolik: " + String((e as Error)?.message ?? e));
    }
  };

  const stopDubbing = () => {
    engineRef.current?.stop();
    setIsDubbing(false);
    setCurrentSub('');
    setActiveSegIdx(-1);
  };

  const restartDubbing = async () => {
    const engine = engineRef.current;
    if (!engine || !cues.length) return;
    await engine.unlock();
    engine.setVoice(targetLang, activeVoice);
    engine.setVolume(dubVol);
    engine.start();
    setIsDubbing(true);
  };

  // ─── Matnni yuklab olish ─────────────────────
  const exportSubs = (format: SubFormat) => {
    if (!cues.length) return;
    const which = showOriginal ? 'original' : 'translated';
    const suffix = showOriginal ? 'original' : getProfile(targetLang).code;
    download(
      `autodub-${videoId}-${suffix}.${format}`,
      buildSubs(cues, format, which),
      MIME[format]
    );
  };

  const exportBilingual = () => {
    if (!cues.length) return;
    download(`autodub-${videoId}-2tilli.txt`, toBilingualTxt(cues), MIME.txt);
  };

  const exportMp3 = async () => {
    if (!cues.length) return;
    try {
      setIsExporting(true);
      setExportMsg('MP3 audio trek tayyorlanmoqda…');
      const { blob } = await generateMasterAudio(cues, targetLang, activeVoice, p => {
        setExportMsg(p.message);
        setExportPct(p.percent);
      });
      triggerDownload(blob, `autodub-${videoId}-${getProfile(targetLang).code}-dublyaj.wav`);
    } catch (err: any) {
      alert('Audio eksport xatosi: ' + (err?.message || err));
    } finally {
      setIsExporting(false);
      setExportMsg('');
      setExportPct(0);
    }
  };

  const exportMp4 = async () => {
    if (!cues.length) return;
    try {
      setIsExporting(true);
      setExportMsg('MP4 video suv belgisi bilan render qilinmoqda…');
      const blob = await exportVideoWithWatermark(
        cues,
        targetLang,
        activeVoice,
        `AutoDub · ${targetLang}`,
        p => {
          setExportMsg(p.message);
          setExportPct(p.percent);
        }
      );
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      triggerDownload(blob, `autodub-${videoId}-${getProfile(targetLang).code}-watermarked.${ext}`);
    } catch (err: any) {
      alert('Video eksport xatosi: ' + (err?.message || err));
    } finally {
      setIsExporting(false);
      setExportMsg('');
      setExportPct(0);
    }
  };

  // ─── Landing ─────────────────────────────────
  if (!videoId) {
    return <Landing onStart={loadVideo} error={landingError} />;
  }

  // ─── Status pill ─────────────────────────────
  const statusInfo = {
    idle:    { label: 'Tayyor',          cls: s.statusIdle },
    loading: { label: 'Yuklanmoqda…',    cls: s.statusLoading },
    ready:   { label: 'Dublyaj tayyor',  cls: s.statusReady },
    error:   { label: 'Xatolik',         cls: s.statusError },
  }[status];

  return (
    <div className={s.root}>
      {/* ── NAV ── */}
      <nav className={s.nav}>
        <button className={s.logo} onClick={() => setVideoId(null)} title="Bosh sahifa">
          <IconBrandYoutube size={24} />
          AutoDub
          <span className={s.navBadge}>BEPUL</span>
          <span className={s.byTag}>by InnoHub &amp; Usmoxan Design</span>
        </button>
        <div className={s.navRight}>
          <button
            className={s.navBtn}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Yorug\' rejim' : 'Qorong\'i rejim'}
          >
            {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>
          <button className={s.navBtn}><IconCrown size={18} /></button>
          <button className={s.navBtn}><IconSettings size={18} /></button>
          <button className={s.navBtn}><IconUserCircle size={18} /></button>
        </div>
      </nav>

      {/* ── URL BAR ── */}
      <div className={s.urlBar}>
        <div className={s.urlForm}>
          <div className={s.urlInputWrap}>
            <IconSearch size={16} />
            <input
              className={s.urlInput}
              placeholder="YouTube havolasini yoki video ID sini kiriting…"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadVideo(urlInput)}
            />
            {urlInput && (
              <button onClick={() => setUrlInput('')} style={{ color: 'var(--c-text-3)' }}>
                <IconX size={14} />
              </button>
            )}
          </div>
          <button className={s.urlBtnLoad} onClick={() => loadVideo(urlInput)}>
            <IconBrandYoutube size={16} />
            Yuklash
          </button>
        </div>
      </div>

      {/* ── MAIN ── */}
      <main className={s.main}>
        {/* ── Player Side ── */}
        <div className={s.playerSide}>
          <div className={s.playerWrap}>
            <div className={s.plyrHost}>
              <VideoPlayer
                videoId={videoId}
                originalVolume={origVol}
                onReady={handlePlayerReady}
              />
            </div>
            <div className={s.playerWatermark}>
              AutoDub <span>• InnoHub &amp; Usmoxan Design</span>
            </div>
            {showSubs && currentSub && (
              <div className={s.subtitleOverlay}>{currentSub}</div>
            )}
          </div>

          {/* Controls */}
          <div className={s.controls}>
            <IconVolume2 size={16} color="var(--c-text-2)" />
            <div className={s.volGroup}>
              <span className={s.volLabel}>Asl ovoz: {origVol}%</span>
              <input
                type="range" min={0} max={100}
                value={origVol}
                onChange={e => setOrigVol(+e.target.value)}
                className={s.volSlider}
              />
            </div>

            <div className={s.ctrlSep} />

            <IconVolume size={16} color="var(--c-accent)" />
            <div className={s.volGroup}>
              <span className={s.volLabel}>Dublyaj: {dubVol}%</span>
              <input
                type="range" min={0} max={100}
                value={dubVol}
                onChange={e => setDubVol(+e.target.value)}
                className={s.volSlider}
              />
            </div>

            <div className={s.ctrlSep} />

            <button
              className={`${s.ctrlBtn} ${showSubs ? s.ctrlBtnActive : ''}`}
              onClick={() => setShowSubs(v => !v)}
              title="Taglavhalar"
            >
              <IconSubtitles size={17} />
            </button>

            <div className={s.ctrlSep2} />

            <div className={`${s.statusPill} ${statusInfo.cls}`}>
              <div className={`${s.statusDot} ${status === 'loading' ? s.dotPulse : ''}`} />
              <span>
                {statusInfo.label}
                {status === 'ready' && cues.length > 0 && ` · ${voiceReady}/${cues.length}`}
              </span>
            </div>
          </div>
        </div>

        {/* ── Right Panel ── */}
        <div className={s.panel}>
          <div className={s.panelHeader}>
            <div className={s.panelTitle}>
              <IconMicrophone size={15} />
              Sozlamalar
            </div>
          </div>

          <div className={s.tabs}>
            <button
              className={`${s.tab} ${activeTab === 'settings' ? s.tabActive : ''}`}
              onClick={() => setActiveTab('settings')}
            >Sozlamalar</button>
            <button
              className={`${s.tab} ${activeTab === 'transcript' ? s.tabActive : ''}`}
              onClick={() => setActiveTab('transcript')}
            >Matn {cues.length > 0 && `(${cues.length})`}</button>
          </div>

          {activeTab === 'settings' && (
            <div className={s.panelBody}>
              {/* Til */}
              <div className={s.fieldGroup}>
                <div className={s.fieldLabel}>Til</div>
                <div className={s.langRow}>
                  <select
                    className={s.select}
                    value={sourceLang}
                    onChange={e => setSourceLang(e.target.value)}
                  >
                    <option value="auto">Avtomatik aniqlash</option>
                    {tracks.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.label}{t.kind === 'asr' ? ' · avto' : ''}
                      </option>
                    ))}
                  </select>
                  <IconArrowRight size={16} className={s.langArrow} />
                  <select
                    className={s.select}
                    value={targetLang}
                    onChange={e => changeTargetLang(e.target.value)}
                  >
                    {LANGS.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                {tracks.length > 0 && (
                  <div className={s.providerNote}>
                    Bu videoda {tracks.length} ta taglavha tili mavjud.
                  </div>
                )}
              </div>

              {/* Tarjima xizmati */}
              <div className={s.fieldGroup}>
                <div className={s.fieldLabel}>Tarjima xizmati</div>
                <select
                  className={s.select}
                  value={provider}
                  onChange={e => changeProvider(e.target.value)}
                >
                  <optgroup label="Bepul (kalit shart emas)">
                    {freeProviders.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </optgroup>
                  <optgroup label="AI modellar (aniqroq tarjima)">
                    {aiProviders.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.label}{p.keyRequired ? ' — kalit kerak' : ''}
                      </option>
                    ))}
                  </optgroup>
                </select>

                {providerMeta && (
                  <>
                    <div className={s.tagRow}>
                      {providerMeta.kind === 'free' && <span className={`${s.tag} ${s.tagFree}`}>Bepul</span>}
                      {providerMeta.kind === 'ai' && providerMeta.hasServerKey && (
                        <span className={`${s.tag} ${s.tagPremium}`}>Hozircha bepul</span>
                      )}
                      {providerMeta.keyRequired && <span className={`${s.tag} ${s.tagKey}`}>Kalit kerak</span>}
                      {providerMeta.contextAware && <span className={`${s.tag} ${s.tagPremium}`}>Kontekstli</span>}
                    </div>
                    {providerMeta.note && <div className={s.providerNote}>{providerMeta.note}</div>}
                  </>
                )}

                {/* O'z API kaliti */}
                {providerMeta?.kind === 'ai' && (
                  <div className={s.keyBlock}>
                    <div className={s.keyInputWrap}>
                      <IconKey size={14} />
                      <input
                        className={s.keyInput}
                        type={showKey ? 'text' : 'password'}
                        placeholder={providerMeta.keyPlaceholder ?? 'API kalit'}
                        value={currentKey}
                        onChange={e => saveKey(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        className={s.keyToggle}
                        onClick={() => setShowKey(v => !v)}
                        title={showKey ? 'Yashirish' : 'Ko\'rsatish'}
                        type="button"
                      >
                        {showKey ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                      </button>
                    </div>
                    {currentKey ? (
                      <span className={s.keySaved}>
                        <IconCheck size={12} /> Kalit brauzeringizda saqlandi
                      </span>
                    ) : (
                      <span className={s.keyHint}>
                        {providerMeta.hasServerKey
                          ? 'Bo\'sh qoldirsangiz umumiy kalit ishlatiladi.'
                          : 'Kalitni kiritmasangiz bu model ishlamaydi.'}
                        {providerMeta.keyUrl && (
                          <> <a href={providerMeta.keyUrl} target="_blank" rel="noreferrer">Kalit olish</a></>
                        )}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Ovoz */}
              <div className={s.fieldGroup}>
                <div className={s.fieldLabel}>Ovoz — Microsoft neural TTS</div>
                <div className={s.voiceRow}>
                  <button
                    className={`${s.genderBtn} ${gender === 'male' ? s.genderMale : s.genderFemale}`}
                    onClick={() => setGender(g => (g === 'male' ? 'female' : 'male'))}
                    title="Jins"
                  >
                    {gender === 'male' ? <IconGenderMale size={17} /> : <IconGenderFemale size={17} />}
                  </button>
                  <select
                    className={s.select}
                    value={activeVoice}
                    onChange={e => setVoiceName(e.target.value)}
                  >
                    {voiceList.map(v => <option key={v.id} value={v.id}>{v.id}</option>)}
                  </select>
                </div>
              </div>

              {/* Ovoz balansi */}
              <div className={s.fieldGroup}>
                <div className={s.fieldLabel}>Ovoz balansi</div>
                <div className={s.sliderRow}>
                  <div className={s.sliderItem}>
                    <span className={s.sliderItemLabel}>Asl ovoz</span>
                    <input type="range" min={0} max={100} value={origVol}
                      onChange={e => setOrigVol(+e.target.value)} className={s.sliderField} />
                    <span className={s.sliderVal}>{origVol}</span>
                  </div>
                  <div className={s.sliderItem}>
                    <span className={s.sliderItemLabel}>Dublyaj</span>
                    <input type="range" min={0} max={100} value={dubVol}
                      onChange={e => setDubVol(+e.target.value)} className={s.sliderField} />
                    <span className={s.sliderVal}>{dubVol}</span>
                  </div>
                </div>
              </div>

              {/* Qo'shimcha */}
              <div className={s.fieldGroup}>
                <div className={s.fieldLabel}>Qo&apos;shimcha</div>
                <div className={s.toggleRows}>
                  <div className={s.toggleRow}>
                    <span className={s.toggleRowLabel}>Taglavhalar ko&apos;rsatish</span>
                    <label className={s.toggle}>
                      <input type="checkbox" checked={showSubs} onChange={e => setShowSubs(e.target.checked)} />
                      <span className={s.toggleTrack} />
                    </label>
                  </div>
                </div>
              </div>

              {errorMsg && <div className={s.errorBox}>⚠ {errorMsg}</div>}
            </div>
          )}

          {activeTab === 'transcript' && (
            <>
              {sourceInfo && (
                <div className={s.sourceInfo}>
                  <IconLanguage size={14} />
                  {sourceInfo.label}
                  {sourceInfo.translated
                    ? ` → ${targetLang} · ${providerMeta?.label ?? provider}`
                    : ' · tarjima kerak emas'}
                </div>
              )}

              {isExporting && (
                <div className={s.exportBanner}>
                  <div className={s.exportText}>
                    <IconLoader2 size={13} className={s.spin} />
                    {exportMsg} ({exportPct}%)
                  </div>
                  <div className={s.exportProgressWrap}>
                    <div className={s.exportProgressBar} style={{ width: `${exportPct}%` }} />
                  </div>
                </div>
              )}

              {cues.length > 0 && (
                <div className={s.dlBar}>
                  <span className={s.dlLabel}>
                    <IconFileDownload size={12} style={{ verticalAlign: '-2px' }} /> Yuklab olish:
                  </span>
                  <button
                    className={`${s.dlBtn} ${s.dlBtnPrimary}`}
                    onClick={exportMp3}
                    disabled={isExporting}
                    title="To'liq dublyaj audio trekini (WAV/MP3) yuklab olish"
                  >
                    <IconMusic size={12} /> MP3 (Audio)
                  </button>
                  <button
                    className={`${s.dlBtn} ${s.dlBtnPrimary}`}
                    onClick={exportMp4}
                    disabled={isExporting}
                    title="Suv belgili (Watermark) videoni yuklab olish"
                  >
                    <IconMovie size={12} /> MP4 (Video)
                  </button>
                  <button className={s.dlBtn} onClick={() => exportSubs('srt')}>SRT</button>
                  <button className={s.dlBtn} onClick={() => exportSubs('vtt')}>VTT</button>
                  <button className={s.dlBtn} onClick={() => exportSubs('txt')}>TXT</button>
                  <button className={s.dlBtn} onClick={exportBilingual}>2 tilli</button>
                  <label className={s.dlToggle}>
                    <input
                      type="checkbox"
                      checked={showOriginal}
                      onChange={e => setShowOriginal(e.target.checked)}
                    />
                    Original
                  </label>
                </div>
              )}

              <div className={s.transcriptPanel}>
                {cues.length === 0 ? (
                  <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--c-text-3)', fontSize: 13 }}>
                    Dublyaj qilish uchun «Dublyaj boshlash» tugmasini bosing
                  </div>
                ) : (
                  cues.map((cue, idx) => (
                    <div
                      key={cue.id}
                      className={`${s.transcriptItem} ${activeSegIdx === idx ? s.transcriptItemActive : ''}`}
                      onClick={() => playerRef.current?.seek(cue.start / 1000)}
                    >
                      <span className={s.transcriptTime}>{fmtTime(cue.start)}</span>
                      <span className={s.transcriptText}>
                        {cue.text}
                        {showOriginal && cue.original !== cue.text && (
                          <span className={s.transcriptOrig}>{cue.original}</span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* Footer */}
          <div className={s.panelFooter}>
            {status === 'loading' && (
              <>
                <div className={s.progressWrap}>
                  <div className={s.progressBar} style={{ width: `${progress}%` }} />
                </div>
                <div className={s.progressLabel}>{progressLabel}</div>
              </>
            )}

            {isDubbing && (
              <button className={s.btnStop} onClick={stopDubbing}>
                <IconPlayerStop size={16} />
                Dublyajni to&apos;xtatish
              </button>
            )}

            {status === 'ready' && !isDubbing && (
              <button className={s.btnDub} onClick={restartDubbing}>
                <IconPlayerPlay size={16} />
                Dublyajni qayta boshlash
              </button>
            )}

            <button
              className={s.btnDub}
              onClick={handleDub}
              disabled={status === 'loading'}
            >
              {status === 'loading'
                ? <><IconLoader2 size={16} className={s.spin} /> Yuklanmoqda…</>
                : <><IconMicrophone size={16} /> Dublyaj boshlash</>}
            </button>

            <button className={s.btnLocal}>
              <IconVideoPlus size={15} />
              Mahalliy video
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
