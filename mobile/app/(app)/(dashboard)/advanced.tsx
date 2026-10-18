import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { pageLabel } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";
import { Failure, Loading } from "../../../components/Status";
import SharedSurface from "../../../components/SharedSurface";
import source from "../../../generated/advanced.json";

export default function AdvancedScreen() {
  const params = useLocalSearchParams<{ site?: string; page?: string }>();
  const { account } = useSite();
  const { styles } = useTheme();
  const api = useApi();
  const site = account.sites.find(value => value.key === params.site);
  const page = typeof params.page === "string" ? params.page : "";
  const result = useLoad(() => {
    if (!site || !page) throw new Error("Choose a page from one of your websites.");
    return api.stats(site.key, page);
  }, [api, site?.key, page]);
  if (result.error) return <Failure message={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  return <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
    <View style={{ padding: 20, gap: 6 }}><Text style={styles.heading}>{pageLabel(page)}</Text><Text style={styles.muted}>Swipe tables sideways to compare visitor groups.</Text></View>
    {result.data.last_analysis ? <SharedSurface source={source} data={{ result: result.data.last_analysis }} scroll /> : <View style={styles.content}><Text style={styles.text}>Refresh this page's analysis to see the advanced tables.</Text></View>}
  </SafeAreaView>;
}
