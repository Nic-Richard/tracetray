import { Image } from "react-native";
import icons from "../assets/icons.json";
import { useTheme } from "../lib/theme";

export type IconName = keyof typeof icons;

export default function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Image accessible={false} source={{ uri: icons[name] }} style={{ width: size, height: size, tintColor: color || colors.muted }} />;
}
