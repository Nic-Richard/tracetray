import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import WebView from "react-native-webview";
import { useTheme } from "../lib/theme";

export default function SharedSurface({ source, data, scroll = false }: { source: { html: string }; data: object; scroll?: boolean }) {
  const { styles, dark } = useTheme();
  // WebView's default generic intersects its props with undefined under TypeScript 6.
  const view = useRef<WebView<Record<never, never>>>(null);
  const ready = useRef(false);
  const props = useRef({ ...data, dark });
  props.current = { ...data, dark };
  const [height, setHeight] = useState(1200);
  const [error, setError] = useState(false);
  function render() {
    const data = JSON.stringify(props.current).replace(/</g, "\\u003c");
    view.current?.injectJavaScript(`window.tracetrayRender(${data});true;`);
  }
  useEffect(() => { if (ready.current) render(); }, [data, dark]);
  if (error) return <Text style={styles.error}>Could not display this view. Reopen this page to try again.</Text>;
  return <View style={scroll ? { flex: 1 } : { height }}>
    <WebView<Record<never, never>> ref={view} source={source} originWhitelist={["*"]}
      style={{ backgroundColor: "transparent" }} scrollEnabled={scroll}
      javaScriptEnabled allowFileAccess={false} allowUniversalAccessFromFileURLs={false}
      domStorageEnabled={false} thirdPartyCookiesEnabled={false} sharedCookiesEnabled={false} geolocationEnabled={false}
      mixedContentMode="never" setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={request => request.url === "about:blank"}
      onLoadStart={() => { ready.current = false; }}
      onLoadEnd={() => { if (!ready.current) { ready.current = true; render(); } }}
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
