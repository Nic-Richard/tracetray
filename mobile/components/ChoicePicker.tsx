import { useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme";

export default function ChoicePicker({ label, value, choices, onChange, disabled }: {
  label: string; value: string; choices: { key: string; label: string; detail?: string }[]; onChange: (key: string) => void; disabled?: boolean;
}) {
  const { styles, colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = choices.find(item => item.key === value);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label || "Choose"}`} disabled={disabled} style={[styles.panel, { padding: 12 }]} onPress={() => { setQuery(""); setOpen(true); }}><Text style={styles.link}>{selected?.label || `Choose ${label.toLowerCase()}`}</Text>{selected?.detail ? <Text style={styles.muted}>{selected.detail}</Text> : null}</Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.screen}>
        <View style={[styles.content, { flexGrow: 0 }]}>
          <View style={styles.row}><Text style={[styles.heading, { flex: 1 }]}>{label}</Text><Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={() => setOpen(false)}><Text style={styles.link}>Cancel</Text></Pressable></View>
          <TextInput accessibilityLabel={`Search ${label.toLowerCase()}`} style={styles.input} value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
        </View>
        <FlatList data={choices.filter(item => `${item.label} ${item.detail || ""}`.toLowerCase().includes(query.trim().toLowerCase()))} keyExtractor={item => item.key} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 10 }} ListEmptyComponent={<Text style={styles.muted}>No matching choices.</Text>} renderItem={({ item }) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: item.key === value }} style={[styles.panel, { borderColor: item.key === value ? colors.accent : colors.line }]} onPress={() => { onChange(item.key); setOpen(false); }}><Text style={styles.text}>{item.label}</Text>{item.detail ? <Text style={styles.muted}>{item.detail}</Text> : null}</Pressable>} />
      </SafeAreaView>
    </Modal>
  </>;
}
