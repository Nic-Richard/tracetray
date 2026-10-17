import { Text, View } from "react-native";
import { traitRows, type Trait } from "@tracetray/shared";
import { useTheme } from "../lib/theme";

export default function TraitBars({ traits, color }: { traits: Trait[]; color: string }) {
  const { colors, styles } = useTheme();
  const rows = traitRows(traits);
  if (!rows.length) return null;
  return <View style={{ gap: 18 }}>
    <Text style={styles.text}>Against the page average</Text>
    {rows.map(row => <View key={row.feature} style={{ gap: 8 }} accessible
      accessibilityLabel={`${row.label}: ${row.value}, average ${row.average}. They ${row.description}.`}>
      <Text style={styles.muted}>{row.label}</Text>
      <Text style={styles.muted}><Text style={{ color: colors.ink, fontFamily: "InstrumentSans_600SemiBold" }}>{row.value}</Text> vs {row.average}</Text>
      <View style={{ height: 8, backgroundColor: colors.line, borderRadius: 4 }}>
        <View style={{ height: 8, width: `${row.valuePosition * 100}%`, backgroundColor: color, borderRadius: 4 }} />
        <View style={{ position: "absolute", top: -2, bottom: -2, width: 2, marginLeft: -1, left: `${row.averagePosition * 100}%`, backgroundColor: colors.muted }} />
        <View style={{ position: "absolute", top: -2, bottom: -2, width: 2, marginLeft: -1, left: `${row.valuePosition * 100}%`, backgroundColor: colors.ink }} />
      </View>
    </View>)}
  </View>;
}
