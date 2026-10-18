import { useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import { useAppearance } from "./appearance";

const light = {
  ink: "#1c2030", muted: "#646a80", canvas: "#eef1f6", panel: "#ffffff",
  line: "#dfe3ec", accent: "#3f3fc4", accentSoft: "#ededff", primary: "#1c2030", primaryInk: "#ffffff", subtle: "#f7f8fb", danger: "#b4233a", good: "#0d8a6a", rail: "#1c2030",
  groups: ["#5457e0", "#0e9d8b", "#d98b17", "#d43f78", "#8a52d6", "#2f86d1", "#8a90a3"]
};
const dark = {
  ink: "#eceef4", muted: "#9aa0b4", canvas: "#11131b", panel: "#1a1d28",
  line: "#2b2f3e", accent: "#a9a9ff", accentSoft: "#2a2946", primary: "#eceef4", primaryInk: "#11131b", subtle: "#151821", danger: "#f07a8c", good: "#45d0a5", rail: "#0c0e15",
  groups: ["#8a8cff", "#2fd0b9", "#f5b64a", "#f06d9c", "#b088ff", "#6cb4ff", "#8b92a8"]
};

export function useTheme() {
  const system = useColorScheme();
  const { preference } = useAppearance();
  const scheme = preference === "system" ? system : preference;
  const colors = scheme === "dark" ? dark : light;
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    content: { padding: 20, paddingBottom: 28, gap: 20, flexGrow: 1, width: "100%", maxWidth: 760, alignSelf: "center" },
    center: { flex: 1, padding: 24, gap: 16, justifyContent: "center", alignItems: "center", backgroundColor: colors.canvas },
    title: { fontFamily: "InstrumentSans_700Bold", fontSize: 28, lineHeight: 35, color: colors.ink, letterSpacing: -0.6 },
    heading: { fontFamily: "InstrumentSans_600SemiBold", fontSize: 19, color: colors.ink, letterSpacing: -0.3 },
    wordmark: { fontFamily: "InstrumentSans_700Bold", fontSize: 22, color: colors.ink, letterSpacing: -0.7 },
    eyebrow: { fontFamily: "InstrumentSans_600SemiBold", fontSize: 12, lineHeight: 18, letterSpacing: 1.3, textTransform: "uppercase", color: colors.muted },
    actionTitle: { fontFamily: "InstrumentSans_600SemiBold", fontSize: 16, lineHeight: 22, color: colors.ink },
    text: { fontFamily: "InstrumentSans_400Regular", fontSize: 16, lineHeight: 24, color: colors.ink },
    muted: { fontFamily: "InstrumentSans_400Regular", fontSize: 14, lineHeight: 21, color: colors.muted },
    number: { fontFamily: "InstrumentSans_600SemiBold", fontSize: 30, color: colors.ink, letterSpacing: -0.8, fontVariant: ["tabular-nums"] },
    error: { fontFamily: "InstrumentSans_400Regular", fontSize: 15, lineHeight: 22, color: colors.danger },
    panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    input: { minHeight: 52, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 13, paddingHorizontal: 14, color: colors.ink, fontFamily: "InstrumentSans_400Regular", fontSize: 16 },
    button: { minHeight: 50, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 10, backgroundColor: colors.primary, justifyContent: "center", alignItems: "center" },
    secondaryButton: { minHeight: 50, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 10, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, justifyContent: "center", alignItems: "center" },
    buttonText: { fontFamily: "InstrumentSans_600SemiBold", fontSize: 16, color: colors.primaryInk },
    link: { fontFamily: "InstrumentSans_600SemiBold", fontSize: 15, color: colors.accent },
    separator: { height: 10 },
    stat: { flex: 1, minWidth: 100, gap: 5 },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
    pressed: { opacity: 0.65 },
    iconTile: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.accentSoft, justifyContent: "center", alignItems: "center" },
    actionRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
    divider: { height: 1, backgroundColor: colors.line },
    badge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.accentSoft },
    search: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 50, borderRadius: 13, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
    searchInput: { flex: 1, minHeight: 50, paddingVertical: 10, fontFamily: "InstrumentSans_400Regular", fontSize: 16, color: colors.ink }
  }), [colors]);
  return { colors, styles, dark: scheme === "dark" };
}
