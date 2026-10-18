import { Pressable, Text, View } from "react-native";
import { useTheme } from "../lib/theme";
import Icon, { type IconName } from "./Icon";

export default function ActionRow({ icon, title, detail, onPress }: { icon: IconName; title: string; detail?: string; onPress: () => void }) {
  const { styles, colors } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}>
    <View style={styles.iconTile}><Icon name={icon} color={colors.accent} /></View>
    <View style={{ flex: 1, gap: 3 }}><Text style={styles.actionTitle}>{title}</Text>{detail ? <Text style={styles.muted}>{detail}</Text> : null}</View>
    <Icon name="arrow" size={17} />
  </Pressable>;
}
