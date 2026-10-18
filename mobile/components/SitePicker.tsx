import { useState } from "react";
import { router } from "expo-router";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSite } from "../lib/site";
import { useTheme } from "../lib/theme";

export default function SitePicker() {
  const { account, site, selectSite } = useSite();
  const { styles, colors } = useTheme();
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Website: ${site?.name || "Choose website"}`} onPress={() => setOpen(true)} style={[styles.panel, styles.row]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.heading} numberOfLines={1}>{site?.name || "Choose website"}</Text>
        {site?.domain || site?.url ? <Text style={styles.muted} numberOfLines={1}>{site.domain || site.url}</Text> : null}
      </View>
      <Text style={styles.link}>Switch</Text>
    </Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.screen}>
        <View style={[styles.content, { flexGrow: 0 }]}>
          <View style={styles.row}>
            <Text style={styles.title}>Your websites</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close website picker" onPress={() => setOpen(false)} style={{ paddingVertical: 12 }}><Text style={styles.link}>Done</Text></Pressable>
          </View>
        </View>
        <FlatList data={account.sites} keyExtractor={item => item.key} contentContainerStyle={{ padding: 20, gap: 10 }} ListFooterComponent={<Pressable accessibilityRole="button" style={styles.button} onPress={() => { setOpen(false); router.push("/websites"); }}><Text style={styles.buttonText}>Manage websites</Text></Pressable>} renderItem={({ item }) =>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: item.key === site?.key }} onPress={() => { selectSite(item.key); setOpen(false); }}
            style={[styles.panel, { borderColor: item.key === site?.key ? colors.accent : colors.line }]}>
            <Text style={styles.heading}>{item.name}</Text>
            <Text style={styles.muted}>{item.domain || item.url || "Waiting for visits"}</Text>
          </Pressable>
        } />
      </SafeAreaView>
    </Modal>
  </>;
}
