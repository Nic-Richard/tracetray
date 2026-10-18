import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/expo";
import * as SecureStore from "expo-secure-store";
import { ApiError, type Account, type Site, type SitesResponse } from "@tracetray/shared";
import { useApi } from "./api";
import { useLoad } from "./useLoad";
import { Failure, Loading } from "../components/Status";
import AccountDeletion from "../components/AccountDeletion";

interface SiteState {
  account: Account;
  site: Site | null;
  selectSite: (key: string) => void;
  updateSites: (result: SitesResponse, preferred?: string) => void;
  closeAccount: () => void;
}
const SiteContext = createContext<SiteState | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { userId } = useAuth();
  const [closing, setClosing] = useState(false);
  const account = useLoad(() => api.account().catch(err => {
    if (err instanceof ApiError && err.body.account_deleting) setClosing(true);
    throw err;
  }), [api]);
  const [selected, setSelected] = useState<string | null>(null);
  const storageKey = `tt.site.${userId}`;
  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(storageKey).then(key => { if (!cancelled) setSelected(key); }).catch(() => {});
    return () => { cancelled = true; };
  }, [storageKey]);
  function selectSite(key: string) {
    if (!account.data?.sites.some(site => site.key === key)) return;
    setSelected(key);
    SecureStore.setItemAsync(storageKey, key).catch(() => {});
  }
  function updateSites(result: SitesResponse, preferred?: string) {
    const current = preferred || selected || account.data?.sites[0]?.key;
    const key = result.sites.find(value => value.key === current)?.key || result.sites[0]?.key || null;
    account.setData(value => value ? { ...value, sites: result.sites, site_limit: result.limit } : value);
    setSelected(key);
    if (key) SecureStore.setItemAsync(storageKey, key).catch(() => {});
  }
  if (closing) return <AccountDeletion requested />;
  if (account.error) return <Failure message={account.error} retry={account.reload} />;
  if (!account.data) return <Loading message="Loading your websites…" />;
  const site = account.data.sites.find(value => value.key === selected) || account.data.sites[0] || null;
  return <SiteContext.Provider value={{ account: account.data, site, selectSite, updateSites, closeAccount: () => setClosing(true) }}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteState {
  const state = useContext(SiteContext);
  if (!state) throw new Error("useSite needs SiteProvider");
  return state;
}
