import { useLocalSearchParams } from "expo-router";
import { RefreshControl, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { pageLabel } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";
import { Failure, Loading } from "../../../components/Status";
import TrendSurface from "../../../components/TrendSurface";

export default function TrendsScreen() {
  const params = useLocalSearchParams<{ page?: string | string[]; site?: string | string[] }>();
  const page = typeof params.page === "string" ? params.page : "";
  const site = typeof params.site === "string" ? params.site : "";
  const { account } = useSite();
  const api = useApi();
  const { styles, colors } = useTheme();
  const owned = account.sites.some(value => value.key === site);
  const result = useLoad(async () => {
    if (!owned || !page) throw new Error("Choose a page from one of your websites.");
    const [trends, goal, visits] = await Promise.all([api.uxTrends(site, page, 8), api.goalTrend(site, page), api.timeseries(site, page, 30)]);
    return { trends, goal, visits };
  }, [api, owned, site, page]);
  if (result.error) return <Failure message={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  return <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={result.loading} onRefresh={result.reload} tintColor={colors.accent} />}>
      <Text style={styles.title}>{pageLabel(page)}</Text>
      <TrendSurface {...result.data} />
    </ScrollView>
  </SafeAreaView>;
}
