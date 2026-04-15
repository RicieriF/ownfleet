/**
 * Bottom tab bar for manager flow.
 * Mirrors courier tab-bar.tsx pattern — same design tokens, same behaviour.
 */
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabDef {
  href: string;
  label: string;
  icon: IoniconName;
  iconActive: IoniconName;
  matchSegments: string[];
}

const TABS: TabDef[] = [
  {
    href: '/(manager)',
    label: 'Дашборд',
    icon: 'grid-outline',
    iconActive: 'grid',
    matchSegments: ['/'],
  },
  {
    href: '/(manager)/orders',
    label: 'Замовлення',
    icon: 'list-outline',
    iconActive: 'list',
    matchSegments: ['/orders'],
  },
  {
    href: '/(manager)/map',
    label: 'Карта',
    icon: 'map-outline',
    iconActive: 'map',
    matchSegments: ['/map'],
  },
  {
    href: '/(manager)/shifts',
    label: 'Зміни',
    icon: 'people-outline',
    iconActive: 'people',
    matchSegments: ['/shifts'],
  },
  {
    href: '/(manager)/analytics',
    label: 'Аналітика',
    icon: 'bar-chart-outline',
    iconActive: 'bar-chart',
    matchSegments: ['/analytics'],
  },
  {
    href: '/(manager)/couriers',
    label: 'Курʼєри',
    icon: 'people-circle-outline',
    iconActive: 'people-circle',
    matchSegments: ['/couriers'],
  },
];

export function ManagerTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  function isActive(tab: TabDef): boolean {
    if (tab.href === '/(manager)') {
      return pathname === '/' || pathname === '';
    }
    return tab.matchSegments.some((seg) => pathname.endsWith(seg));
  }

  const bottomPad = Math.max(insets.bottom, 8);

  return (
    <View style={[styles.container, { paddingBottom: bottomPad, height: 49 + bottomPad }]}>
      {TABS.map((tab) => {
        const active = isActive(tab);
        return (
          <TouchableOpacity
            key={tab.href}
            style={styles.tab}
            onPress={() => router.navigate(tab.href as Parameters<typeof router.navigate>[0])}
            activeOpacity={0.7}
          >
            <Ionicons
              name={active ? tab.iconActive : tab.icon}
              size={22}
              color={active ? '#faf9f6' : '#78776e'}
            />
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#0c0b09',
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,249,246,0.08)',
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 3,
  },
  label: {
    fontSize: 10,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
  labelActive: {
    color: '#faf9f6',
  },
});
