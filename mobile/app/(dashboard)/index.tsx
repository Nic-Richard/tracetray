import { useMemo, useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { compactNumber, pageLabel, pagePath } from "@tracetray/shared";
import { useApi } from "../../lib/api";
import { useSite } from "../../lib/site";
import { useLoad } from "../../lib/useLoad";
import { useTheme } from "../../lib/theme";
import SitePicker from "../../components/SitePicker";

export default function Pages() {
  const api = useApi();
  const { site } = useSite();
  const { colors, styles } = useTheme();
  const [query, setQuery] = useState("");
  const pages = useLoad(() => site ? api.pages(site.key) : Promise.resolve([]), [api, site?.key]);
  const filtered = useMemo(() => [...(pages.data || [])]
    .filter(item => `${pageLabel(item.page)} ${pagePath(item.page)}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.sessions - a.sessions || a.page.localeCompare(b.page)), [pages.data, query]);
  return <SafeAreaView style={styles.screen}>
    <FlatList
      data={filtered} keyExtractor={item => `${site?.key}:${item.page}`} refreshing={pages.loading && !!pages.data} onRefresh={pages.reload}
      contentContainerStyle={{ padding: 20, gap: 10, flexGrow: 1 }} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={{ gap: 20, marginBottom: 10 }}>
        <View style={styles.row}>
          <Text style={styles.title}>TraceTray</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/account")} style={{ paddingVertical: 12 }}><Text style={styles.link}>Account</Text></Pressable>
        </View>
        <SitePicker />
        {site ? <View style={styles.wrap}>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push({ pathname: "/journeys", params: { site: site.key } })}><Text style={styles.buttonText}>Journeys</Text></Pressable>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push({ pathname: "/sessions", params: { site: site.key } })}><Text style={styles.buttonText}>Recent visits</Text></Pressable>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push({ pathname: "/ask", params: { site: site.key } })}><Text style={styles.buttonText}>Ask</Text></Pressable>
        </View> : null}
        <View style={styles.row}><Text style={styles.heading}>Pages</Text><Text style={styles.muted}>{pages.data?.length ?? ""}</Text></View>
        <TextInput accessibilityLabel="Find a page" placeholder="Find a page" placeholderTextColor={colors.muted} style={styles.input} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
      </View>}
      ListEmptyComponent={<View style={styles.panel}>
        {pages.loading ? <ActivityIndicator color={colors.accent} /> : pages.error ? <>
          <Text style={styles.error} accessibilityRole="alert">{pages.error}</Text>
          <Pressable accessibilityRole="button" onPress={pages.reload} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>
        </> : <>
          <Text style={styles.heading}>{query ? "No matching pages" : "No pages yet"}</Text>
          <Text style={styles.muted}>{query ? "Try another name or path." : "Add the tracking snippet to your website. Pages appear as visitors arrive."}</Text>
          {!query ? <Pressable accessibilityRole="button" style={styles.button} onPress={() => site ? router.push({ pathname: "/installation", params: { site: site.key } }) : router.push("/websites")}><Text style={styles.buttonText}>{site ? "Get installation code" : "Add a website"}</Text></Pressable> : null}
        </>}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!item.locked }} disabled={item.locked}
        onPress={() => router.push({ pathname: "/page", params: { page: item.page, site: site!.key } })} style={[styles.panel, styles.row]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.heading} numberOfLines={1}>{pageLabel(item.page)}</Text>
          <Text style={styles.muted} numberOfLines={1}>{pagePath(item.page)}</Text>
          {item.locked ? <Text style={styles.muted}>Past this month's page allowance</Text>
            : item.pages_in_group ? <Text style={styles.muted}>{item.pages_in_group.toLocaleString()} pages in this group</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}><Text style={styles.number}>{compactNumber(item.sessions)}</Text><Text style={styles.muted}>visits</Text></View>
      </Pressable>}
    />
  </SafeAreaView>;
}
