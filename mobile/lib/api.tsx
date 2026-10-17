import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
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
  // Clerk's Expo hook returns a new token callback each render.
  const token = useRef(getToken);
  token.current = getToken;
  const api = useMemo(() => createApi({ baseUrl: apiOrigin(), getToken: () => token.current() }), []);
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi needs ApiProvider");
  return api;
}
