import { useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { pageLabel } from "@tracetray/shared";
import { useApi } from "../../lib/api";
import { useSite } from "../../lib/site";
import { useLoad } from "../../lib/useLoad";
import { useTheme } from "../../lib/theme";
import { pictureDataUrl } from "../../lib/pageShot";
import { Failure, Loading } from "../../components/Status";
import SharedSurface from "../../components/SharedSurface";
import source from "../../generated/attention.json";

export default function AttentionScreen() {
  const params = useLocalSearchParams<{ page?: string | string[]; site?: string | string[] }>();
  const page = typeof params.page === "string" ? params.page : "";
  const site = typeof params.site === "string" ? params.site : "";
  const { account } = useSite();
  const api = useApi();
  const { styles } = useTheme();
  const owned = account.sites.some(value => value.key === site);
  const result = useLoad(async () => {
    if (!owned || !page) throw new Error("Choose a page from one of your websites.");
    const [data, stats] = await Promise.all([api.attention(site, page), api.stats(site, page)]);
    const loadPicture = async (device: "desktop" | "mobile") => {
      const info = data.shots?.[device];
      if (!info) return { src: null, failed: false };
      try {
        const { blob } = await api.pageShot(site, page, device, info.taken_at);
        return { src: await pictureDataUrl(blob), failed: false };
      } catch { return { src: null, failed: true }; }
    };
    const [desktop, phone] = await Promise.all([loadPicture("desktop"), loadPicture("mobile")]);
    return { surface: { data, result: stats.last_analysis, desktopShot: desktop.src, phoneShot: phone.src }, pictureFailed: desktop.failed || phone.failed };
  }, [api, owned, site, page]);
  if (result.error) return <Failure message={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  return <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
    <View style={{ padding: 20, gap: 8 }}>
      <View style={styles.row}><Text style={[styles.heading, { flex: 1 }]}>{pageLabel(page)}</Text><Pressable accessibilityRole="button" onPress={result.reload} style={{ padding: 12 }}><Text style={styles.link}>Refresh</Text></Pressable></View>
      {result.data.pictureFailed ? <Text style={styles.muted}>A page picture couldn't load. The measurements are still available; refresh to try again.</Text> : null}
    </View>
    <SharedSurface source={source} data={result.data.surface} scroll />
  </SafeAreaView>;
}
