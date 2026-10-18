import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { describeGoal, goalAppliesToPage, pageLabel, pagePath, percent, type Goal } from "@tracetray/shared";
import { Failure, Loading } from "../../../components/Status";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useRefreshOnFocus } from "../../../lib/useRefreshOnFocus";
import { useTheme } from "../../../lib/theme";

function Goals({ siteKey, page }: { siteKey: string; page: string }) {
  const api = useApi();
  const { account } = useSite();
  const { styles, colors } = useTheme();
  const list = useLoad(() => api.goals(siteKey), [api, siteKey]);
  useRefreshOnFocus(list.reload);
  const [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState("");
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const checking = list.data?.goals.some(goal => ["queued", "running"].includes(goal.backfill));
  useFocusEffect(useCallback(() => {
    if (!checking || busy) return;
    let cancelled = false;
    const timer = setInterval(() => {
      api.goals(siteKey).then(data => { if (!cancelled) { list.setData(data); setPollError(""); } }).catch(() => { if (!cancelled) setPollError("Couldn't refresh past-visit checks. Pull down to try again."); });
    }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, siteKey, checking, busy, list.setData]));
  async function change(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await action(); if (active.current) list.setData(await api.goals(siteKey)); }
    catch (error) { if (active.current) Alert.alert("Couldn't update your goals", error instanceof Error ? error.message : "Try again."); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  function remove(goal: Goal) {
    Alert.alert(`Remove ${goal.name}?`, "This removes the goal and its recorded matches. Your visits stay. Pages using it as their main goal will no longer have it selected.", [
      { text: "Keep goal", style: "cancel" }, { text: "Remove goal", style: "destructive", onPress: () => { change(() => api.removeGoal(siteKey, goal.id)); } }
    ]);
  }
  if (list.error) return <Failure message={list.error} retry={list.reload} />;
  if (!list.data) return <Loading message="Loading your goals…" />;
  const { goals, cap, main_goals } = list.data;
  const main = main_goals.find(value => value.page === page)?.goal;
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={colors.accent} enabled={!busy} />}>
    <Text style={styles.heading}>{account.sites.find(site => site.key === siteKey)?.name}</Text>
    <Text style={styles.text}>Goals track a button people click, a form they send, or a page they go on to. New goals also check past visits.</Text>
    {page ? <View style={styles.panel}>
      <Text style={styles.heading}>Main goal for {pageLabel(page)}</Text><Text style={styles.muted}>{pagePath(page)}</Text>
      <Text style={styles.text}>{goals.find(goal => goal.id === main)?.name || "No main goal selected"}</Text>
      <Text style={styles.muted}>Choose an applicable goal below to feature it on this page.</Text>
      {main ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => { change(() => api.setMainGoal(siteKey, page, null)); }} style={{ paddingVertical: 12 }}><Text style={styles.link}>Clear main goal</Text></Pressable> : null}
    </View> : null}
    <View style={styles.row}><Text style={styles.heading}>{goals.length} of {cap} goals</Text></View>
    {pollError ? <Text accessibilityRole="alert" style={styles.error}>{pollError}</Text> : null}
    {goals.map(goal => <View key={goal.id} style={styles.panel}>
      <Text style={styles.heading}>{goal.name}{main === goal.id ? " · Main goal" : ""}</Text>
      <Text style={styles.muted}>{describeGoal(goal)}</Text>
      <Text style={styles.muted}>{goal.pages.length ? `Counts on ${goal.pages.map(pagePath).join(", ")}` : "Counts on all pages"}</Text>
      {goal.target != null ? <Text style={styles.text}>Target: {percent(goal.target, goal.target < 0.1 ? 1 : 0)} of visits</Text> : null}
      <Text style={styles.muted}>{["queued", "running"].includes(goal.backfill) ? "Checking past visits…" : goal.backfill === "failed" ? "Couldn't check past visits; new visits still count." : `${(goal.reached_last_7_days || 0).toLocaleString()} matches in the last 7 days`}</Text>
      {goal.reached_all_time ? <Text style={styles.muted}>{goal.reached_all_time.toLocaleString()} all time{goal.next_milestone ? ` · Next milestone ${goal.next_milestone.toLocaleString()}` : ""}</Text> : null}
      {goal.milestone_this_week ? <Text style={[styles.text, { color: colors.good }]}>Passed {goal.milestone_this_week.toLocaleString()} this week</Text> : null}
      {page && goalAppliesToPage(goal, page) && goal.id !== main ? <Pressable accessibilityRole="button" accessibilityLabel={`Make ${goal.name} the main goal`} disabled={busy} onPress={() => { change(() => api.setMainGoal(siteKey, page, goal.id)); }} style={{ paddingVertical: 12 }}><Text style={styles.link}>Make main goal for this page</Text></Pressable> : null}
      <View style={styles.wrap}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${goal.name}`} disabled={busy} onPress={() => router.push({ pathname: "/goal", params: { site: siteKey, id: goal.id, page } })} style={{ paddingVertical: 12 }}><Text style={styles.link}>Edit name or target</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${goal.name}`} disabled={busy} onPress={() => remove(goal)} style={{ paddingVertical: 12 }}><Text style={[styles.link, { color: colors.danger }]}>Remove</Text></Pressable>
      </View>
    </View>)}
    {!goals.length ? <Text style={styles.muted}>No goals yet. Add one to start measuring what visitors come here to do.</Text> : null}
    {goals.length < cap ? <Pressable accessibilityRole="button" style={styles.button} disabled={busy} onPress={() => router.push({ pathname: "/goal", params: { site: siteKey, page } })}><Text style={styles.buttonText}>Add goal</Text></Pressable> : <Text style={styles.muted}>You've used every goal your plan includes for this website. Remove one to add another.</Text>}
  </ScrollView>;
}

export default function GoalsScreen() {
  const params = useLocalSearchParams<{ site?: string | string[]; page?: string | string[] }>();
  const { account } = useSite();
  const { styles } = useTheme();
  const siteKey = typeof params.site === "string" ? params.site : "";
  const page = typeof params.page === "string" ? params.page : "";
  if (!account.sites.some(site => site.key === siteKey)) return <Failure message="Choose one of your websites." retry={() => router.replace("/")} />;
  return <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}><Goals key={`${siteKey}:${page}`} siteKey={siteKey} page={page} /></SafeAreaView>;
}
