import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { pageLabel } from "@tracetray/shared";
import { useApi } from "./api";
import { refreshAnalysis } from "./analysisActions";

export function useAnalysisActions(site: string, page: string, reload: () => void) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const context = useRef({ site, page });
  context.current = { site, page };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setStatus(null);
  }, [site, page]);
  async function run(action: "page" | "all" | "clear") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setStatus(null);
    const active = () => mounted.current && context.current.site === site && context.current.page === page;
    try {
      const text =
        action === "clear"
          ? `Cleared ${(await api.resetPage(site, page)).deleted_sessions.toLocaleString()} visits from ${pageLabel(page)}. New visits start a fresh history.`
          : await refreshAnalysis(
              api,
              site,
              page,
              action,
              text => {
                if (active()) setStatus({ text });
              },
              active,
            );
      if (active()) {
        if (text) setStatus({ text });
        reload();
      }
    } catch (error) {
      if (active()) {
        setStatus({ text: error instanceof Error ? error.message : "Couldn't finish. Try again.", error: true });
        reload();
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function more() {
    Alert.alert("Page actions", pageLabel(page), [
      {
        text: "Refresh all pages",
        onPress: () =>
          Alert.alert(
            "Refresh all pages?",
            "Analyze every eligible page on this website using its existing refresh allowance. Keep this screen open until it finishes.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Refresh all pages",
                onPress: () => {
                  run("all");
                },
              },
            ],
          ),
      },
      {
        text: "Clear this page's history",
        style: "destructive",
        onPress: () =>
          Alert.alert(
            "Clear this page's history?",
            `Permanently remove every visit and analysis for ${pageLabel(page)} (${page}). This can't be undone.`,
            [
              { text: "Keep history", style: "cancel" },
              {
                text: "Clear history",
                style: "destructive",
                onPress: () => {
                  run("clear");
                },
              },
            ],
          ),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }
  return { busy, status, refresh: () => run("page"), more };
}
