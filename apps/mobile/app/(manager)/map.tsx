/**
 * Manager Live Map screen.
 *
 * Shows all couriers on a MapView with:
 *  - Color-coded markers (green/amber/red/grey) based on online status
 *  - WS subscription to courier:moved for real-time position updates
 *  - Bottom sheet on marker tap: courier name, status, active delivery address, battery
 *  - OSRM route polyline for selected courier with active delivery
 *  - WS offline banner when disconnected
 *
 * NOTE: react-native-maps requires EAS development builds.
 *       Shows a fallback message in Expo Go.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '@/api/client';
import { useManagerSocket } from '@/hooks/use-manager-socket';
import type { ManagerCourier, CourierOnlineStatus, TransportMode } from '@/types';

// Lazy-import MapView to avoid crash in Expo Go (module may be unavailable)
let MapView: React.ComponentType<any> | null = null;
let Marker: React.ComponentType<any> | null = null;
let Polyline: React.ComponentType<any> | null = null;
let PROVIDER_DEFAULT: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const maps = require('react-native-maps') as typeof import('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
  PROVIDER_DEFAULT = maps.PROVIDER_DEFAULT;
} catch {
  // react-native-maps not available (Expo Go)
}

const isExpoGo = Constants.appOwnership === 'expo';

const OSRM_URL =
  process.env.EXPO_PUBLIC_OSRM_URL ?? 'https://router.project-osrm.org';

const STATUS_DOT_COLOR: Record<CourierOnlineStatus, string> = {
  online: '#22c55e',
  background: '#f59e0b',
  not_responding: '#ef4444',
  offline: '#78776e',
};

const STATUS_LABEL: Record<CourierOnlineStatus, string> = {
  online: 'Онлайн',
  background: 'Фон',
  not_responding: 'Не відповідає',
  offline: 'Офлайн',
};

function resolveOsrmProfile(mode: TransportMode | null): string {
  if (mode === 'bicycle') return 'cycling';
  if (mode === 'walking') return 'foot';
  return 'driving'; // car, moto_gas, moto_electric, null
}

type OsrmPoint = { latitude: number; longitude: number };

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

interface CourierMarkerProps {
  courier: ManagerCourier;
  selected: boolean;
  onPress: () => void;
  MarkerC: React.ComponentType<any>;
}

function CourierMarker({ courier, selected, onPress, MarkerC }: CourierMarkerProps) {
  if (!courier.last_ping) return null;
  const color = STATUS_DOT_COLOR[courier.status];

  return (
    <MarkerC
      coordinate={{ latitude: courier.last_ping.lat!, longitude: courier.last_ping.lng! }}
      onPress={onPress}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={[styles.markerOuter, { borderColor: color }, selected && styles.markerSelected]}>
        <View style={[styles.markerInner, { backgroundColor: '#1a1917' }]}>
          <Text style={styles.markerInitials}>{initials(courier.name)}</Text>
        </View>
      </View>
    </MarkerC>
  );
}

// Kyiv center fallback — overridden once couriers load
const KYIV = {
  latitude: 50.4501,
  longitude: 30.5234,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function MapScreen() {
  const [couriers, setCouriers] = useState<ManagerCourier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<OsrmPoint[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [initialRegion, setInitialRegion] = useState(KYIV);
  const mapRef = useRef<any>(null);
  // Track last fetched route key — only re-fetch when destination changes, not on every ping
  const routeKeyRef = useRef<string | null>(null);
  const { socket, connected } = useManagerSocket();

  const load = useCallback(async () => {
    try {
      const data = await apiGet<ManagerCourier[]>('/api/v1/couriers');
      setCouriers(data);

      // Center map on first courier with known position
      const first = data.find((c) => c.last_ping?.lat != null && c.last_ping?.lng != null);
      if (first?.last_ping) {
        setInitialRegion({
          latitude: first.last_ping.lat!,
          longitude: first.last_ping.lng!,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // WS: update courier position in real-time
  useEffect(() => {
    if (!socket) return;

    const handler = (data: {
      courier_id: string;
      lat: number;
      lng: number;
      battery: number | null;
      ts: string;
    }) => {
      setCouriers((prev) =>
        prev.map((c) => {
          if (c.id !== data.courier_id) return c;
          return {
            ...c,
            last_lat: data.lat,
            last_lng: data.lng,
            last_ping_at: data.ts,
            last_ping: {
              lat: data.lat,
              lng: data.lng,
              battery: data.battery,
              created_at: data.ts,
            },
            // Fresh ping = age 0 → always online
            status: 'online' as const,
          };
        }),
      );
    };

    socket.on('courier:moved', handler);
    return () => { socket.off('courier:moved', handler); };
  }, [socket]);

  // Fetch OSRM route when selected courier's delivery DESTINATION changes,
  // OR when the courier moves more than ~200 m from the last route origin.
  // The route key encodes: courierId + orderId + position bucket (0.002° ≈ 220 m step).
  // Key change → re-fetch; same key → skip.
  useEffect(() => {
    if (!selectedId) {
      setRoute([]);
      routeKeyRef.current = null;
      return;
    }

    const courier = couriers.find((c) => c.id === selectedId);
    const orderId = courier?.active_delivery?.order.id ?? null;
    const toLat = courier?.active_delivery?.order.lat;
    const toLng = courier?.active_delivery?.order.lng;
    const fromLat = courier?.last_ping?.lat;
    const fromLng = courier?.last_ping?.lng;

    // Position bucket: round to nearest 0.002° (≈ 220 m at equator, ≈ 145 m at lat 50°)
    const latBucket = fromLat != null ? Math.round(fromLat / 0.002) : 'x';
    const lngBucket = fromLng != null ? Math.round(fromLng / 0.002) : 'x';

    const newKey = `${selectedId}:${orderId ?? 'none'}:${latBucket}:${lngBucket}`;
    if (newKey === routeKeyRef.current) return;
    routeKeyRef.current = newKey;

    setRoute([]);

    if (!fromLat || !fromLng || !toLat || !toLng) return;

    const profile = resolveOsrmProfile(courier?.transport_mode ?? null);
    const url = `${OSRM_URL}/route/v1/${profile}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;

    setRouteLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    fetch(url, { signal: controller.signal })
      .then((res) => res.json() as Promise<{
        routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
      }>)
      .then((data) => {
        if (controller.signal.aborted) return;
        const coords = data.routes?.[0]?.geometry?.coordinates;
        if (coords) {
          setRoute(coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng })));
        }
      })
      .catch(() => { /* non-critical — route just won't render */ })
      .finally(() => { clearTimeout(timer); setRouteLoading(false); });

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selectedId, couriers]);

  const selectedCourier = couriers.find((c) => c.id === selectedId) ?? null;

  // Expo Go fallback
  if (isExpoGo || MapView === null) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Ionicons name="map-outline" size={40} color="#78776e" />
          <Text style={styles.fallbackTitle}>Карта недоступна</Text>
          <Text style={styles.fallbackText}>
            Для відображення карти потрібен{'\n'}EAS development build
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // After Expo Go / null guard above, these are guaranteed non-null
  const MapViewC = MapView as React.ComponentType<any>;
  const MarkerC = Marker as React.ComponentType<any>;
  const PolylineC = Polyline as React.ComponentType<any>;

  if (loading) {
    return (
      <View style={styles.root}>
        <View style={styles.centered}>
          <ActivityIndicator color="#78776e" size="large" />
          <Text style={styles.loadingText}>Завантаження карти...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.centered}>
          <Ionicons name="warning-outline" size={32} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>Повторити</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <MapViewC
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        mapType="standard"
        userInterfaceStyle="dark"
        showsUserLocation={false}
        showsCompass={false}
        showsScale={false}
      >
        {couriers.map((courier) => (
          <CourierMarker
            key={courier.id}
            courier={courier}
            selected={selectedId === courier.id}
            MarkerC={MarkerC}
            onPress={() => setSelectedId((prev) => (prev === courier.id ? null : courier.id))}
          />
        ))}
        {route.length > 1 ? (
          <PolylineC
            coordinates={route}
            strokeColor="#9c9b96"
            strokeWidth={2}
            lineDashPattern={[6, 4]}
          />
        ) : null}
      </MapViewC>

      {/* WS offline banner */}
      {!connected ? (
        <SafeAreaView style={styles.offlineBannerContainer} edges={['top']}>
          <View style={styles.offlineBanner}>
            <View style={styles.offlineDot} />
            <Text style={styles.offlineBannerText}>Офлайн · оновлення призупинено</Text>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Legend */}
      <SafeAreaView style={[styles.legendContainer, !connected && styles.legendContainerWithBanner]} edges={['top']}>
        <View style={styles.legend}>
          {(['online', 'background', 'not_responding', 'offline'] as CourierOnlineStatus[]).map((s) => (
            <View key={s} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: STATUS_DOT_COLOR[s] }]} />
              <Text style={styles.legendLabel}>{STATUS_LABEL[s]}</Text>
            </View>
          ))}
        </View>
      </SafeAreaView>

      {/* Selected courier bottom sheet */}
      {selectedCourier ? (
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetRow}>
            <View style={styles.sheetLeft}>
              <View style={styles.sheetNameRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: STATUS_DOT_COLOR[selectedCourier.status] },
                  ]}
                />
                <Text style={styles.sheetName}>{selectedCourier.name}</Text>
              </View>
              <Text style={styles.sheetStatus}>{STATUS_LABEL[selectedCourier.status]}</Text>
              {selectedCourier.active_delivery ? (
                <Text style={styles.sheetDelivery} numberOfLines={1}>
                  → {selectedCourier.active_delivery.order.address}
                </Text>
              ) : selectedCourier.active_shift ? (
                <Text style={styles.sheetFree}>На зміні · вільний</Text>
              ) : (
                <Text style={styles.sheetOffShift}>Не на зміні</Text>
              )}
            </View>
            <View style={styles.sheetRight}>
              {routeLoading ? <ActivityIndicator size="small" color="#78776e" style={{ marginRight: 8 }} /> : null}
              <TouchableOpacity
                style={styles.sheetClose}
                onPress={() => setSelectedId(null)}
              >
                <Ionicons name="close" size={20} color="#78776e" />
              </TouchableOpacity>
            </View>
          </View>
          {selectedCourier.last_ping?.battery !== null &&
           selectedCourier.last_ping?.battery !== undefined ? (
            <Text style={styles.batteryText}>
              Батарея: {selectedCourier.last_ping.battery}%
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* No couriers empty state */}
      {couriers.length === 0 ? (
        <SafeAreaView style={styles.emptyOverlay} edges={['top']}>
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={24} color="#78776e" />
            <Text style={styles.emptyText}>Немає курʼєрів на зміні</Text>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c0b09' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#0c0b09',
  },
  loadingText: {
    color: '#78776e',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  fallbackTitle: {
    fontSize: 16,
    color: '#faf9f6',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
    marginTop: 4,
  },
  fallbackText: {
    fontSize: 13,
    color: '#78776e',
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  errorText: {
    color: '#9c9b96',
    fontSize: 14,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1917',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  retryText: {
    color: '#faf9f6',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
  // WS offline banner
  offlineBannerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(30,29,27,0.95)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    margin: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  offlineBannerText: {
    fontSize: 11,
    color: '#ef4444',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
  // Courier markers
  markerOuter: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1917',
  },
  markerSelected: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
  },
  markerInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 99,
  },
  markerInitials: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_700Bold' : undefined,
    fontWeight: '700',
    color: '#faf9f6',
  },
  // Legend
  legendContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  legendContainerWithBanner: {
    top: 40, // push legend below the offline banner
  },
  legend: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(12,11,9,0.85)',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    margin: 12,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: {
    fontSize: 11,
    color: '#9c9b96',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  // Bottom sheet
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1a1917',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,249,246,0.08)',
    gap: 6,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(250,249,246,0.14)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  sheetLeft: { flex: 1, gap: 3 },
  sheetRight: { flexDirection: 'row', alignItems: 'center' },
  sheetNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  sheetName: {
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
    color: '#faf9f6',
  },
  sheetStatus: {
    fontSize: 12,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  sheetDelivery: {
    fontSize: 13,
    color: '#9c9b96',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    marginTop: 2,
  },
  sheetFree: {
    fontSize: 13,
    color: '#22c55e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  sheetOffShift: {
    fontSize: 13,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  sheetClose: { padding: 4 },
  batteryText: {
    fontSize: 11,
    color: '#78776e',
    fontFamily: 'JetBrainsMono_400Regular',
  },
  // Empty overlay
  emptyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(12,11,9,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    margin: 12,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  emptyText: {
    color: '#9c9b96',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
});
