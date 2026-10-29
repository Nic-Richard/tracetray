import { router, useLocalSearchParams } from "expo-router";
import { Alert, Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
import { ignoreLinks } from "@tracetray/shared";
import { SafeAreaView } from "react-native-safe-area-context";
import { Failure } from "../../../components/Status";
import { installationSnippet } from "../../../lib/installation";
import { useSite } from "../../../lib/site";
import { useTheme } from "../../../lib/theme";

export default function InstallationScreen() {
  const params = useLocalSearchParams<{ site?: string | string[] }>();
  const { account } = useSite();
  const { styles, colors } = useTheme();
  const site = account.sites.find(value => value.key === params.site);
  if (!site) return <Failure message="Choose one of your websites." retry={() => router.replace("/websites")} />;
  const snippet = installationSnippet(account.dashboard, site.key);
  const links = ignoreLinks(site);
  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{site.name}</Text>
        <Text style={styles.text}>
          Add this code before the closing &lt;/body&gt; tag on every page you want to track.
        </Text>
        <View style={[styles.panel, { backgroundColor: colors.rail }]}>
          <ScrollView horizontal>
            <Text selectable style={[styles.text, { fontFamily: "monospace", fontSize: 13, color: "#e7e9f0" }]}>
              {snippet}
            </Text>
          </ScrollView>
        </View>
        <Text style={styles.muted}>
          Press and hold the code to copy it, or share it with whoever manages your website.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            Share.share({ message: snippet }).catch(() => Alert.alert("Couldn't share the code", "Try again."));
          }}
        >
          <Text style={styles.buttonText}>Share installation code</Text>
        </Pressable>
        <Text selectable style={styles.muted}>
          Website key: {site.key}
        </Text>
        <Text style={styles.muted}>
          Visits appear in the dashboard after the code is installed and someone visits your site.
        </Text>
        <Text style={styles.heading}>Ignore your own visits</Text>
        {links ? (<>
          <Text style={styles.text}>
            Open this link once in each browser you use. Visits from that browser stop counting on {site.name}.
          </Text>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(links.ignore).catch(() => Alert.alert("Couldn't open the link", "Try again."))}>
            <Text selectable style={styles.link}>{links.ignore}</Text>
          </Pressable>
          <Text selectable style={styles.muted}>To count them again, open {links.count}.</Text>
        </>) : (
          <Text style={styles.muted}>
            Once TraceTray sees a visit, open your website with ?tt_ignore=1 at the end of the address in each browser you use. ?tt_ignore=0 undoes it.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
