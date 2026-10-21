import { useLocalSearchParams } from "expo-router";
import { FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { pageLabel, pagePath, timeAgo, visitDuration } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";
import { Failure, Loading } from "../../../components/Status";

export default function SessionsScreen() {
  const params = useLocalSearchParams<{ site?: string | string[] }>();
  const siteKey = typeof params.site === "string" ? params.site : "";
  const { account } = useSite();
  const site = account.sites.find(value => value.key === siteKey);
  const api = useApi();
  const { styles, colors } = useTheme();
  const result = useLoad(async () => {
    if (!site) throw new Error("Choose one of your websites.");
    return api.recentSessions(site.key, 50);
  }, [api, site?.key]);
  if (result.error) return <Failure message={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <FlatList
        data={result.data}
        keyExtractor={item => item.session_id}
        refreshing={result.loading}
        onRefresh={result.reload}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <Text style={styles.title}>{site?.name}</Text>
            <Text style={styles.muted}>The 50 most recent visits, newest first. Each visit to a page counts once.</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.panel}>
            <Text style={styles.heading}>No finished visits yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const phone = item.device_type === "mobile";
          const actions = (phone ? item.summary?.taps : item.summary?.clicks) ?? 0;
          return (
            <View style={styles.panel}>
              <View style={styles.row}>
                <Text style={[styles.heading, { flex: 1 }]}>{pageLabel(item.page)}</Text>
                <Text style={styles.muted}>{timeAgo(item.start_time)}</Text>
              </View>
              <Text style={styles.muted}>{pagePath(item.page)}</Text>
              <View style={styles.row}>
                <Text style={[styles.text, { color: colors.groups[phone ? 1 : 0] }]}>
                  {phone ? "Phone" : "Desktop"}
                </Text>
                <Text style={styles.text}>{visitDuration(item.summary?.duration_ms)}</Text>
              </View>
              <Text style={styles.muted}>
                {actions} {phone ? "tap" : "click"}
                {actions === 1 ? "" : "s"}
              </Text>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
