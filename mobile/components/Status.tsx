import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

export function Loading({ message = "Loading…" }: { message?: string }) {
  const { colors, styles } = useTheme();
  return <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{message}</Text></View>;
}

export function Failure({ message, retry }: { message: string; retry: () => void }) {
  const { styles } = useTheme();
  return <View style={styles.center}>
    <Text style={styles.heading}>Couldn't load TraceTray</Text>
    <Text style={styles.error} accessibilityRole="alert">{message}</Text>
    <Pressable accessibilityRole="button" style={styles.button} onPress={retry}><Text style={styles.buttonText}>Try again</Text></Pressable>
  </View>;
}
