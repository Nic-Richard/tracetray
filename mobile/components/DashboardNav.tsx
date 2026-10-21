import { useEffect, useState } from "react";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { Keyboard, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSite } from "../lib/site";
import { useTheme } from "../lib/theme";
import Icon, { type IconName } from "./Icon";

const items: { path: "/" | "/journeys" | "/ask" | "/account"; label: string; icon: IconName }[] = [
  { path: "/", label: "Pages", icon: "pages" },
  { path: "/journeys", label: "Journeys", icon: "journeys" },
  { path: "/ask", label: "Ask", icon: "ask" },
  { path: "/account", label: "Account", icon: "account" },
];

export default function DashboardNav() {
  const path = usePathname();
  const params = useGlobalSearchParams<{ site?: string }>();
  const { site, account, selectSite } = useSite();
  const { colors, styles } = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (keyboard || !items.some(item => item.path === path)) return null;
  const key = path === "/" ? site?.key : account.sites.find(value => value.key === params.site)?.key || site?.key;
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.panel,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 8),
        paddingHorizontal: 12,
      }}
    >
      {items.map(item => {
        const selected = path === item.path;
        const disabled = !key && (item.path === "/ask" || item.path === "/journeys");
        return (
          <Pressable
            key={item.path}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => {
              if (key) selectSite(key);
              router.navigate({
                pathname: item.path,
                params: { ...(key ? { site: key } : {}), ...(item.path === "/ask" ? { q: "" } : {}) },
              });
            }}
            style={({ pressed }) => [
              {
                flex: 1,
                minHeight: 54,
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                opacity: disabled ? 0.35 : 1,
              },
              pressed && styles.pressed,
            ]}
          >
            <View
              style={{
                paddingHorizontal: 18,
                paddingVertical: 4,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: selected ? colors.accentSoft : "transparent",
              }}
            >
              <Icon name={item.icon} size={21} color={selected ? colors.accent : colors.muted} />
            </View>
            <Text
              style={{
                fontFamily: "InstrumentSans_600SemiBold",
                fontSize: 12,
                color: selected ? colors.accent : colors.muted,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
