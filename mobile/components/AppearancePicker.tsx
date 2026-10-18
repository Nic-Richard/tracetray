import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAppearance, type AppearancePreference } from "../lib/appearance";
import { useTheme } from "../lib/theme";

export default function AppearancePicker() {
  const { preference, setPreference } = useAppearance();
  const { styles, colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function choose(value: AppearancePreference) {
    if (busy) return;
    setBusy(true); setError("");
    try { await setPreference(value); }
    catch { setError("Couldn't save your appearance. Try again."); }
    finally { setBusy(false); }
  }
  return <View style={styles.panel}>
    <Text style={styles.heading}>Appearance</Text>
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8 }}>
      {(["system", "light", "dark"] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: preference === value, disabled: busy }} disabled={busy} onPress={() => choose(value)} style={[styles.secondaryButton, { flex: 1, paddingHorizontal: 8, backgroundColor: preference === value ? colors.accentSoft : colors.panel, borderColor: preference === value ? colors.accent : colors.line }]}><Text style={preference === value ? styles.link : styles.muted}>{value === "system" ? "System" : value === "light" ? "Light" : "Dark"}</Text></Pressable>)}
    </View>
    <Text style={styles.muted}>System follows your phone's appearance.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}
