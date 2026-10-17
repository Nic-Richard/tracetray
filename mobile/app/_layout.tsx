import { useEffect, useState } from "react";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { InstrumentSans_400Regular } from "@expo-google-fonts/instrument-sans/400Regular";
import { InstrumentSans_600SemiBold } from "@expo-google-fonts/instrument-sans/600SemiBold";
import { InstrumentSans_700Bold } from "@expo-google-fonts/instrument-sans/700Bold";
import { createApi, type Config } from "@tracetray/shared";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Failure, Loading } from "../components/Status";
import { apiOrigin, ApiProvider } from "../lib/api";
import { useTheme } from "../lib/theme";

export default function RootLayout() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [fontsLoaded, fontError] = useFonts({ InstrumentSans_400Regular, InstrumentSans_600SemiBold, InstrumentSans_700Bold });
  useEffect(() => {
    let cancelled = false;
    setError("");
    Promise.resolve().then(() => createApi({ baseUrl: apiOrigin(), getToken: async () => null }).config())
      .then(value => {
        if (!value.clerk_publishable_key) throw new Error("TraceTray sign-in isn't configured yet.");
        if (!cancelled) setConfig(value);
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [attempt]);
  return <SafeAreaProvider>
    {error ? <Failure message={error} retry={() => setAttempt(value => value + 1)} />
      : !config || (!fontsLoaded && !fontError) ? <Loading message="Opening TraceTray…" />
      : <ClerkProvider publishableKey={config.clerk_publishable_key} tokenCache={tokenCache}>
        <Navigation />
      </ClerkProvider>}
  </SafeAreaProvider>;
}

function Navigation() {
  const { isLoaded, isSignedIn } = useAuth();
  const { colors, dark } = useTheme();
  if (!isLoaded) return <Loading />;
  return <ApiProvider>
    <StatusBar style={dark ? "light" : "dark"} />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Protected guard={!isSignedIn}><Stack.Screen name="sign-in" /></Stack.Protected>
      <Stack.Protected guard={!!isSignedIn}><Stack.Screen name="(dashboard)" /></Stack.Protected>
    </Stack>
  </ApiProvider>;
}
