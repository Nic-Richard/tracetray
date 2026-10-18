import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EMAILS, type EmailList } from "@tracetray/shared";
import { Failure, Loading } from "../../../components/Status";
import { useApi } from "../../../lib/api";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";

export default function EmailsScreen() {
  const api = useApi();
  const { styles, colors } = useTheme();
  const prefs = useLoad(() => api.emailPrefs(), [api]);
  const [saving, setSaving] = useState<EmailList | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function toggle(list: EmailList, enabled: boolean) {
    if (pending.current || !prefs.data?.available[list]) return;
    pending.current = true; setSaving(list); setError(""); setSaved(false);
    try {
      await api.setEmailPrefs({ [list]: enabled });
      if (active.current) {
        prefs.setData(current => current ? { ...current, [list]: enabled } : current);
        setSaved(true);
      }
    } catch (error) {
      if (active.current) setError(error instanceof Error ? error.message : "The preference wasn't saved. Try again.");
    } finally { pending.current = false; if (active.current) setSaving(null); }
  }
  if (prefs.error) return <Failure message={prefs.error} retry={prefs.reload} />;
  if (!prefs.data) return <Loading message="Loading email preferences…" />;
  return <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={prefs.loading} enabled={!saving} onRefresh={() => { setSaved(false); setError(""); prefs.reload(); }} tintColor={colors.accent} />}>
      <Text style={styles.title}>Your emails</Text>
      <Text style={styles.text}>Choose which optional TraceTray emails you receive. These settings apply to your account across all your websites.</Text>
      {EMAILS.map(email => {
        const available = prefs.data!.available[email.list];
        return <View key={email.list} style={styles.panel}>
          <View style={styles.row}>
            <Text style={[styles.heading, { flex: 1 }]}>{email.name}</Text>
            <Switch accessibilityLabel={email.name} value={prefs.data![email.list]} disabled={!available || saving !== null} onValueChange={enabled => { toggle(email.list, enabled); }} trackColor={{ false: colors.line, true: colors.accent }} />
          </View>
          <Text style={styles.muted}>{email.about}</Text>
          {!available ? <Text style={styles.muted}>Not included with your current plan.</Text> : null}
          {saving === email.list ? <View style={styles.row}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>Saving…</Text></View> : null}
        </View>;
      })}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error} Try again or pull down to check the saved settings.</Text> : saved ? <Text accessibilityLiveRegion="polite" style={[styles.text, { color: colors.good }]}>Preferences saved.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
