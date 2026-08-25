'use client';

import { useState, useEffect } from 'react';
import {
  IconBrandYoutube,
  IconSparkles,
  IconMicrophone,
  IconWaveSine,
  IconFileDownload,
  IconArrowRight,
  IconDeviceTv,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import s from './Landing.module.css';

interface Props {
  /** Yaroqli havola kiritilganda chaqiriladi */
  onStart: (url: string) => void;
  /** Havola yaroqsiz bo'lsa ko'rsatiladigan xabar */
  error?: string;
}

const DEMO_URL = 'https://www.youtube.com/watch?v=P26AE7NLx4Q';

export default function Landing({ onStart, error }: Props) {
  const [url, setUrl] = useState('');
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

  const submit = () => {
    const value = url.trim();
    if (value) onStart(value);
  };

  return (
    <div className={s.root}>
      <nav className={s.nav}>
        <div className={s.logo}>
          <IconBrandYoutube size={22} />
          AutoDub
          <span className={s.badge}>BEPUL</span>
          <span className={s.byTag}>by InnoHub &amp; Usmoxan Design</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className={s.demoBtn}
            onClick={() => onStart(DEMO_URL)}
          >
            <IconDeviceTv size={15} />
            Namuna videoni ochish
          </button>
          <button
            className={s.themeBtn}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Yorug\' rejim' : 'Qorong\'i rejim'}
          >
            {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>
        </div>
      </nav>

      <main className={s.main}>
        <div className={s.hero}>
          <span className={s.pill}>
            <IconSparkles size={13} />
            InnoHub &amp; Usmoxan Design · O&apos;zbek neural ovozli dublyaj
          </span>
          <h1 className={s.title}>
            YouTube videosini <em>o&apos;zbekcha</em> eshiting
          </h1>
          <p className={s.subtitle}>
            Havolani qo&apos;ying — taglavhalar olinadi, tarjima qilinadi va video
            vaqtiga sinxron holda tabiiy o&apos;zbek ovozida o&apos;qib beriladi.
            Tayyor MP4 va MP3 formatda eksport qiling!
          </p>
        </div>

        <div className={s.form}>
          <div className={s.inputWrap}>
            <IconBrandYoutube size={17} />
            <input
              className={s.input}
              placeholder="https://www.youtube.com/watch?v=P26AE7NLx4Q"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              autoFocus
            />
          </div>
          <button className={s.cta} onClick={submit}>
            Boshlash
            <IconArrowRight size={16} />
          </button>
        </div>

        <div className={s.hint}>
          {error
            ? <span style={{ color: 'var(--c-error)' }}>{error}</span>
            : (
              <>
                Sinab ko&apos;rish uchun{' '}
                <button onClick={() => onStart(DEMO_URL)}>
                  tayyor namunani oching (P26AE7NLx4Q)
                </button>
              </>
            )}
        </div>

        <div className={s.features}>
          <div className={s.card}>
            <span className={s.cardIcon}><IconMicrophone size={17} /></span>
            <span className={s.cardTitle}>Haqiqiy o&apos;zbek ovozi</span>
            <span className={s.cardText}>
              Microsoft neural TTS — robot emas, jonli ohang. Erkak va ayol ovozlari,
              tezlik va balandlik variantlari bilan.
            </span>
          </div>
          <div className={s.card}>
            <span className={s.cardIcon}><IconWaveSine size={17} /></span>
            <span className={s.cardTitle}>Kadr bilan sinxron</span>
            <span className={s.cardText}>
              Ovoz video vaqtiga bog&apos;lanadi. Pauza, orqaga qaytish yoki tezlikni
              o&apos;zgartirsangiz ham ajralib qolmaydi.
            </span>
          </div>
          <div className={s.card}>
            <span className={s.cardIcon}><IconFileDownload size={17} /></span>
            <span className={s.cardTitle}>MP4, MP3 va Subtitrlar</span>
            <span className={s.cardText}>
              Dublyaj qilingan audioni (MP3), suv belgili videoni (MP4) yoki
              SRT/VTT subtitrlarni bir zumda yuklab oling.
            </span>
          </div>
        </div>

        <div className={s.steps}>
          <span className={s.step}><span className={s.stepNum}>1</span> Havolani qo&apos;ying</span>
          <span className={s.stepSep}>—</span>
          <span className={s.step}><span className={s.stepNum}>2</span> Tilni va ovozni tanlang</span>
          <span className={s.stepSep}>—</span>
          <span className={s.step}><span className={s.stepNum}>3</span> Dublyajni boshlang va eksport qiling</span>
        </div>
      </main>

      <footer className={s.footer}>
        InnoHub &amp; Usmoxan Design tomonidan ishlab chiqilgan · Bepul tarjima va AI modellar
      </footer>
    </div>
  );
}
