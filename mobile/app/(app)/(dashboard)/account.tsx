import { useClerk, useUser } from "@clerk/expo";
import { router } from "expo-router";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PLAN_NAMES, usageMeter, type Usage, type UsageResponse } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";
import ActionRow from "../../../components/ActionRow";
import Icon from "../../../components/Icon";
import AppearancePicker from "../../../components/AppearancePicker";

const MEASURES: { key: keyof Omit<Usage, "month">; label: string; color: number }[] = [
  { key: "visits", label: "Visits", color: 0 },
  { key: "pages", label: "Pages tracked", color: 1 },
  { key: "sites", label: "Websites", color: 2 },
  { key: "askQuestions", label: "Ask questions", color: 4 },
];

function UsageCard({ data }: { data: UsageResponse }) {
  const { styles, colors } = useTheme();
  const { mode, plan, limits, usage } = data;
  const limited = mode === "production" && limits !== null;
  const month = new Date(`${usage.month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const overVisits = limited && usageMeter(usage.visits, limits.visits).over;
  const overPages = limited && usageMeter(usage.pages, limits.pages).over;
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Plan and usage</Text>
      <Text style={styles.muted}>{month} so far</Text>
      <Text style={styles.text}>
        {mode === "beta"
          ? "TraceTray is in beta, so nothing is limited while it lasts."
          : `You're on ${PLAN_NAMES[plan]}.`}
      </Text>
      <Text style={styles.muted}>
        Across all your websites. Visits, tracked pages and Ask questions reset on the 1st (UTC).
      </Text>
      {MEASURES.map(({ key, label, color }) => {
        const used = usage[key];
        const limit = limited ? limits[key] : null;
        const meter = usageMeter(used, limit);
        return (
          <View key={key} style={{ gap: 8, paddingVertical: 10 }}>
            <View style={styles.row}>
              <Text style={[styles.text, { flex: 1 }]}>{label}</Text>
              <Text style={[styles.text, { color: meter.over ? colors.danger : colors.ink }]}>
                {used.toLocaleString()}
                {limited ? (limit === null ? " · No limit" : ` of ${limit.toLocaleString()}`) : ""}
              </Text>
            </View>
            {meter.share !== null ? (
              <View
                style={{ height: 8, borderRadius: 4, backgroundColor: colors.canvas }}
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round(meter.share * 100),
                  text: `${used.toLocaleString()} of ${limit?.toLocaleString()}`,
                }}
                accessibilityLabel={label}
              >
                <View
                  style={{
                    width: `${meter.share * 100}%`,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: meter.over ? colors.danger : colors.groups[color],
                  }}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      {overVisits || overPages ? (
        <Text style={styles.muted}>
          TraceTray keeps collecting after a limit is reached. Extra pages are locked; extra visits keep their summary
          only. Monthly allowances reset on the 1st.
        </Text>
      ) : null}
      {limited ? (
        <Text style={styles.muted}>
          {limits.historyDays === null
            ? "History has no time limit."
            : `History is kept for ${limits.historyDays.toLocaleString()} days.`}
        </Text>
      ) : null}
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
      {
        text: "Sign out",
        onPress: () => {
          signOut().catch(() => Alert.alert("Couldn't sign out", "Try again."));
        },
      },
    ]);
  }
  function open(url: string) {
    Linking.openURL(url).catch(() => Alert.alert("Couldn't open the page", "Try again."));
  }
  return (
    <SafeAreaView style={styles.screen} edges={["left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={result.loading} onRefresh={result.reload} tintColor={colors.accent} />
        }
      >
        <View style={[styles.row, { justifyContent: "flex-start" }]}>
          <View style={[styles.iconTile, { width: 54, height: 54, borderRadius: 18 }]}>
            <Icon name="account" color={colors.accent} size={26} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.heading}>{user?.fullName || "Your account"}</Text>
            {user?.primaryEmailAddress ? (
              <Text selectable style={styles.muted}>
                {user.primaryEmailAddress.emailAddress}
              </Text>
            ) : null}
          </View>
        </View>
        {result.data ? (
          <UsageCard data={result.data} />
        ) : (
          <View style={styles.panel}>
            <Text style={styles.heading}>Plan and usage</Text>
            {result.error ? (
              <>
                <Text style={styles.error}>{result.error}</Text>
                <Pressable accessibilityRole="button" onPress={result.reload} style={{ paddingVertical: 12 }}>
                  <Text style={styles.link}>Try again</Text>
                </Pressable>
              </>
            ) : (
              <ActivityIndicator color={colors.accent} />
            )}
          </View>
        )}
        <View style={{ gap: 10 }}>
          <Text style={styles.eyebrow}>Preferences</Text>
          <AppearancePicker />
          <View style={[styles.panel, { paddingVertical: 4, gap: 0 }]}>
            <ActionRow
              icon="goals"
              title="Plan and billing"
              detail="Subscription, plan allowances and usage"
              onPress={() => router.push("/billing")}
            />
            <View style={styles.divider} />
            <ActionRow
              icon="pages"
              title="Your websites"
              detail="Manage websites and installation"
              onPress={() => router.push("/websites")}
            />
            <View style={styles.divider} />
            {site ? (
              <>
                <ActionRow
                  icon="setup"
                  title="Installation snippet"
                  detail={site.name}
                  onPress={() => router.push({ pathname: "/installation", params: { site: site.key } })}
                />
                <View style={styles.divider} />
              </>
            ) : null}
            <ActionRow
              icon="sessions"
              title="Email preferences"
              detail="Weekly summaries and behaviour alerts"
              onPress={() => router.push("/emails")}
            />
          </View>
        </View>
        <View style={{ gap: 10 }}>
          <Text style={styles.eyebrow}>Help and information</Text>
          <View style={[styles.panel, { paddingVertical: 4, gap: 0 }]}>
            {site ? (
              <>
                <ActionRow
                  icon="bug"
                  title="Report a problem"
                  onPress={() => router.push({ pathname: "/report", params: { site: site.key } })}
                />
                <View style={styles.divider} />
              </>
            ) : null}
            <ActionRow icon="lock" title="Privacy policy" onPress={() => open("https://tracetray.com/privacy")} />
            <View style={styles.divider} />
            <ActionRow icon="sessions" title="Terms of service" onPress={() => open("https://tracetray.com/terms")} />
          </View>
        </View>
        <Pressable accessibilityRole="button" onPress={confirmSignOut} style={styles.secondaryButton}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/delete-account")}
          style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={[styles.link, { color: colors.danger }]}>Delete account</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
