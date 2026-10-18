import { router, useLocalSearchParams } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { compactNumber, isPageGroup, pageLabel, pagePath, percent, timeAgo, visitCount } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useRefreshOnFocus } from "../../../lib/useRefreshOnFocus";
import { useTheme } from "../../../lib/theme";
import { Failure, Loading } from "../../../components/Status";
import VisitorGroups, { Suggestions } from "../../../components/VisitorGroups";
import GroupPages from "../../../components/GroupPages";

export default function PageScreen() {
  const params = useLocalSearchParams<{ page?: string | string[]; site?: string | string[] }>();
  const page = typeof params.page === "string" ? params.page : "";
  const siteKey = typeof params.site === "string" ? params.site : "";
  const { account } = useSite();
  const { styles, colors } = useTheme();
  const api = useApi();
  const selectedSite = account.sites.find(value => value.key === siteKey);
  const result = useLoad(async () => {
    if (!selectedSite || !page) throw new Error("Choose a page from one of your websites.");
    const [stats, visits, goals] = await Promise.all([api.stats(selectedSite.key, page), api.timeseries(selectedSite.key, page, 30), api.goalRates(selectedSite.key, page)]);
    return { stats, visits, goals };
  }, [api, selectedSite?.key, page]);
  useRefreshOnFocus(result.reload);
  if (result.error) return <Failure message={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  const { stats, visits, goals } = result.data;
  const analysis = stats.last_analysis;
  const inactive = (analysis?.inactive_count || 0) + (analysis?.mobile?.inactive_count || 0);
  const analyzed = visitCount(analysis, "desktop") + visitCount(analysis, "mobile");
  const inactiveShare = analysis?.inactive_count != null && analyzed ? inactive / analyzed : null;
  return <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={result.loading} onRefresh={result.reload} tintColor={colors.accent} />}>
      <View style={{ gap: 6 }}><Text style={styles.muted}>{selectedSite?.name}</Text><Text style={styles.title}>{pageLabel(page)}</Text><Text style={styles.muted}>{pagePath(page)}</Text></View>
      <Pressable style={styles.button} onPress={() => router.push({ pathname: "/trends", params: { page, site: siteKey } })}><Text style={styles.buttonText}>View trends</Text></Pressable>
      <Pressable style={styles.button} onPress={() => router.push({ pathname: "/attention", params: { page, site: siteKey } })}><Text style={styles.buttonText}>View attention</Text></Pressable>
      <Pressable style={styles.button} onPress={() => router.push({ pathname: "/ask", params: { site: siteKey, q: `What could help visitors reach the goal on ${pageLabel(page)} (${pagePath(page)})?`.slice(0, 500) } })}><Text style={styles.buttonText}>Ask about this page</Text></Pressable>
      <Pressable onPress={() => router.push({ pathname: "/report", params: { site: siteKey, page } })} style={{ paddingVertical: 12 }} accessibilityRole="button"><Text style={styles.link}>Report a problem on this page</Text></Pressable>
      {isPageGroup(page) ? <GroupPages key={`${siteKey}:${page}`} page={page} site={siteKey} /> : null}
      <View style={styles.panel}>
        <Text style={styles.heading}>Last 30 days</Text>
        <View style={styles.wrap}>
          <View style={styles.stat}><Text style={styles.number}>{compactNumber(visits.total_sessions)}</Text><Text style={styles.muted}>Visits</Text></View>
          <View style={styles.stat}><Text style={styles.number}>{visits.total_sessions ? percent(visits.engagement_rate) : "–"}</Text><Text style={styles.muted}>Engaged</Text></View>
        </View>
      </View>
      <View style={styles.panel}>
        <Text style={styles.heading}>Goals</Text>
        {goals.goals.length ? goals.goals.map(goal => <View key={goal.id} style={styles.row}>
          <View style={{ flex: 1, gap: 4 }}><Text style={styles.text}>{goal.name}{goal.main ? " · Main goal" : ""}</Text><Text style={styles.muted}>{goal.reached.toLocaleString()} of {goal.visits.toLocaleString()} visits</Text></View>
          <Text style={styles.number}>{percent(goal.rate)}</Text>
        </View>) : <Text style={styles.muted}>No goal is set for this page yet.</Text>}
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/goals", params: { site: siteKey, page } })} style={{ paddingVertical: 12 }}><Text style={styles.link}>Manage goals for this page</Text></Pressable>
      </View>
      <View style={styles.panel}>
        <Text style={styles.heading}>Analysis</Text>
        <Text style={styles.text}>{stats.last_analysis ? `Last analyzed ${timeAgo(stats.last_analysis.ran_at)}` : "This page hasn't been analyzed yet."}</Text>
        <Text style={styles.number}>{percent(inactiveShare)}</Text>
        <Text style={styles.muted}>Left without interacting{inactiveShare === null ? " · Shows after analysis" : " · Didn't scroll, click, tap or move the cursor"}</Text>
        <Text style={styles.muted}>{stats.total_sessions.toLocaleString()} visits recorded in total</Text>
      </View>
      {analysis ? <Suggestions result={analysis} /> : null}
      {analysis ? <VisitorGroups result={analysis} /> : null}
    </ScrollView>
  </SafeAreaView>;
}
