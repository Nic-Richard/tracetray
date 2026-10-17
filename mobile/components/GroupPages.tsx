import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { MemberSort } from "@tracetray/shared";
import { useApi } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { useTheme } from "../lib/theme";

const PAGE_SIZE = 25;

export default function GroupPages({ page, site }: { page: string; site: string }) {
  const api = useApi();
  const { styles, colors } = useTheme();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState<7 | 30 | null>(30);
  const [sort, setSort] = useState<MemberSort>("sessions");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const result = useLoad(() => api.groupMembers(site, page, { q: search, days, sort, offset, limit: PAGE_SIZE }), [api, site, page, search, days, sort, offset]);
  function option(label: string, selected: boolean, action: () => void) {
    return <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { setOffset(0); action(); }} style={{ minHeight: 44, padding: 10, borderRadius: 8, backgroundColor: selected ? colors.line : colors.panel }}><Text style={selected ? styles.link : styles.muted}>{label}</Text></Pressable>;
  }
  return <View style={styles.panel}>
    <Text style={styles.heading}>Pages in this group</Text>
    {!result.data?.limited && <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Search pages in this group" placeholderTextColor={colors.muted} accessibilityLabel="Search pages in this group" autoCapitalize="none" autoCorrect={false} />}
    <View style={styles.wrap}>{([7, 30, null] as const).map(value => option(value ? `${value} days` : "All time", days === value, () => setDays(value)))}</View>
    <View style={styles.wrap}>{option("Most visits", sort === "sessions", () => setSort("sessions"))}{option("Most clicks", sort === "clicks", () => setSort("clicks"))}</View>
    {result.error ? <><Text style={styles.error}>{result.error}</Text><Pressable onPress={result.reload}><Text style={styles.link}>Try again</Text></Pressable></> : null}
    {result.loading ? <ActivityIndicator color={colors.accent} /> : null}
    {result.data ? <>
      {result.data.rows.map(row => <View key={row.path} style={{ gap: 4, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line }}>
        <Text style={styles.text}>{row.path}</Text>
        <Text style={styles.muted}>{row.sessions.toLocaleString()} visits · {row.clicks.toLocaleString()} clicks · {row.sessions ? Math.round(row.desktop / row.sessions * 100) : 0}% desktop</Text>
      </View>)}
      {!result.data.rows.length && <Text style={styles.muted}>{search ? "No pages match your search." : "No visits in this time range."}</Text>}
      {result.data.limited ? <Text style={styles.muted}>Showing the busiest pages. Your plan limits the pages available here.</Text> : result.data.total > PAGE_SIZE ? <View style={styles.row}>
        <Pressable disabled={!offset} onPress={() => setOffset(value => Math.max(0, value - PAGE_SIZE))} style={{ paddingVertical: 12, opacity: offset ? 1 : 0.4 }}><Text style={styles.link}>Previous</Text></Pressable>
        <Text style={styles.muted}>{offset + 1}–{Math.min(offset + PAGE_SIZE, result.data.total)} of {result.data.total}</Text>
        <Pressable disabled={offset + PAGE_SIZE >= result.data.total} onPress={() => setOffset(value => value + PAGE_SIZE)} style={{ paddingVertical: 12, opacity: offset + PAGE_SIZE < result.data.total ? 1 : 0.4 }}><Text style={styles.link}>Next</Text></Pressable>
      </View> : null}
    </> : null}
  </View>;
}
