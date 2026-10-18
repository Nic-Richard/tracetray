import { useState } from "react";
import { router } from "expo-router";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSite } from "../lib/site";
import { useTheme } from "../lib/theme";
import Icon from "./Icon";

export default function SitePicker({ siteKey, onSelect }: { siteKey?: string; onSelect?: (key: string) => void }) {
  const { account, site: selected, selectSite } = useSite();
  const site = siteKey ? account.sites.find(value => value.key === siteKey) || selected : selected;
  const { styles, colors } = useTheme();
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Website: ${site?.name || "Choose website"}`} accessibilityHint="Opens your website picker" onPress={() => setOpen(true)} style={({ pressed }) => [styles.panel, styles.row, { padding: 14 }, pressed && styles.pressed]}>
      <View style={styles.iconTile}><Icon name="pages" color={colors.accent} size={20} /></View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.actionTitle} numberOfLines={1}>{site?.name || "Choose website"}</Text>
        {site?.domain || site?.url ? <Text style={styles.muted} numberOfLines={1}>{site.domain || site.url}</Text> : null}
      </View>
      <Icon name="chevron" size={18} />
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close website picker" onPress={() => setOpen(false)} style={{ flex: 1 }} />
      <SafeAreaView edges={["left", "right", "bottom"]} style={{ maxHeight: "85%", backgroundColor: colors.panel, borderTopLeftRadius: 26, borderTopRightRadius: 26 }}>
        <View style={[styles.content, { flexGrow: 0 }]}>
          <View style={styles.row}>
            <Text style={styles.heading}>Your websites</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close website picker" onPress={() => setOpen(false)} style={{ paddingVertical: 12 }}><Text style={styles.link}>Done</Text></Pressable>
          </View>
        </View>
        <FlatList data={account.sites} keyExtractor={item => item.key} contentContainerStyle={{ padding: 20, paddingTop: 0, gap: 10 }} ListFooterComponent={<Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => { setOpen(false); router.push("/websites"); }}><Text style={styles.link}>Manage websites</Text></Pressable>} renderItem={({ item }) =>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: item.key === site?.key }} onPress={() => { selectSite(item.key); setOpen(false); onSelect?.(item.key); }}
            style={[styles.panel, styles.row, { borderColor: item.key === site?.key ? colors.accent : colors.line, backgroundColor: item.key === site?.key ? colors.accentSoft : colors.panel }]}>
            <View style={{ flex: 1, gap: 4 }}><Text style={styles.actionTitle}>{item.name}</Text><Text style={styles.muted}>{item.domain || item.url || "Waiting for visits"}</Text></View>
            {item.key === site?.key ? <Icon name="check" color={colors.accent} /> : null}
          </Pressable>
        } />
      </SafeAreaView>
      </View>
    </Modal>
  </>;
}
