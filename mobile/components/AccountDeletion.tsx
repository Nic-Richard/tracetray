import { useRef, useState } from "react";
import { useClerk } from "@clerk/expo";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DELETION_DETAILS, deletionMessage, type AccountDeletionStatus } from "@tracetray/shared";
import { useApi } from "../lib/api";
import { useTheme } from "../lib/theme";
import { useLoad } from "../lib/useLoad";

export default function AccountDeletion({
  requested = false,
  onRequested,
}: {
  requested?: boolean;
  onRequested?: () => void;
}) {
  const api = useApi();
  const { signOut } = useClerk();
  const { styles, colors } = useTheme();
  const status = useLoad(() => api.accountDeletion(), [api]);
  const [saved, setSaved] = useState<AccountDeletionStatus | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const state = saved?.state || status.data?.state || (requested ? "pending" : "none");
  const closing = requested || state !== "none";
  async function remove() {
    if (pending.current || confirmation !== "DELETE") return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      setSaved(await api.deleteAccount(confirmation));
      onRequested?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your request. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <SafeAreaView
      style={styles.screen}
      edges={requested ? ["top", "left", "right", "bottom"] : ["left", "right", "bottom"]}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{closing ? "Account deletion" : "Delete your account"}</Text>
        {closing ? (
          <Text style={styles.text} accessibilityRole="alert">
            {deletionMessage(state)}
          </Text>
        ) : (
          DELETION_DETAILS.map(text => (
            <Text key={text} style={styles.text}>
              {text}
            </Text>
          ))
        )}
        {status.error ? <Text style={styles.error}>{status.error}</Text> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {!closing ? (
          <>
            <Text style={styles.muted}>Type DELETE to confirm permanent deletion.</Text>
            <TextInput
              accessibilityLabel="Deletion confirmation"
              value={confirmation}
              onChangeText={setConfirmation}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || confirmation !== "DELETE" || !status.data}
              onPress={remove}
              style={[
                styles.button,
                {
                  backgroundColor: colors.danger,
                  opacity: busy || confirmation !== "DELETE" || !status.data ? 0.5 : 1,
                },
              ]}
            >
              <Text style={styles.buttonText}>{busy ? "Saving request…" : "Permanently delete account"}</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSaved(null);
            status.reload();
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Check status</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            signOut().catch(() => setError("Couldn't sign out. Try again."));
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
