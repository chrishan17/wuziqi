"use client";

// English by default, Chinese on request. The choice lives in localStorage and
// on <html data-lang>, which is what the CSS keys the font sets off: English
// gets a retro print face (IM Fell English + EB Garamond), Chinese keeps the
// brush + Song pairing.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "zh";
const KEY = "wuziqi-lang";

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "en",
  setLang: () => {},
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "zh" || saved === "en") setLangState(saved);
    } catch {
      // storage can be blocked; English stands
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
    document.documentElement.dataset.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // ignore
    }
  };

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

/** Pick a string (or node) for the current language. */
export function useT() {
  const { lang } = useLang();
  return <A,>(en: A, zh: A): A => (lang === "zh" ? zh : en);
}

/** Inline bilingual text, usable from server components. */
export function L({ en, zh }: { en: ReactNode; zh: ReactNode }) {
  const { lang } = useLang();
  return <>{lang === "zh" ? zh : en}</>;
}

/** The EN / 中文 switch. */
export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <button
      type="button"
      className={className ?? "lang-switch"}
      onClick={() => setLang(lang === "zh" ? "en" : "zh")}
      aria-label={lang === "zh" ? "Switch to English" : "切换到中文"}
    >
      {lang === "zh" ? "EN" : "中文"}
    </button>
  );
}
