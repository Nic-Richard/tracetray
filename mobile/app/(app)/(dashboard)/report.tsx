import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { REPORT_CATEGORIES, reportError, reportPageUrl, type BugCategory, type Site } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useTheme } from "../../../lib/theme";
import { Failure } from "../../../components/Status";

function ReportForm({ site, page }: { site: Site; page: string }) {
  const api = useApi();
  const { styles, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<BugCategory>("bug");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<{ sending?: boolean; sent?: boolean; error?: string }>({});
  const sending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function submit() {
    if (sending.current) return;
    const error = reportError(description);
    if (error) { setState({ error }); return; }
    sending.current = true;
    setState({ sending: true });
    try {
      await api.reportBug(site.key, { category, description: description.trim(), dashboard_section: page ? "android/page" : "android/account", ...(page ? { page_url: page } : {}) });
      if (active.current) setState({ sent: true });
    } catch (error) {
      if (active.current) setState({ error: error instanceof Error ? error.message : "The report wasn't sent. Try again." });
    } finally { if (active.current) sending.current = false; }
  }
  if (state.sent) return <View style={styles.center}><Text style={styles.heading}>Report sent</Text><Text style={styles.text}>Thanks, the report was sent.</Text><Pressable accessibilityRole="button" style={styles.button} onPress={() => router.canGoBack() ? router.back() : router.replace("/")}><Text style={styles.buttonText}>Done</Text></Pressable></View>;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={insets.top + 56 + (Platform.OS === "android" ? insets.bottom : 0)}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{site.name}</Text>
      {page ? <View style={{ gap: 4 }}><Text style={styles.muted}>Page attached to this report</Text><Text selectable style={styles.text}>{page}</Text></View> : null}
      <Text style={styles.text}>What kind of problem?</Text>
      <View style={{ gap: 8 }}>{REPORT_CATEGORIES.map(item => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: category === item.value, disabled: !!state.sending }} disabled={state.sending} onPress={() => setCategory(item.value)} style={[styles.panel, { paddingVertical: 12, borderColor: category === item.value ? colors.accent : colors.line }]}><Text style={category === item.value ? styles.link : styles.text}>{item.label}</Text></Pressable>)}</View>
      <Text style={styles.text}>What happened?</Text>
      <TextInput accessibilityLabel="What happened?" style={[styles.input, { minHeight: 150, paddingVertical: 12, textAlignVertical: "top" }]} value={description} onChangeText={setDescription} editable={!state.sending} multiline maxLength={5000} placeholder="What you were doing and what went wrong" placeholderTextColor={colors.muted} />
      <Text style={styles.muted}>{description.length.toLocaleString()} / 5,000 characters</Text>
      {state.error ? <Text style={styles.error} accessibilityRole="alert">{state.error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!state.sending }} disabled={state.sending} style={[styles.button, { opacity: state.sending ? 0.5 : 1 }]} onPress={submit}><Text style={styles.buttonText}>{state.sending ? "Sending…" : "Send report"}</Text></Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}

export default function ReportScreen() {
  const params = useLocalSearchParams<{ site?: string | string[]; page?: string | string[] }>();
  const siteKey = typeof params.site === "string" ? params.site : "";
  const page = reportPageUrl(typeof params.page === "string" ? params.page : "");
  const { account } = useSite();
  const { styles } = useTheme();
  const site = account.sites.find(value => value.key === siteKey);
  if (!site) return <Failure message="Choose one of your websites." retry={() => router.replace("/")} />;
  return <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}><ReportForm key={`${site.key}:${page}`} site={site} page={page} /></SafeAreaView>;
}
