import { useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  pageLabel,
  pagePath,
  pathInputError,
  pathStepStats,
  percent,
  PATH_MAX_STEPS,
  PATH_MIN_STEPS,
  type PathFunnel,
} from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";
import { Failure, Loading } from "../../../components/Status";
import ChoicePicker from "../../../components/ChoicePicker";

function Funnel({ path, busy, remove }: { path: PathFunnel; busy: boolean; remove: () => void }) {
  const { styles, colors } = useTheme();
  const first = path.steps[0]?.all || 0;
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>{path.name}</Text>
      <Text style={styles.muted}>Journeys in the last {path.days} days</Text>
      {!first ? <Text style={styles.muted}>No journeys have reached the first step in this period.</Text> : null}
      {path.steps.map((step, index) => {
        const stats = pathStepStats(path.steps, index);
        return (
          <View key={`${index}:${step.page}`} style={{ gap: 8, paddingVertical: 10 }}>
            <Text style={styles.text}>
              {index + 1}. {pageLabel(step.page)}
            </Text>
            <Text style={styles.muted}>{pagePath(step.page)}</Text>
            <View style={styles.row}>
              <Text style={[styles.text, { flex: 1 }]}>{step.all.toLocaleString()} journeys</Text>
              <Text style={styles.muted}>{percent(stats.fromStart)} of the start</Text>
            </View>
            <View
              style={{ height: 8, backgroundColor: colors.canvas, borderRadius: 4 }}
              accessibilityRole="progressbar"
              accessibilityLabel={`Step ${index + 1}: ${pageLabel(step.page)}`}
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round((stats.fromStart || 0) * 100),
                text: first ? percent(stats.fromStart) : "No journeys",
              }}
            >
              <View
                style={{
                  width: `${(stats.fromStart || 0) * 100}%`,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.groups[5],
                }}
              />
            </View>
            <Text style={styles.muted}>
              Desktop {step.desktop.toLocaleString()} · Phones {step.mobile.toLocaleString()}
            </Text>
            {index > 0 ? (
              <Text style={styles.muted}>
                {stats.fromPrevious === null
                  ? "No journeys reached the previous step."
                  : `${percent(stats.fromPrevious)} of the previous step · ${stats.lost.toLocaleString()} didn't reach this step`}
              </Text>
            ) : null}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove path ${path.name}`}
        disabled={busy}
        onPress={remove}
        style={{ paddingVertical: 12 }}
      >
        <Text style={[styles.link, { color: colors.danger }]}>Remove path</Text>
      </Pressable>
    </View>
  );
}

export default function PathsScreen() {
  const params = useLocalSearchParams<{ site?: string | string[] }>();
  const siteKey = typeof params.site === "string" ? params.site : "";
  const { account } = useSite();
  const site = account.sites.find(value => value.key === siteKey);
  const api = useApi();
  const { styles, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const list = useLoad(() => {
    if (!site) throw new Error("Choose one of your websites.");
    return api.paths(site.key, days);
  }, [api, site?.key, days]);
  const pages = useLoad(() => {
    if (!site) throw new Error("Choose one of your websites.");
    return api.pages(site.key);
  }, [api, site?.key]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const full = !!list.data && list.data.paths.length >= list.data.cap;
  async function save() {
    if (!site || pending.current || full) return;
    const validation = pathInputError(name, steps);
    if (validation) {
      setError(validation);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.addPath(site.key, { name: name.trim(), steps });
      setAdding(false);
      setName("");
      setSteps(["", ""]);
      setNotice("Funnel saved.");
      Keyboard.dismiss();
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the path.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!site || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.removePath(site.key, id);
      setNotice("Funnel removed. Visit history is kept.");
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the path.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function confirmRemove(path: PathFunnel) {
    Alert.alert("Remove this path?", `${path.name} will be removed. Your visit history is kept.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void remove(path.id);
        },
      },
    ]);
  }
  function move(index: number, direction: -1 | 1) {
    setSteps(values => {
      if (index < 0 || index >= values.length || index + direction < 0 || index + direction >= values.length)
        return values;
      const next = [...values];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }
  if (list.error) return <Failure message={list.error} retry={list.reload} />;
  if (!list.data) return <Loading message="Counting journeys…" />;
  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top + 56 + (Platform.OS === "android" ? insets.bottom : 0)}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={list.loading}
              enabled={!busy}
              onRefresh={() => {
                if (!pending.current) list.reload();
              }}
              tintColor={colors.accent}
            />
          }
        >
          <Text style={styles.muted}>{site?.name}</Text>
          <Text style={styles.title}>Funnels</Text>
          <Text style={styles.text}>
            Choose the pages you expect visitors to go through, in order. Each step counts journeys that reached every
            earlier step first; other pages along the way don't count against them.
          </Text>
          <View style={styles.wrap}>
            {([7, 30, 90] as const).map(value => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={`${value} days`}
                accessibilityState={{ checked: days === value }}
                disabled={busy}
                style={[styles.button, { opacity: days === value ? 1 : 0.65 }]}
                onPress={() => {
                  setDays(value);
                  setError("");
                }}
              >
                <Text style={styles.buttonText}>{value} days</Text>
              </Pressable>
            ))}
          </View>
          {notice ? (
            <Text accessibilityRole="alert" style={[styles.text, { color: colors.good }]}>
              {notice}
            </Text>
          ) : null}
          {error && !adding ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          {!list.data.paths.length ? (
            <Text style={styles.muted}>No funnels yet. Add one to see where journeys drop off.</Text>
          ) : null}
          {full ? (
            <Text style={styles.muted}>
              You can keep {list.data.cap} funnels per website. Remove one before adding another.
            </Text>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                disabled={busy}
                onPress={() => {
                  setAdding(value => !value);
                  setError("");
                }}
              >
                <Text style={styles.buttonText}>{adding ? "Cancel new funnel" : "Add funnel"}</Text>
              </Pressable>
              {adding ? (
                <View style={styles.panel}>
                  <Text style={styles.heading}>New funnel</Text>
                  <TextInput
                    accessibilityLabel="Funnel name"
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    maxLength={60}
                    placeholder="Buying a tent"
                    placeholderTextColor={colors.muted}
                    editable={!busy}
                  />
                  {pages.error ? (
                    <>
                      <Text style={styles.error}>{pages.error}</Text>
                      <Pressable accessibilityRole="button" style={styles.button} onPress={pages.reload}>
                        <Text style={styles.buttonText}>Retry pages</Text>
                      </Pressable>
                    </>
                  ) : !pages.data ? (
                    <Text style={styles.muted}>Loading pages…</Text>
                  ) : !pages.data.length ? (
                    <Text style={styles.muted}>
                      No pages tracked yet. Install the tracking code and visit your website first.
                    </Text>
                  ) : (
                    steps.map((step, index) => (
                      <View key={index} style={{ gap: 8 }}>
                        <Text style={styles.text}>Step {index + 1}</Text>
                        <ChoicePicker
                          label={`Step ${index + 1}`}
                          value={step}
                          disabled={busy}
                          choices={pages
                            .data!.filter(value => value.page === step || !steps.includes(value.page))
                            .map(value => ({
                              key: value.page,
                              label: pageLabel(value.page),
                              detail: pagePath(value.page),
                            }))}
                          onChange={value =>
                            setSteps(values => values.map((current, i) => (i === index ? value : current)))
                          }
                        />
                        <View style={styles.wrap}>
                          {index > 0 ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Move step ${index + 1} up`}
                              disabled={busy}
                              onPress={() => move(index, -1)}
                              style={{ padding: 12 }}
                            >
                              <Text style={styles.link}>Move up</Text>
                            </Pressable>
                          ) : null}
                          {index < steps.length - 1 ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Move step ${index + 1} down`}
                              disabled={busy}
                              onPress={() => move(index, 1)}
                              style={{ padding: 12 }}
                            >
                              <Text style={styles.link}>Move down</Text>
                            </Pressable>
                          ) : null}
                          {steps.length > PATH_MIN_STEPS ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove step ${index + 1}`}
                              disabled={busy}
                              onPress={() =>
                                setSteps(values =>
                                  values.length > PATH_MIN_STEPS ? values.filter((_, i) => i !== index) : values,
                                )
                              }
                              style={{ padding: 12 }}
                            >
                              <Text style={[styles.link, { color: colors.danger }]}>Remove step</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ))
                  )}
                  {pages.data?.length && steps.length < PATH_MAX_STEPS ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      style={styles.button}
                      onPress={() => setSteps(values => (values.length < PATH_MAX_STEPS ? [...values, ""] : values))}
                    >
                      <Text style={styles.buttonText}>Add a step</Text>
                    </Pressable>
                  ) : null}
                  {error ? (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {error}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || !pages.data?.length}
                    style={[styles.button, { opacity: busy || !pages.data?.length ? 0.5 : 1 }]}
                    onPress={save}
                  >
                    <Text style={styles.buttonText}>{busy ? "Saving…" : "Save path"}</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
          {list.data.paths.map(path => (
            <Funnel key={path.id} path={path} busy={busy} remove={() => confirmRemove(path)} />
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
