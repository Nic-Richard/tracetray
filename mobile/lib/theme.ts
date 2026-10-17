import { useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";

const light = {
  ink: "#1c2030", muted: "#646a80", canvas: "#eef1f6", panel: "#ffffff",
  line: "#dfe3ec", accent: "#3f3fc4", danger: "#b4233a", good: "#0d8a6a", rail: "#1c2030"
};
const dark = {
  ink: "#eceef4", muted: "#9aa0b4", canvas: "#11131b", panel: "#1a1d28",
  line: "#2b2f3e", accent: "#a9a9ff", danger: "#f07a8c", good: "#45d0a5", rail: "#0c0e15"
};

export function useTheme() {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? dark : light;
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    content: { padding: 20, gap: 20, flexGrow: 1 },
    center: { flex: 1, padding: 24, gap: 16, justifyContent: "center", alignItems: "center", backgroundColor: colors.canvas },
    title: { fontFamily: "InstrumentSans_700Bold", fontSize: 30, color: colors.ink, letterSpacing: -0.6 },
    heading: { fontFamily: "InstrumentSans_600SemiBold", fontSize: 20, color: colors.ink },
    text: { fontFamily: "InstrumentSans_400Regular", fontSize: 16, lineHeight: 24, color: colors.ink },
    muted: { fontFamily: "InstrumentSans_400Regular", fontSize: 14, lineHeight: 21, color: colors.muted },
    number: { fontFamily: "InstrumentSans_700Bold", fontSize: 26, color: colors.ink, fontVariant: ["tabular-nums"] },
    error: { fontFamily: "InstrumentSans_400Regular", fontSize: 15, lineHeight: 22, color: colors.danger },
    panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 14, padding: 18, gap: 10 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    input: { minHeight: 48, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 14, color: colors.ink, fontFamily: "InstrumentSans_400Regular", fontSize: 16 },
    button: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.rail, justifyContent: "center", alignItems: "center" },
    buttonText: { fontFamily: "InstrumentSans_600SemiBold", fontSize: 16, color: "#ffffff" },
    link: { fontFamily: "InstrumentSans_600SemiBold", fontSize: 15, color: colors.accent },
    separator: { height: 10 },
    stat: { flex: 1, minWidth: 100, gap: 5 },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 18 }
  }), [colors]);
  return { colors, styles, dark: scheme === "dark" };
}
