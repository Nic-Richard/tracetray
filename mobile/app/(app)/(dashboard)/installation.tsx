import { router, useLocalSearchParams } from "expo-router";
import { Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
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
      </ScrollView>
    </SafeAreaView>
  );
}
