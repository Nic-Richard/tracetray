import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "@clerk/expo";
import Constants from "expo-constants";
import { createApi, type Api } from "@tracetray/shared";
import { resolveApiUrl } from "./connection";

export function apiOrigin(): string {
  return resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, Constants.expoConfig?.hostUri, __DEV__);
}

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const api = useMemo(() => createApi({ baseUrl: apiOrigin(), getToken: () => getToken() }), [getToken]);
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi needs ApiProvider");
  return api;
}
