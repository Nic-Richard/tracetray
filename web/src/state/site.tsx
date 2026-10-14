import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { Account, Mode, PageSummary, Site } from "@tracetray/shared";
import { useApi } from "../api";
import { readStorage, writeStorage } from "../lib/storage";

interface SiteState {
  mode: Mode;
  account: Account;
  sites: Site[];
  site: Site;
  siteKey: string;
  setSite: (key: string) => void;
  setSites: (sites: Site[]) => void;
  pages: PageSummary[] | null;
  pagesError: string;
  reloadPages: () => void;
  /** Selected page or group; null until pages load or when the site has none. */
  page: string | null;
  setPage: (page: string) => void;
  pins: string[];
  togglePin: (page: string) => void;
}

const SiteContext = createContext<SiteState | null>(null);
const pinKey = (siteKey: string) => `tt-pins:${siteKey}`;

export function SiteProvider({ account, mode, children }: { account: Account; mode: Mode; children: ReactNode }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const [sites, setSites] = useState<Site[]>(account.sites);
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [pagesError, setPagesError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);

  const requestedSite = params.get("site");
  const site = sites.find(s => s.key === requestedSite) || sites.find(s => s.key === readStorage("tt-site")) || sites[0];
  const siteKey = site.key;
  const [pins, setPins] = useState<string[]>([]);

  useEffect(() => {
    try { setPins(JSON.parse(readStorage(pinKey(siteKey)) || "[]")); } catch { setPins([]); }
  }, [siteKey]);

  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setPagesError("");
    api.pages(siteKey)
      .then(list => { if (!cancelled) setPages(list); })
      .catch(err => { if (!cancelled) { setPages([]); setPagesError(err.message); } });
    return () => { cancelled = true; };
  }, [api, siteKey, reloadCount]);

  const requestedPage = params.get("page");
  const page = useMemo(() => {
    if (!pages?.length) return null;
    if (requestedPage && pages.some(p => p.page === requestedPage)) return requestedPage;
    const pinned = pins.find(pin => pages.some(p => p.page === pin));
    return pinned || pages[0].page;
  }, [pages, requestedPage, pins]);

  const setSite = useCallback((key: string) => {
    writeStorage("tt-site", key);
    setParams(prev => { const next = new URLSearchParams(prev); next.set("site", key); next.delete("page"); return next; });
  }, [setParams]);

  const setPage = useCallback((value: string) => {
    setParams(prev => { const next = new URLSearchParams(prev); next.set("site", siteKey); next.set("page", value); return next; });
  }, [setParams, siteKey]);

  const togglePin = useCallback((value: string) => {
    setPins(current => {
      const next = current.includes(value) ? current.filter(p => p !== value) : [...current, value];
      writeStorage(pinKey(siteKey), JSON.stringify(next));
      return next;
    });
  }, [siteKey]);

  const reloadPages = useCallback(() => setReloadCount(n => n + 1), []);

  const value: SiteState = {
    mode, account, sites, site, siteKey, setSite, setSites,
    pages, pagesError, reloadPages,
    page, setPage, pins, togglePin
  };
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteState {
  const state = useContext(SiteContext);
  if (!state) throw new Error("useSite needs SiteProvider");
  return state;
}
