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
import { changeDayError, pageLabel, pagePath, type PageChange } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";
import { Failure, Loading } from "../../../components/Status";
import ChangeComparison from "../../../components/ChangeComparison";

export default function ChangesScreen() {
  const params = useLocalSearchParams<{ site?: string | string[]; page?: string | string[] }>();
  const siteKey = typeof params.site === "string" ? params.site : "";
  const page = typeof params.page === "string" ? params.page : "";
  const { account } = useSite();
  const site = account.sites.find(value => value.key === siteKey);
  const api = useApi();
  const { styles, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const changes = useLoad(() => {
    if (!site || !page) throw new Error("Choose a page from one of your websites.");
    return api.pageChanges(site.key, page);
  }, [api, site?.key, page]);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const list = changes.data || [];
  const current = list.find(value => value.id === selected) || list[0];
  async function save() {
    if (pending.current || !site) return;
    const validation = changeDayError(day);
    if (validation) {
      setError(validation);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const added = await api.addPageChange(site.key, { page, day, note: note.trim() });
      changes.setData(values => [added, ...(values || [])].sort((a, b) => b.day.localeCompare(a.day)));
      setSelected(added.id);
      setNote("");
      setAdding(false);
      Keyboard.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the change.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function confirmRemove(change: PageChange) {
    Alert.alert(
      "Remove this change?",
      `${change.day}: ${change.note || "Change marked"}. This removes the note and keeps your visit history.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void remove(change.id);
          },
        },
      ],
    );
  }
  async function remove(id: string) {
    if (pending.current || !site) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api.deletePageChange(site.key, id);
      changes.setData(values => values?.filter(value => value.id !== id) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the change.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (changes.error) return <Failure message={changes.error} retry={changes.reload} />;
  if (!changes.data) return <Loading message="Loading changes…" />;
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
              refreshing={changes.loading}
              enabled={!busy}
              onRefresh={() => {
                if (!pending.current) changes.reload();
              }}
              tintColor={colors.accent}
            />
          }
        >
          <View style={{ gap: 6 }}>
            <Text style={styles.muted}>{site?.name}</Text>
            <Text style={styles.title}>Before and after</Text>
            <Text style={styles.text}>{pageLabel(page)}</Text>
            <Text style={styles.muted}>{pagePath(page)}</Text>
          </View>
          <Text style={styles.muted}>
            Mark the day you changed this page. TraceTray compares equal periods on either side, up to 14 days each. A
            comparison shows what changed, not what caused it.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            disabled={busy}
            onPress={() => {
              setAdding(value => !value);
              setError("");
            }}
          >
            <Text style={styles.buttonText}>{adding ? "Cancel new change" : "Mark a change"}</Text>
          </Pressable>
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {adding ? (
            <View style={styles.panel}>
              <Text style={styles.text}>Day you changed it (UTC)</Text>
              <TextInput
                accessibilityLabel="Change date"
                value={day}
                onChangeText={setDay}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                maxLength={10}
                editable={!busy}
                style={styles.input}
              />
              <Text style={styles.text}>What changed (optional)</Text>
              <TextInput
                accessibilityLabel="Change note"
                value={note}
                onChangeText={setNote}
                placeholder="New product photos"
                placeholderTextColor={colors.muted}
                maxLength={120}
                editable={!busy}
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                style={[styles.button, { opacity: busy ? 0.5 : 1 }]}
                onPress={save}
              >
                <Text style={styles.buttonText}>{busy ? "Saving…" : "Save change"}</Text>
              </Pressable>
            </View>
          ) : null}
          {list.length ? (
            <View style={styles.panel}>
              <Text style={styles.heading}>Marked changes</Text>
              {list.map(change => (
                <View key={change.id} style={{ gap: 6 }}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: current?.id === change.id }}
                    disabled={busy}
                    style={{ paddingVertical: 12 }}
                    onPress={() => setSelected(change.id)}
                  >
                    <Text style={current?.id === change.id ? styles.link : styles.text}>
                      {change.day} · {change.note || "Change marked"}
                      {current?.id === change.id ? " · Selected" : ""}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove change ${change.day}: ${change.note || "Change marked"}`}
                    disabled={busy}
                    style={{ paddingVertical: 10 }}
                    onPress={() => confirmRemove(change)}
                  >
                    <Text style={[styles.link, { color: colors.danger }]}>Remove change</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>Changed something on this page? Mark the day to start a comparison.</Text>
          )}
          {current && site ? (
            <ChangeComparison
              key={`${site.key}:${page}:${current.day}`}
              site={site.key}
              page={page}
              day={current.day}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
