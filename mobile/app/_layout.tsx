import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppearanceProvider } from "../lib/appearance";

export default function RootLayout() {
  return <SafeAreaProvider><AppearanceProvider><Slot /></AppearanceProvider></SafeAreaProvider>;
}
