import { useClerk, useUser } from "@clerk/expo";
import { router } from "expo-router";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PLAN_NAMES, usageMeter, type Usage, type UsageResponse } from "@tracetray/shared";
import { useApi } from "../../lib/api";
import { useSite } from "../../lib/site";
import { useLoad } from "../../lib/useLoad";
import { useTheme } from "../../lib/theme";

const MEASURES: { key: keyof Omit<Usage, "month">; label: string; color: number }[] = [
  { key: "visits", label: "Visits", color: 0 }, { key: "pages", label: "Pages tracked", color: 1 },
  { key: "sites", label: "Websites", color: 2 }, { key: "askQuestions", label: "Ask questions", color: 4 }
];

function UsageCard({ data }: { data: UsageResponse }) {
  const { styles, colors } = useTheme();
  const { mode, plan, limits, usage } = data;
  const limited = mode === "production" && limits !== null;
  const month = new Date(`${usage.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const overVisits = limited && usageMeter(usage.visits, limits.visits).over;
  const overPages = limited && usageMeter(usage.pages, limits.pages).over;
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Plan and usage</Text><Text style={styles.muted}>{month} so far</Text>
      <Text style={styles.text}>{mode === "beta" ? "TraceTray is in beta, so nothing is limited while it lasts." : `You're on ${PLAN_NAMES[plan]}.`}</Text>
      <Text style={styles.muted}>Across all your websites. Visits, tracked pages and Ask questions reset on the 1st (UTC).</Text>
      {MEASURES.map(({ key, label, color }) => {
        const used = usage[key];
        const limit = limited ? limits[key] : null;
        const meter = usageMeter(used, limit);
        return <View key={key} style={{ gap: 8, paddingVertical: 10 }}>
          <View style={styles.row}><Text style={[styles.text, { flex: 1 }]}>{label}</Text><Text style={[styles.text, { color: meter.over ? colors.danger : colors.ink }]}>{used.toLocaleString()}{limited ? limit === null ? " · No limit" : ` of ${limit.toLocaleString()}` : ""}</Text></View>
          {meter.share !== null ? <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.canvas }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(meter.share * 100), text: `${used.toLocaleString()} of ${limit?.toLocaleString()}` }} accessibilityLabel={label}>
            <View style={{ width: `${meter.share * 100}%`, height: 8, borderRadius: 4, backgroundColor: meter.over ? colors.danger : colors.groups[color] }} />
          </View> : null}
        </View>;
      })}
      {overVisits || overPages ? <Text style={styles.muted}>TraceTray keeps collecting after a limit is reached. Extra pages are locked; extra visits keep their summary only. Monthly allowances reset on the 1st.</Text> : null}
      {limited ? <Text style={styles.muted}>{limits.historyDays === null ? "History has no time limit." : `History is kept for ${limits.historyDays.toLocaleString()} days.`}</Text> : null}
    </View>
  );
}

export default function AccountScreen() {
  const api = useApi();
  const { site } = useSite();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { styles, colors } = useTheme();
  const result = useLoad(() => api.usage(), [api]);
  function confirmSignOut() {
    Alert.alert("Sign out?", "You can sign in again with your TraceTray account.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", onPress: () => { signOut().catch(() => Alert.alert("Couldn't sign out", "Try again.")); } }
    ]);
  }
  function open(url: string) { Linking.openURL(url).catch(() => Alert.alert("Couldn't open the page", "Try again.")); }
  return <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={result.loading} onRefresh={result.reload} tintColor={colors.accent} />}>
      <View style={{ gap: 8 }}><Text style={styles.title}>Your account</Text>{user?.primaryEmailAddress ? <Text selectable style={styles.muted}>{user.primaryEmailAddress.emailAddress}</Text> : null}</View>
      {result.data ? <UsageCard data={result.data} /> : <View style={styles.panel}>
        <Text style={styles.heading}>Plan and usage</Text>
        {result.error ? <><Text style={styles.error}>{result.error}</Text><Pressable accessibilityRole="button" onPress={result.reload} style={{ paddingVertical: 12 }}><Text style={styles.link}>Try again</Text></Pressable></> : <ActivityIndicator color={colors.accent} />}
      </View>}
      <View style={styles.panel}>
        <Text style={styles.heading}>Your websites</Text>
        <Text style={styles.muted}>Add or rename a website, get its installation code, or remove its data.</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push("/websites")}><Text style={styles.buttonText}>Manage websites</Text></Pressable>
      </View>
      <View style={styles.panel}>
        <Text style={styles.heading}>Help and information</Text>
        {site ? <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push({ pathname: "/report", params: { site: site.key } })}><Text style={styles.buttonText}>Report a problem</Text></Pressable> : <Text style={styles.muted}>Choose a website to attach a problem report.</Text>}
        <View style={styles.wrap}><Pressable accessibilityRole="link" onPress={() => open("https://tracetray.com/privacy")} style={{ paddingVertical: 12 }}><Text style={styles.link}>Privacy</Text></Pressable><Pressable accessibilityRole="link" onPress={() => open("https://tracetray.com/terms")} style={{ paddingVertical: 12 }}><Text style={styles.link}>Terms</Text></Pressable></View>
      </View>
      <Pressable accessibilityRole="button" onPress={confirmSignOut} style={styles.button}><Text style={styles.buttonText}>Sign out</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}
