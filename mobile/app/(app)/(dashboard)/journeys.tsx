import { router, useLocalSearchParams } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { journeyLabel, pageLabel, percent } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useSite } from "../../../lib/site";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";
import { Failure, Loading } from "../../../components/Status";
import SitePicker from "../../../components/SitePicker";

function Ranked({
  title,
  note,
  rows,
  color,
}: {
  title: string;
  note: string;
  rows: { label: string; count: number }[];
  color: string;
}) {
  const { styles, colors } = useTheme();
  const max = Math.max(1, ...rows.map(row => row.count));
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>{title}</Text>
      <Text style={styles.muted}>{note}</Text>
      {rows.length ? (
        rows.map((row, index) => (
          <View key={index} style={{ gap: 6, paddingVertical: 8 }}>
            <View style={styles.row}>
              <Text style={[styles.text, { flex: 1 }]}>{row.label}</Text>
              <Text style={styles.text}>{row.count.toLocaleString()}</Text>
            </View>
            <View style={{ height: 6, backgroundColor: colors.canvas, borderRadius: 3 }}>
              <View
                style={{ width: `${(row.count / max) * 100}%`, height: 6, backgroundColor: color, borderRadius: 3 }}
              />
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.muted}>Nothing yet.</Text>
      )}
    </View>
  );
}

export default function JourneysScreen() {
  const params = useLocalSearchParams<{ site?: string | string[] }>();
  const siteKey = typeof params.site === "string" ? params.site : "";
  const { account } = useSite();
  const site = account.sites.find(value => value.key === siteKey);
  const api = useApi();
  const { styles, colors } = useTheme();
  const result = useLoad(async () => {
    if (!site) throw new Error("Choose one of your websites.");
    return api.journey(site.key);
  }, [api, site?.key]);
  if (result.error) return <Failure message={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  const data = result.data;
  return (
    <SafeAreaView style={styles.screen} edges={["left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={result.loading} onRefresh={result.reload} tintColor={colors.accent} />
        }
      >
        <SitePicker siteKey={siteKey} onSelect={key => router.setParams({ site: key })} />
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => router.push({ pathname: "/paths", params: { site: siteKey } })}
        >
          <Text style={styles.link}>Explore expected paths</Text>
        </Pressable>
        <Text style={styles.muted}>
          How visitors move through the whole site in the last 30 days: where they arrive, where they go next, and where
          they leave.
        </Text>
        {!data.total_visitors ? (
          <View style={styles.panel}>
            <Text style={styles.heading}>No journeys yet</Text>
            <Text style={styles.muted}>Journeys appear as visitors arrive and move between pages.</Text>
          </View>
        ) : (
          <>
            <View style={styles.panel}>
              <Text style={styles.number}>{data.total_visitors.toLocaleString()}</Text>
              <Text style={styles.muted}>Visitors</Text>
              <View style={styles.wrap}>
                <View style={styles.stat}>
                  <Text style={[styles.number, { color: colors.groups[1] }]}>
                    {percent(data.multi_page_visitors / data.total_visitors)}
                  </Text>
                  <Text style={styles.muted}>Viewed more than one page</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.number, { color: colors.groups[3] }]}>
                    {percent(data.single_page_visitors / data.total_visitors)}
                  </Text>
                  <Text style={styles.muted}>Left after one page</Text>
                </View>
              </View>
            </View>
            <Ranked
              title="Where visitors arrive"
              note="First page"
              rows={data.top_entries.map(row => ({ label: pageLabel(row.page), count: row.count }))}
              color={colors.groups[1]}
            />
            <Ranked
              title="Where visitors leave"
              note="Last page"
              rows={data.top_exits.map(row => ({ label: pageLabel(row.page), count: row.count }))}
              color={colors.groups[3]}
            />
            <Ranked
              title="Most common moves"
              note="From one page to the next"
              rows={data.top_transitions.map(row => ({ label: journeyLabel(row.path), count: row.count }))}
              color={colors.groups[0]}
            />
            <Ranked
              title="Most common paths"
              note="First three pages"
              rows={data.top_paths.map(row => ({ label: journeyLabel(row.path), count: row.count }))}
              color={colors.groups[4]}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
