import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import WebView from "react-native-webview";
import type { GoalTrend, Timeseries, UxTrends } from "@tracetray/shared";
import { useTheme } from "../lib/theme";
import source from "../generated/trends.json";

export default function TrendSurface({ trends, goal, visits }: { trends: UxTrends; goal: GoalTrend; visits: Timeseries }) {
  const { styles, dark } = useTheme();
  // WebView's default generic intersects its props with undefined under TypeScript 6.
  const view = useRef<WebView<Record<never, never>>>(null);
  const ready = useRef(false);
  const props = useRef({ trends, goal, visits, dark });
  props.current = { trends, goal, visits, dark };
  const [height, setHeight] = useState(1200);
  const [error, setError] = useState(false);
  function render() {
    const data = JSON.stringify(props.current).replace(/</g, "\\u003c");
    view.current?.injectJavaScript(`window.tracetrayRender(${data});true;`);
  }
  useEffect(() => { if (ready.current) render(); }, [trends, goal, visits, dark]);
  if (error) return <Text style={styles.error}>Could not display the charts. Reopen this page to try again.</Text>;
  return <View style={{ height }}>
    <WebView<Record<never, never>> ref={view} source={source} originWhitelist={["*"]}
      style={{ backgroundColor: "transparent" }} scrollEnabled={false}
      javaScriptEnabled allowFileAccess={false} allowUniversalAccessFromFileURLs={false}
      domStorageEnabled={false} thirdPartyCookiesEnabled={false} sharedCookiesEnabled={false} geolocationEnabled={false}
      mixedContentMode="never" setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={request => request.url === "about:blank"}
      onLoadStart={() => { ready.current = false; }}
      onLoadEnd={() => { ready.current = true; render(); }}
      onError={() => setError(true)}
      onContentProcessDidTerminate={() => { ready.current = false; view.current?.reload(); }}
      onRenderProcessGone={() => setError(true)}
      onMessage={event => {
        try {
          const message = JSON.parse(event.nativeEvent.data);
          if (message.type === "ready") { ready.current = true; render(); }
          else if (message.type === "height" && Number.isFinite(message.value) && message.value > 0 && message.value < 10000) setHeight(Math.ceil(message.value));
          else if (message.type === "error") setError(true);
        } catch { setError(true); }
      }} />
  </View>;
}
