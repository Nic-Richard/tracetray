import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";

export type AppearancePreference = "system" | "light" | "dark";
const AppearanceContext = createContext<{ preference: AppearancePreference; setPreference: (value: AppearancePreference) => Promise<void> } | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preference, update] = useState<AppearancePreference>("system");
  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync("tt.appearance").then(value => {
      if (active && (value === "light" || value === "dark")) update(value);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const setPreference = useCallback(async (value: AppearancePreference) => {
    await SecureStore.setItemAsync("tt.appearance", value);
    update(value);
  }, []);
  return <AppearanceContext.Provider value={{ preference, setPreference }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const state = useContext(AppearanceContext);
  if (!state) throw new Error("useAppearance needs AppearanceProvider");
  return state;
}
