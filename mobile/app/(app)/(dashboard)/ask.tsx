import { useEffect, useRef, useState, type ComponentRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, ASK_LOOKUPS, ASK_STARTERS, askHistory, type AskEntry, type Site } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useTheme } from "../../../lib/theme";
import { Failure } from "../../../components/Status";
import Answer from "../../../components/Answer";
import Icon from "../../../components/Icon";
import SitePicker from "../../../components/SitePicker";

function Conversation({ site, question }: { site: Site; question: string }) {
  const api = useApi();
  const { styles, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<AskEntry[]>([]);
  const [input, setInput] = useState(question.slice(0, 500));
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const active = useRef(true);
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (question) setInput(question.slice(0, 500)); }, [question]);

  async function ask(raw: string) {
    const text = raw.trim();
    if (sending.current || text.length < 3 || text.length > 500) return;
    sending.current = true;
    const index = entries.length;
    const history = askHistory(entries);
    setBusy(true);
    setInput("");
    setEntries(current => [...current, { question: text }]);
    try {
      const answer = await api.ask(site.key, text, history);
      if (active.current) setEntries(current => current.map((entry, at) => at === index ? { ...entry, answer: answer.answer, lookups: answer.lookups } : entry));
    } catch (error) {
      const message = error instanceof ApiError && error.body.limit_reached === "ask"
        ? "You've used this month's Ask questions. They reset on the 1st."
        : error instanceof Error ? error.message : "Couldn't answer that just now. Try again.";
      if (active.current) setEntries(current => current.map((entry, at) => at === index ? { ...entry, error: message.charAt(0).toUpperCase() + message.slice(1), retryable: !(error instanceof ApiError && [401, 403, 429].includes(error.status)) } : entry));
    } finally {
      if (active.current) { sending.current = false; setBusy(false); }
    }
  }

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={insets.top + 56 + (Platform.OS === "android" ? insets.bottom : 0)}>
    <ScrollView ref={list} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
      onContentSizeChange={() => { if (entries.length) list.current?.scrollToEnd({ animated: false }); }}
      onLayout={() => { if (entries.length) list.current?.scrollToEnd({ animated: false }); }}>
      <View style={{ gap: 16 }}>
        <SitePicker siteKey={site.key} onSelect={key => router.setParams({ site: key, q: "" })} />
        <View style={styles.row}><Text style={[styles.heading, { flex: 1 }]}>Ask about your visitors</Text>{entries.length ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setEntries([]); setInput(""); list.current?.scrollTo({ y: 0, animated: false }); field.current?.focus(); }} style={{ paddingVertical: 12, opacity: busy ? 0.4 : 1 }}><Text style={styles.link}>Start over</Text></Pressable> : null}</View>
        <Text style={styles.muted}>Ask about your visitors in plain English. TraceTray looks up pages, traffic, clicks, journeys, goals and past analyses. It doesn't know revenue or who visitors are.</Text>
        {!entries.length && !question ? ASK_STARTERS.map(starter => <Pressable key={starter} accessibilityRole="button" style={({ pressed }) => [styles.panel, styles.row, pressed && styles.pressed]} onPress={() => { setInput(starter); field.current?.focus(); }}><Text style={[styles.text, { flex: 1 }]}>{starter}</Text><Icon name="arrow" size={17} /></Pressable>) : null}
      </View>
      {entries.map((item, index) => <View key={index} style={{ gap: 12 }}>
        <View style={[styles.panel, { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft, marginLeft: 24 }]}><Text style={styles.text}>{item.question}</Text></View>
        <View style={styles.panel} accessibilityLiveRegion="polite">
          {item.error ? <><Text style={styles.error}>{item.error}</Text>{item.retryable !== false ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => ask(item.question)} style={{ paddingVertical: 12 }}><Text style={styles.link}>Try again</Text></Pressable> : null}</>
            : item.answer ? <><Answer text={item.answer} />{item.lookups?.length ? <Text style={styles.muted}>Looked at {[...new Set(item.lookups)].map(name => ASK_LOOKUPS[name] || name).join(", ")}</Text> : null}</>
              : <View style={styles.row}><ActivityIndicator color={colors.accent} /><Text style={[styles.muted, { flex: 1 }]}>Looking at your data…</Text></View>}
        </View>
      </View>)}
    </ScrollView>
    <View style={{ padding: 16, gap: 10, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.panel }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
        <TextInput ref={field} accessibilityLabel="Your question" placeholder="Ask about this website" placeholderTextColor={colors.muted} value={input} onChangeText={setInput} maxLength={500} multiline style={[styles.input, { flex: 1, minHeight: 52, maxHeight: 140, paddingVertical: 12 }]} />
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || input.trim().length < 3 }} disabled={busy || input.trim().length < 3} style={[styles.button, { opacity: busy || input.trim().length < 3 ? 0.4 : 1 }]} onPress={() => ask(input)}><Text style={styles.buttonText}>Ask</Text></Pressable>
      </View>
      <Text style={styles.muted}>AI answers can be wrong. Check important details against the other views.</Text>
    </View>
  </KeyboardAvoidingView>;
}

export default function AskScreen() {
  const params = useLocalSearchParams<{ site?: string | string[]; q?: string | string[] }>();
  const siteKey = typeof params.site === "string" ? params.site : "";
  const question = typeof params.q === "string" ? params.q : "";
  const { account } = useSite();
  const { styles } = useTheme();
  const site = account.sites.find(value => value.key === siteKey);
  if (!site) return <Failure message="Choose one of your websites." retry={() => router.replace("/")} />;
  return <SafeAreaView style={styles.screen} edges={["left", "right"]}><Conversation key={site.key} site={site} question={question} /></SafeAreaView>;
}
