import { Text, View } from "react-native";
import { findingGroupNote, findingScope, type ChangeFinding } from "@tracetray/shared";
import { useTheme } from "../lib/theme";

export default function FindingEvidence({ finding }: { finding: ChangeFinding }) {
  const { styles } = useTheme();
  return <View style={styles.panel}>
    <Text style={styles.heading}>Original finding</Text>
    <Text style={styles.text}>{finding.evidence}</Text>
    <Text style={styles.muted}>{findingScope(finding)}</Text>
    <Text style={styles.muted}>Analysis saved {finding.ran_at.slice(0, 10)} (UTC). Group: {finding.group}.</Text>
    {findingGroupNote(finding) ? <Text style={styles.muted}>{findingGroupNote(finding)}</Text> : null}
    <Text style={styles.text}>Change to try: {finding.action}</Text>
    <Text style={styles.muted}>This is a suggestion, not an explanation of what caused the finding.</Text>
  </View>;
}
