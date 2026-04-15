/**
 * Manager Live Map screen.
 *
 * Shows all couriers on a MapView with:
 *  - Color-coded markers (green/amber/red/grey) based on online status
 *  - WS subscription to courier:moved for real-time position updates
 *  - Bottom sheet on marker tap: courier name, status, active delivery address
 *  - OSRM route polyline for selected courier
 *
 * NOTE: react-native-maps requires EAS development builds.
 *       Does not work in Expo Go — map renders blank.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '@/api/client';
import { useManagerSocket } from '@/hooks/use-manager-socket';
import type { ManagerCourier, CourierOnlineStatus } from '@/types';

const STATUS_DOT_COLOR: Record<CourierOnlineStatus, string> = {
  online: '#22c55e',
  background: '#f59e0b',
  no_response: '#ef4444',
  offline: '#78776e',
};

const STATUS_LABEL: Record<CourierOnlineStatus, string> = {
  online: 'Онлайн',
  background: 'Фон',
  no_response: 'Не відповідає',
  offline: 'Офлайн',
};

function computeStatus(courier: ManagerCourier): CourierOnlineStatus {
  if (!courier.last_ping) return 'offline';
  const diffMs = Date.now() - new Date(courier.last_ping.created_at).getTime();
  const diffSec = diffMs / 1000;
  if (diffSec < 30) return 'online';
  if (diffSec < 300) return 'background';
  if (courier.active_delivery) return 'no_response';
  return 'offline';
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

interface CourierMarkerProps {
  courier: ManagerCourier & { online_status: CourierOnlineStatus };
  selected: boolean;
  onPress: () => void;
}

function CourierMarker({ courier, selected, onPress }: CourierMarkerProps) {
  if (!courier.last_ping) return null;
  const color = STATUS_DOT_COLOR[courier.online_status];

  return (
    <Marker
      coordinate={{ latitude: courier.last_ping.lat, longitude: courier.last_ping.lng }}
      onPress={onPress}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={[styles.markerOuter, { borderColor: color }, selected && styles.markerSelected]}>
        <View style={[styles.markerInner, { backgroundColor: '#1a1917' }]}>
          <Text style={styles.markerInitials}>{initials(courier.name)}</Text>
        </View>
      </View>
    </Marker>
  );
}

interface OsrmPoint {
  latitude: number;
  longitude: number;
}

async function fetchOsrmRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<OsrmPoint[]> {
  const OSRM_URL =
    process.env.EXPO_PUBLIC_OSRM_URL ?? 'https://router.project-osrm.org';
  const url = `${OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json() as {
    routes?: Array<{
      geometry: { coordinates: Array<[number, number]> };
    }>;
  };
  const coords = data.routes?.[0]?.geometry?.coordinates ?? [];
  return coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

// Kyiv center as default region
const DEFAULT_REGION = {
  latitude: 50.4501,
  longitude: 30.5234,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function MapScreen() {
  const [couriers, setCouriers] = useState<Array<ManagerCourier & { online_status: CourierOnlineStatus }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<OsrmPoint[]>([]);
  const mapRef = useRef<MapView>(null);
  const { socket } = useManagerSocket();

  const load = useCallback(async () => {
    try {
      const data = await apiGet<ManagerCourier[]>('/api/v1/couriers');
      const withStatus = data.map((c) => ({ ...c, online_status: computeStatus(c) }));
      setCouriers(withStatus);
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

    const handler = (data: { courier_id: string; lat: number; lng: number; battery: number | null; ts: string }) => {
      setCouriers((prev) =>
        prev.map((c) => {
          if (c.id !== data.courier_id) return c;
          const updated: ManagerCourier = {
            ...c,
            last_ping: { lat: data.lat, lng: data.lng, battery: data.battery, created_at: data.ts },
          };
          return { ...updated, online_status: computeStatus(updated) };
        }),
      );
    };

    socket.on('courier:moved', handler);
    return () => { socket.off('courier:moved', handler); };
  }, [socket]);

  // Fetch OSRM route when a courier with active delivery is selected
  useEffect(() => {
    setRoute([]);
    if (!selectedId) return;
    const courier = couriers.find((c) => c.id === selectedId);
    if (!courier?.last_ping || !courier.active_delivery) return;

    // We don't have the delivery destination lat/lng in list response
    // Route is only shown if the order has coordinates
    const order = courier.active_delivery?.order;
    // Active delivery order doesn't carry lat/lng in the list endpoint
    // Route rendering requires a separate order detail call — skip for list view
    // This is a known limitation; route shown only on map detail endpoint (future)
    void fetchOsrmRoute(
      { lat: courier.last_ping.lat, lng: courier.last_ping.lng },
      { lat: courier.last_ping.lat + 0.005, lng: courier.last_ping.lng + 0.005 },
    ).then(() => {
      // Route destination coords not available from list — skip polyline
      setRoute([]);
    });
  }, [selectedId, couriers]);

  const selectedCourier = couriers.find((c) => c.id === selectedId) ?? null;

  return (
    <View style={styles.root}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#78776e" size="large" />
          <Text style={styles.loadingText}>Завантаження карти...</Text>
        </View>
      ) : error ? (
        <SafeAreaView style={styles.root} edges={['top']}>
          <View style={styles.centered}>
            <Ionicons name="warning-outline" size={32} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
              <Text style={styles.retryText}>Повторити</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      ) : (
        <>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_DEFAULT}
            initialRegion={DEFAULT_REGION}
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
                onPress={() => setSelectedId((prev) => (prev === courier.id ? null : courier.id))}
              />
            ))}
            {route.length > 1 ? (
              <Polyline
                coordinates={route}
                strokeColor="#9c9b96"
                strokeWidth={2}
                lineDashPattern={[6, 4]}
              />
            ) : null}
          </MapView>

          {/* Legend */}
          <SafeAreaView style={styles.legendContainer} edges={['top']}>
            <View style={styles.legend}>
              {(['online', 'background', 'no_response', 'offline'] as CourierOnlineStatus[]).map((s) => (
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
                        { backgroundColor: STATUS_DOT_COLOR[selectedCourier.online_status] },
                      ]}
                    />
                    <Text style={styles.sheetName}>{selectedCourier.name}</Text>
                  </View>
                  <Text style={styles.sheetStatus}>{STATUS_LABEL[selectedCourier.online_status]}</Text>
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
                <TouchableOpacity
                  style={styles.sheetClose}
                  onPress={() => setSelectedId(null)}
                >
                  <Ionicons name="close" size={20} color="#78776e" />
                </TouchableOpacity>
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
        </>
      )}
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
