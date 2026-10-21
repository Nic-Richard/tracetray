import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Site } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useTheme } from "../../../lib/theme";

function WebsiteRow({
  site,
  disabled,
  saving,
  rename,
  remove,
}: {
  site: Site;
  disabled: boolean;
  saving: boolean;
  rename: (name: string) => Promise<boolean>;
  remove: () => void;
}) {
  const { styles, colors } = useTheme();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.name);
  return (
    <View style={styles.panel}>
      {editing ? (
        <>
          <Text style={styles.text}>Website name</Text>
          <TextInput
            accessibilityLabel={`Rename ${site.name}`}
            value={name}
            onChangeText={setName}
            maxLength={80}
            editable={!disabled}
            style={styles.input}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              if (name.trim())
                rename(name.trim()).then(ok => {
                  if (ok) setEditing(false);
                });
            }}
          />
          <View style={styles.wrap}>
            <Pressable
              accessibilityRole="button"
              disabled={disabled || !name.trim()}
              style={[styles.button, { opacity: disabled || !name.trim() ? 0.5 : 1 }]}
              onPress={async () => {
                if (await rename(name.trim())) setEditing(false);
              }}
            >
              <Text style={styles.buttonText}>{saving ? "Saving…" : "Save name"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              style={{ padding: 12 }}
              onPress={() => setEditing(false)}
            >
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.heading}>{site.name}</Text>
          <Text style={styles.muted}>{site.domain || site.url || "Waiting for visits"}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => router.push({ pathname: "/installation", params: { site: site.key } })}
            style={{ paddingVertical: 12 }}
          >
            <Text style={styles.link}>Installation code</Text>
          </Pressable>
          <View style={styles.wrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Rename ${site.name}`}
              disabled={disabled}
              onPress={() => {
                setName(site.name);
                setEditing(true);
              }}
              style={{ paddingVertical: 12 }}
            >
              <Text style={styles.link}>Rename</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${site.name}`}
              disabled={disabled}
              onPress={remove}
              style={{ paddingVertical: 12 }}
            >
              <Text style={[styles.link, { color: colors.danger }]}>{saving ? "Removing…" : "Remove"}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

export default function WebsitesScreen() {
  const api = useApi();
  const { account, updateSites } = useSite();
  const { styles, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function change(key: string, action: () => Promise<void>): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    setBusy(key);
    Keyboard.dismiss();
    try {
      await action();
      return true;
    } catch (error) {
      if (active.current)
        Alert.alert("Couldn't update your websites", error instanceof Error ? error.message : "Try again.");
      return false;
    } finally {
      pending.current = false;
      if (active.current) setBusy("");
    }
  }
  function remove(site: Site) {
    Alert.alert(
      `Remove ${site.name}?`,
      "This permanently deletes all of its visits, analyses, reports and pictures. This can't be undone." +
        (account.sites.length === 1
          ? " Your last website is replaced with a new, empty website and a new installation key."
          : ""),
      [
        { text: "Keep website", style: "cancel" },
        {
          text: "Remove and delete data",
          style: "destructive",
          onPress: () => {
            change(site.key, async () => {
              updateSites(await api.deleteSite(site.key));
            });
          },
        },
      ],
    );
  }
  const atLimit = account.sites.length >= account.site_limit;
  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top + 56 + (Platform.OS === "android" ? insets.bottom : 0)}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>
            {account.sites.length} of {account.site_limit} websites
          </Text>
          {account.sites.map(site => (
            <WebsiteRow
              key={site.key}
              site={site}
              disabled={!!busy}
              saving={busy === site.key}
              remove={() => remove(site)}
              rename={name =>
                change(site.key, async () => {
                  updateSites(await api.renameSite(site.key, name));
                })
              }
            />
          ))}
          <View style={styles.panel}>
            <Text style={styles.heading}>Add a website</Text>
            {atLimit ? (
              <Text style={styles.muted}>
                Your plan allows {account.site_limit} websites. Remove one to add another.
              </Text>
            ) : (
              <>
                <Text style={styles.text}>Website name</Text>
                <TextInput
                  accessibilityLabel="New website name"
                  value={name}
                  onChangeText={setName}
                  maxLength={80}
                  editable={!busy}
                  style={styles.input}
                  placeholder="My website"
                  placeholderTextColor={colors.muted}
                />
                <Text style={styles.text}>Website URL (optional)</Text>
                <TextInput
                  accessibilityLabel="Website URL (optional)"
                  value={url}
                  onChangeText={setUrl}
                  maxLength={500}
                  editable={!busy}
                  style={styles.input}
                  placeholder="https://example.com"
                  placeholderTextColor={colors.muted}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!!busy || !name.trim()}
                  style={[styles.button, { opacity: busy || !name.trim() ? 0.5 : 1 }]}
                  onPress={() => {
                    change("add", async () => {
                      const result = await api.createSite(name.trim(), url.trim() || undefined);
                      updateSites(result, result.site.key);
                      if (!active.current) return;
                      setName("");
                      setUrl("");
                      router.push({ pathname: "/installation", params: { site: result.site.key } });
                    });
                  }}
                >
                  <Text style={styles.buttonText}>{busy === "add" ? "Adding…" : "Add website"}</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
