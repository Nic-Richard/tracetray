import { Stack } from "expo-router";
import { View } from "react-native";
import { SiteProvider } from "../../../lib/site";
import { useTheme } from "../../../lib/theme";
import DashboardNav from "../../../components/DashboardNav";

export const unstable_settings = { anchor: "index" };

export default function DashboardLayout() {
  const { colors } = useTheme();
  return <SiteProvider>
    <View style={{ flex: 1 }}>
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.canvas }, headerTintColor: colors.ink,
      headerTitleStyle: { fontFamily: "InstrumentSans_600SemiBold" },
      headerShadowVisible: false, contentStyle: { backgroundColor: colors.canvas }
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="page" options={{ title: "Page overview" }} />
      <Stack.Screen name="trends" options={{ title: "Trends" }} />
      <Stack.Screen name="attention" options={{ title: "Attention" }} />
      <Stack.Screen name="advanced" options={{ title: "Advanced analysis" }} />
      <Stack.Screen name="journeys" options={{ title: "Journeys", headerBackVisible: false }} />
      <Stack.Screen name="sessions" options={{ title: "Recent visits" }} />
      <Stack.Screen name="ask" options={{ title: "Ask", headerBackVisible: false }} />
      <Stack.Screen name="account" options={{ title: "Account", headerBackVisible: false }} />
      <Stack.Screen name="billing" options={{ title: "Plan and billing" }} />
      <Stack.Screen name="report" options={{ title: "Report a problem" }} />
      <Stack.Screen name="websites" options={{ title: "Websites" }} />
      <Stack.Screen name="installation" options={{ title: "Installation" }} />
      <Stack.Screen name="goals" options={{ title: "Goals" }} />
      <Stack.Screen name="goal" options={{ title: "Goal details" }} />
      <Stack.Screen name="emails" options={{ title: "Email preferences" }} />
      <Stack.Screen name="delete-account" options={{ title: "Delete account" }} />
      <Stack.Screen name="changes" options={{ title: "Before and after" }} />
      <Stack.Screen name="paths" options={{ title: "Funnels" }} />
    </Stack>
    <DashboardNav />
    </View>
  </SiteProvider>;
}
