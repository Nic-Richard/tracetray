import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { describeGoal, formLabel, pageLabel, pagePath, parseGoalTarget, type FormSeen, type Goal, type GoalList, type GoalType } from "@tracetray/shared";
import ChoicePicker from "../../../components/ChoicePicker";
import { Failure, InlineFailure, Loading } from "../../../components/Status";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";

const formKey = (form: FormSeen) => JSON.stringify([form.id, form.name, form.action, form.page]);

function GoalForm({ siteKey, page, goal, list }: { siteKey: string; page: string; goal?: Goal; list: GoalList }) {
  const api = useApi();
  const { styles, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<GoalType>(goal?.type || "click");
  const [name, setName] = useState(goal?.name || "");
  const [text, setText] = useState("");
  const [destination, setDestination] = useState("");
  const [form, setForm] = useState("");
  const initialTarget = goal?.target != null ? String(goal.target * 100) : "";
  const [target, setTarget] = useState(initialTarget);
  const [scoped, setScoped] = useState(!!page);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const pages = useLoad(() => !goal && type === "page" ? api.pages(siteKey) : Promise.resolve([]), [api, siteKey, type, goal?.id]);
  const forms = useLoad(() => !goal && type === "form" ? api.forms(siteKey) : Promise.resolve([]), [api, siteKey, type, goal?.id]);
  async function save() {
    if (pending.current) return;
    const aim = goal && target === initialTarget ? { target: goal.target ?? null } : parseGoalTarget(target);
    if (aim.error) { setError(aim.error); return; }
    const chosen = forms.data?.find(value => formKey(value) === form);
    if (goal && !name.trim()) { setError("Give the goal a name."); return; }
    if (!goal && (type === "click" ? !text.trim() : type === "page" ? !pages.data?.some(value => value.page === destination) : !list.form_goals || !chosen)) { setError("Choose what counts as reaching this goal."); return; }
    pending.current = true; setBusy(true); setError(""); Keyboard.dismiss();
    try {
      if (goal) await api.editGoal(siteKey, goal.id, { name: name.trim(), target: aim.target });
      else {
        const match = type === "click" ? { text: text.trim() } : type === "page" ? { page: destination } : chosen?.id ? { id: chosen.id } : chosen?.name ? { name: chosen.name } : { action: chosen?.action };
        const fallback = type === "click" ? text.trim() : type === "page" ? pageLabel(destination) : formLabel(chosen);
        await api.addGoal(siteKey, { type, name: (name.trim() || fallback).slice(0, 60), match, target: aim.target, pages: scoped && page ? [page] : [] });
      }
      if (active.current) { if (router.canGoBack()) router.back(); else router.replace({ pathname: "/goals", params: { site: siteKey, page } }); }
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : "The goal wasn't saved. Try again."); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={insets.top + 56 + (Platform.OS === "android" ? insets.bottom : 0)}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{goal ? "Edit goal" : "Add goal"}</Text>
      {goal ? <View style={styles.panel}><Text style={styles.text}>{describeGoal(goal)}</Text><Text style={styles.muted}>{goal.pages.length ? `Counts on ${goal.pages.map(pagePath).join(", ")}` : "Counts on all pages"}</Text></View> : <>
        <Text style={styles.heading}>What should visitors do?</Text>
        {([{ type: "click", label: "Click a button or link" }, { type: "page", label: "Go on to a page" }, { type: "form", label: `Send a form${list.form_goals ? "" : " (Ultra)"}` }] as const).map(choice => <Pressable key={choice.type} accessibilityRole="radio" accessibilityState={{ checked: type === choice.type, disabled: busy || (choice.type === "form" && !list.form_goals) }} disabled={busy || (choice.type === "form" && !list.form_goals)} style={[styles.panel, { paddingVertical: 12, borderColor: choice.type === type ? colors.accent : colors.line, opacity: choice.type === "form" && !list.form_goals ? 0.5 : 1 }]} onPress={() => setType(choice.type)}><Text style={type === choice.type ? styles.link : styles.text}>{choice.label}</Text></Pressable>)}
        {type === "click" ? <><Text style={styles.text}>Button or link text</Text><TextInput accessibilityLabel="Button or link text" value={text} onChangeText={setText} editable={!busy} maxLength={80} style={styles.input} placeholder="Start free trial" placeholderTextColor={colors.muted} /><Text style={styles.muted}>Matches this text exactly, ignoring case and extra spaces.</Text></> : type === "page" ? <>
          <Text style={styles.text}>Destination page</Text>
          {pages.error ? <InlineFailure message={pages.error} retry={pages.reload} /> : pages.loading ? <Text style={styles.muted}>Loading pages…</Text> : pages.data?.length ? <ChoicePicker label="Destination page" value={destination} disabled={busy} choices={pages.data.map(value => ({ key: value.page, label: pageLabel(value.page), detail: value.page }))} onChange={setDestination} /> : <Text style={styles.muted}>No pages tracked yet. Install the tracking code and visit your website first.</Text>}
        </> : <>
          <Text style={styles.text}>Form sent in the last 30 days</Text>
          {forms.error ? <InlineFailure message={forms.error} retry={forms.reload} /> : forms.loading ? <Text style={styles.muted}>Loading forms…</Text> : forms.data?.length ? <ChoicePicker label="Form" value={form} disabled={busy} choices={forms.data.map(value => ({ key: formKey(value), label: formLabel(value), detail: `Sent ${value.sent.toLocaleString()} times · ${pagePath(value.page)}` }))} onChange={setForm} /> : <Text style={styles.muted}>No forms sent in the last 30 days. Send the form on your website first.</Text>}
        </>}
        {page ? <View style={styles.panel}><Text style={styles.text}>Where should it count?</Text>{[true, false].map(value => <Pressable key={String(value)} accessibilityRole="radio" accessibilityState={{ checked: scoped === value }} disabled={busy} onPress={() => setScoped(value)} style={{ paddingVertical: 12 }}><Text style={scoped === value ? styles.link : styles.text}>{value ? `Only ${pagePath(page)}` : "All pages"}{scoped === value ? " · Selected" : ""}</Text></Pressable>)}</View> : <Text style={styles.muted}>This goal counts across all pages. Add it from a page's overview to count only on that page.</Text>}
      </>}
      <Text style={styles.text}>Goal name{goal ? "" : " (optional)"}</Text>
      <TextInput accessibilityLabel="Goal name" value={name} onChangeText={setName} editable={!busy} maxLength={60} style={styles.input} placeholder={goal ? "Goal name" : "Uses the button, form or page name"} placeholderTextColor={colors.muted} />
      <Text style={styles.text}>Target (% of visits, optional)</Text>
      <TextInput accessibilityLabel="Target, percent of visits" value={target} onChangeText={setTarget} editable={!busy} maxLength={12} keyboardType="decimal-pad" style={styles.input} placeholder="5" placeholderTextColor={colors.muted} />
      <Text style={styles.muted}>Leave blank to have no target.</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, { opacity: busy ? 0.5 : 1 }]} onPress={save}><Text style={styles.buttonText}>{busy ? "Saving…" : goal ? "Save goal" : "Add goal"}</Text></Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}

export default function GoalScreen() {
  const params = useLocalSearchParams<{ site?: string | string[]; page?: string | string[]; id?: string | string[] }>();
  const siteKey = typeof params.site === "string" ? params.site : "";
  const page = typeof params.page === "string" ? params.page : "";
  const id = typeof params.id === "string" ? params.id : "";
  const { account } = useSite();
  const { styles } = useTheme();
  const api = useApi();
  const owned = account.sites.some(value => value.key === siteKey);
  const result = useLoad(async () => { if (!owned) throw new Error("Choose one of your websites."); return api.goals(siteKey); }, [api, siteKey, owned]);
  if (result.error) return <Failure message={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  const goal = result.data.goals.find(value => value.id === id);
  if (id && !goal) return <Failure message="That goal is no longer available." retry={() => router.replace({ pathname: "/goals", params: { site: siteKey, page } })} />;
  if (!id && result.data.goals.length >= result.data.cap) return <Failure message="Remove a goal before adding another." retry={() => router.replace({ pathname: "/goals", params: { site: siteKey, page } })} />;
  return <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}><GoalForm key={`${siteKey}:${page}:${id}`} siteKey={siteKey} page={page} goal={goal} list={result.data} /></SafeAreaView>;
}
