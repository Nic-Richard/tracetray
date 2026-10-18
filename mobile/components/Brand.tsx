import { Image, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

export default function Brand() {
  const { styles } = useTheme();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
    <Image accessible={false} source={require("../assets/splash.png")} style={{ width: 34, height: 34 }} />
    <Text style={styles.wordmark}>TraceTray</Text>
  </View>;
}
