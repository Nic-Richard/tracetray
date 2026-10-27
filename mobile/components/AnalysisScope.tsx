import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { analysisPeriod, analysisScope, deviceAnalysis, type AnalysisResult, type Device } from "@tracetray/shared";
import { useTheme } from "../lib/theme";

export default function AnalysisScope({ result, device }: { result: AnalysisResult; device: Device }) {
  const [expanded, setExpanded] = useState(false);
  const { styles } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.muted}>{(deviceAnalysis(result, device)?.session_count || 0).toLocaleString()} {device} visits · {analysisPeriod(result, device)}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ paddingVertical: 12 }}>
        <Text style={styles.link}>{expanded ? "Hide scope and exclusions" : "Scope and exclusions"}</Text>
      </Pressable>
      {expanded ? <Text style={styles.muted}>{analysisScope(result, device)}</Text> : null}
    </View>
  );
}
