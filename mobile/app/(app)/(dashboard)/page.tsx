import { useRef, type ComponentRef } from "react";
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
import ActionRow from "../../../components/ActionRow";
import { useAnalysisActions } from "../../../lib/useAnalysisActions";

export default function PageScreen() {
  const params = useLocalSearchParams<{ page?: string | string[]; site?: string | string[] }>();
  const page = typeof params.page === "string" ? params.page : "";
  const siteKey = typeof params.site === "string" ? params.site : "";
  const { account } = useSite();
  const { styles, colors } = useTheme();
  const api = useApi();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const groupTop = useRef(0);
  const selectedSite = account.sites.find(value => value.key === siteKey);
  const result = useLoad(async () => {
    if (!selectedSite || !page) throw new Error("Choose a page from one of your websites.");
    const [stats, visits, goals] = await Promise.all([
      api.stats(selectedSite.key, page),
      api.timeseries(selectedSite.key, page, 30),
      api.goalRates(selectedSite.key, page),
    ]);
    return { stats, visits, goals };
  }, [api, selectedSite?.key, page]);
  const actions = useAnalysisActions(siteKey, page, result.reload);
  useRefreshOnFocus(result.reload);
  if (result.error) return <Failure message={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  const { stats, visits, goals } = result.data;
  const analysis = stats.last_analysis;
  const inactive = (analysis?.inactive_count || 0) + (analysis?.mobile?.inactive_count || 0);
  const analyzed = visitCount(analysis, "desktop") + visitCount(analysis, "mobile");
  const inactiveShare = analysis?.inactive_count != null && analyzed ? inactive / analyzed : null;
  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={result.loading} onRefresh={result.reload} tintColor={colors.accent} />
        }
      >
        <View style={{ gap: 6 }}>
          <Text style={styles.muted}>{selectedSite?.name}</Text>
          <Text style={styles.title}>{pageLabel(page)}</Text>
          <Text style={styles.muted}>{pagePath(page)}</Text>
        </View>
        <View style={{ gap: 12 }}>
          <Text style={styles.muted}>
            {analysis
              ? `Analysis updated ${timeAgo(analysis.ran_at)}. It uses its own period, shown with the findings below. Traffic covers the last 30 days. After a page change, collect new visits before refreshing; a refresh also includes older visits.`
              : "No analysis yet. Refresh to find visitor groups and suggestions."}
          </Text>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              disabled={actions.busy}
              onPress={actions.refresh}
              style={[styles.secondaryButton, { flex: 1, opacity: actions.busy ? 0.5 : 1 }]}
            >
              <Text style={styles.link}>{actions.busy ? "Working…" : "Refresh analysis"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={actions.busy}
              onPress={actions.more}
              style={styles.secondaryButton}
            >
              <Text style={styles.link}>More</Text>
            </Pressable>
          </View>
          {actions.status ? (
            <Text accessibilityLiveRegion="polite" style={actions.status.error ? styles.error : styles.muted}>
              {actions.status.text}
            </Text>
          ) : null}
        </View>
        <View style={styles.panel}>
          <View style={styles.wrap}>
            <View style={styles.stat}>
              <Text style={styles.number}>{compactNumber(visits.total_sessions)}</Text>
              <Text style={styles.muted}>Visits, last 30 days</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.number}>{visits.total_sessions ? percent(visits.engagement_rate) : "–"}</Text>
              <Text style={styles.muted}>Engaged visits, last 30 days</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.number}>{inactiveShare === null ? "–" : percent(inactiveShare)}</Text>
              <Text style={styles.muted}>Without interaction, last analysis</Text>
            </View>
          </View>
        </View>
        <View style={[styles.panel, { paddingVertical: 4, gap: 0 }]}>
          <ActionRow
            icon="trends"
            title="Trends"
            detail="Traffic, goals and behaviour over time"
            onPress={() => router.push({ pathname: "/trends", params: { page, site: siteKey } })}
          />
          <View style={styles.divider} />
          <ActionRow
            icon="attention"
            title="Attention"
            detail="See recorded cursor, scroll and tap activity"
            onPress={() => router.push({ pathname: "/attention", params: { page, site: siteKey } })}
          />
          <View style={styles.divider} />
          <ActionRow
            icon="journeys"
            title="Before and after"
            detail="Compare behaviour around a change"
            onPress={() => router.push({ pathname: "/changes", params: { page, site: siteKey } })}
          />
          <View style={styles.divider} />
          <ActionRow
            icon="pages"
            title="Advanced analysis"
            detail="Feature means, effect sizes and group quality"
            onPress={() => router.push({ pathname: "/advanced", params: { page, site: siteKey } })}
          />
        </View>
        <View style={styles.panel}>
          <Text style={styles.heading}>Goals</Text>
          {goals.goals.length ? (
            goals.goals.map(goal => (
              <View key={goal.id} style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.text}>
                    {goal.name}
                    {goal.main ? " · Main goal" : ""}
                  </Text>
                  <Text style={styles.muted}>
                    {goal.reached.toLocaleString()} of {goal.visits.toLocaleString()} visits
                  </Text>
                </View>
                <Text style={styles.number}>{percent(goal.rate)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No goal is set for this page yet.</Text>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/goals", params: { site: siteKey, page } })}
            style={{ paddingVertical: 12 }}
          >
            <Text style={styles.link}>Manage goals for this page</Text>
          </Pressable>
        </View>
        {analysis ? <Suggestions result={analysis} /> : null}
        {analysis ? <VisitorGroups result={analysis} /> : null}
        {isPageGroup(page) ? (
          <View
            onLayout={event => {
              groupTop.current = event.nativeEvent.layout.y;
            }}
          >
            <GroupPages
              key={`${siteKey}:${page}`}
              page={page}
              site={siteKey}
              onPageChange={() => scroll.current?.scrollTo({ y: groupTop.current, animated: false })}
            />
          </View>
        ) : null}
        <View style={[styles.panel, { paddingVertical: 4 }]}>
          <ActionRow
            icon="ask"
            title="Ask about this page"
            detail="Explore what could help visitors reach a goal"
            onPress={() =>
              router.push({
                pathname: "/ask",
                params: {
                  site: siteKey,
                  q: `What could help visitors reach the goal on ${pageLabel(page)} (${pagePath(page)})?`.slice(0, 500),
                },
              })
            }
          />
        </View>
        <Pressable
          onPress={() => router.push({ pathname: "/report", params: { site: siteKey, page } })}
          style={{ paddingVertical: 12 }}
          accessibilityRole="button"
        >
          <Text style={styles.link}>Report a problem on this page</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
