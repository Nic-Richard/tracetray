import { useEffect, useState } from "react";
import type { PageShotInfo } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";

export function usePageShot(page: string, device: "desktop" | "mobile", info: PageShotInfo | undefined): string | null {
  const api = useApi();
  const { siteKey } = useSite();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!info) { setUrl(null); return; }
    setUrl(null);
    let objectUrl: string | null = null, cancelled = false;
    api.pageShot(siteKey, page, device, String(info.taken_at)).then(({ blob }) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, siteKey, page, device, info?.taken_at]);
  return url;
}

