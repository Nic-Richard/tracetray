import { useMemo, useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { compactNumber, pageLabel, pagePath } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useRefreshOnFocus } from "../../../lib/useRefreshOnFocus";
import { useTheme } from "../../../lib/theme";
import SitePicker from "../../../components/SitePicker";
import Brand from "../../../components/Brand";
import Icon from "../../../components/Icon";

export default function Pages() {
  const api = useApi();
  const { site } = useSite();
  const { colors, styles } = useTheme();
  const [query, setQuery] = useState("");
  const pages = useLoad(() => (site ? api.pages(site.key) : Promise.resolve([])), [api, site?.key]);
  useRefreshOnFocus(pages.reload);
  const filtered = useMemo(
    () =>
      [...(pages.data || [])]
        .filter(item =>
          `${pageLabel(item.page)} ${pagePath(item.page)}`.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => b.sessions - a.sessions || a.page.localeCompare(b.page)),
    [pages.data, query],
  );
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <FlatList
        data={filtered}
        keyExtractor={item => `${site?.key}:${item.page}`}
        refreshing={pages.loading && !!pages.data}
        onRefresh={pages.reload}
        contentContainerStyle={[styles.content, { gap: 0 }]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 10 }}>
            <View style={styles.row}>
              <Brand />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Get installation code"
                onPress={() =>
                  site
                    ? router.push({ pathname: "/installation", params: { site: site.key } })
                    : router.push("/websites")
                }
                style={styles.iconTile}
              >
                <Icon name="setup" color={colors.accent} />
              </Pressable>
            </View>
            <SitePicker />
            {site ? (
              <View style={[styles.wrap, { gap: 20 }]}>
                <Pressable
                  accessibilityRole="button"
                  style={{ minHeight: 44, justifyContent: "center" }}
                  onPress={() => router.push({ pathname: "/goals", params: { site: site.key } })}
                >
                  <Text style={styles.link}>Goals</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={{ minHeight: 44, justifyContent: "center" }}
                  onPress={() => router.push({ pathname: "/sessions", params: { site: site.key } })}
                >
                  <Text style={styles.link}>Recent visits</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={{ minHeight: 44, justifyContent: "center" }}
                  onPress={() => router.push({ pathname: "/installation", params: { site: site.key } })}
                >
                  <Text style={styles.link}>Snippet</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={{ gap: 12 }}>
              <View style={styles.row}>
                <Text style={styles.title}>Pages</Text>
                <Text style={styles.muted}>{pages.data ? `${pages.data.length} tracked` : ""}</Text>
              </View>
              <View style={styles.search}>
                <Icon name="search" size={19} />
                <TextInput
                  accessibilityLabel="Find a page"
                  placeholder="Find a page"
                  placeholderTextColor={colors.muted}
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
              </View>
              <View style={styles.row}>
                <Text style={styles.eyebrow}>Most visited first</Text>
                <Text style={styles.muted}>Recorded visits</Text>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.panel}>
            {pages.loading ? (
              <ActivityIndicator color={colors.accent} />
            ) : pages.error ? (
              <>
                <Text style={styles.error} accessibilityRole="alert">
                  {pages.error}
                </Text>
                <Pressable accessibilityRole="button" onPress={pages.reload} style={styles.button}>
                  <Text style={styles.buttonText}>Try again</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.heading}>{query ? "No matching pages" : "No pages yet"}</Text>
                <Text style={styles.muted}>
                  {query
                    ? "Try another name or path."
                    : "Add the tracking snippet to your website. Pages appear as visitors arrive."}
                </Text>
                {!query ? (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.button}
                    onPress={() =>
                      site
                        ? router.push({ pathname: "/installation", params: { site: site.key } })
                        : router.push("/websites")
                    }
                  >
                    <Text style={styles.buttonText}>{site ? "Get installation code" : "Add a website"}</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !!item.locked }}
            disabled={item.locked}
            onPress={() => router.push({ pathname: "/page", params: { page: item.page, site: site!.key } })}
            style={({ pressed }) => [
              styles.row,
              { paddingVertical: 18, borderBottomWidth: 1, borderColor: colors.line, opacity: item.locked ? 0.55 : 1 },
              pressed && styles.pressed,
            ]}
          >
            <View
              style={{
                width: 4,
                height: 32,
                borderRadius: 2,
                backgroundColor: item.locked ? colors.line : colors.accent,
              }}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.actionTitle} numberOfLines={1}>
                {pageLabel(item.page)}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {pagePath(item.page)}
              </Text>
              {item.locked ? (
                <Text style={styles.muted}>Past this month's page allowance</Text>
              ) : item.pages_in_group ? (
                <Text style={styles.muted}>{item.pages_in_group.toLocaleString()} pages in this group</Text>
              ) : null}
            </View>
            <Text style={[styles.number, { fontSize: 22 }]}>{compactNumber(item.sessions)}</Text>
            <Icon name={item.locked ? "lock" : "arrow"} size={16} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
