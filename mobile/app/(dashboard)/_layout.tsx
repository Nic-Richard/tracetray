import { Stack } from "expo-router";
import { SiteProvider } from "../../lib/site";
import { useTheme } from "../../lib/theme";

export default function DashboardLayout() {
  const { colors } = useTheme();
  return <SiteProvider>
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.panel }, headerTintColor: colors.ink,
      headerTitleStyle: { fontFamily: "InstrumentSans_600SemiBold" },
      headerShadowVisible: false, contentStyle: { backgroundColor: colors.canvas }
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="page" options={{ title: "Page overview" }} />
      <Stack.Screen name="trends" options={{ title: "Trends" }} />
      <Stack.Screen name="attention" options={{ title: "Attention" }} />
      <Stack.Screen name="journeys" options={{ title: "Journeys" }} />
      <Stack.Screen name="sessions" options={{ title: "Recent visits" }} />
      <Stack.Screen name="ask" options={{ title: "Ask" }} />
    </Stack>
  </SiteProvider>;
}
