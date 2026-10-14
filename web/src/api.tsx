import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { createApi, type Api } from "@tracetray/shared";

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const api = useMemo(() => createApi({ getToken: () => getToken() }), [getToken]);
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi needs ApiProvider");
  return api;
}
