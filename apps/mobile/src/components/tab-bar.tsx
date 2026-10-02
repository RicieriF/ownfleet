/**
 * Custom bottom tab bar for courier app.
 * Rendered inside tab screens (index, route, stats, profile).
 * Not rendered on flow screens (navigate, proof, fail, shifts, history).
 *
 * Uses router.navigate() so switching tabs doesn't pile up the stack.
 */
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
} from "react-native";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

interface TabDef {
  href: string;
  label: string;
  icon: IoniconName;
  iconActive: IoniconName;
  matchSegments: string[];
}

const TABS: TabDef[] = [
  {
    href: "/(app)",
    label: "Доставки",
    icon: "bicycle-outline",
    iconActive: "bicycle",
    matchSegments: ["/"],
  },
  {
    href: "/(app)/route",
    label: "Маршрут",
    icon: "navigate-outline",
    iconActive: "navigate",
    matchSegments: ["/route"],
  },
  {
    href: "/(app)/transport",
    label: "Transporte",
    icon: "bus-outline",
    iconActive: "bus",
    matchSegments: ["/transport"],
  },
  {
    href: "/(app)/stats",
    label: "Статистика",
    icon: "bar-chart-outline",
    iconActive: "bar-chart",
    matchSegments: ["/stats"],
  },
  {
    href: "/(app)/profile",
    label: "Профіль",
    icon: "person-outline",
    iconActive: "person",
    matchSegments: ["/profile"],
  },
];

export function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  function isActive(tab: TabDef): boolean {
    // Main screen: pathname is '/' or ends with just the group
    if (tab.href === "/(app)") {
      return pathname === "/" || pathname === "";
    }
    return tab.matchSegments.some((seg) => pathname.endsWith(seg));
  }

  const bottomPad = Math.max(insets.bottom, 8);

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: bottomPad, height: 49 + bottomPad },
      ]}
    >
      {TABS.map((tab) => {
        const active = isActive(tab);
        return (
          <TouchableOpacity
            key={tab.href}
            style={styles.tab}
            onPress={() =>
              router.navigate(tab.href as Parameters<typeof router.navigate>[0])
            }
            activeOpacity={0.7}
          >
            <Ionicons
              name={active ? tab.iconActive : tab.icon}
              size={22}
              color={active ? "#faf9f6" : "#78776e"}
            />
            <Text style={[styles.label, active && styles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#0c0b09",
    borderTopWidth: 1,
    borderTopColor: "rgba(250,249,246,0.08)",
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 3,
  },
  label: {
    fontSize: 10,
    color: "#78776e",
    fontFamily: Platform.OS === "ios" ? "Manrope_500Medium" : undefined,
  },
  labelActive: {
    color: "#faf9f6",
  },
});
