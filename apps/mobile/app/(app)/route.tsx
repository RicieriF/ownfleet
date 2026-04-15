/**
 * Route tab — live map with delivery destination.
 *
 * States:
 *  - No active shift / no delivery → empty state (idle)
 *  - Delivery assigned             → map with destination marker + card
 *  - Delivery in_progress          → map + OSRM route from courier location + card
 *  - Delivery has no coordinates   → card-only (no map)
 *  - Expo Go                       → fallback (react-native-maps requires EAS build)
 *
 * Map: react-native-maps, dark mode, userInterfaceStyle=dark.
 * Route: OSRM — fetched from courier's current device location to destination.
 * Location: one-time read via expo-location (no background tracking started here).
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { apiGet, apiPatch } from '@/api/client';
import { useShiftStore } from '@/store/shift';
import { ActiveDelivery, TransportMode } from '@/types';
import { TabBar } from '@/components/tab-bar';

// ── react-native-maps lazy import (crashes in Expo Go) ────────────────────

let MapView: React.ComponentType<any> | null = null;
let Marker: React.ComponentType<any> | null = null;
let Polyline: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const maps = require('react-native-maps') as typeof import('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
} catch {
  // Not available in Expo Go
}

const isExpoGo = Constants.appOwnership === 'expo';

// ── OSRM ──────────────────────────────────────────────────────────────────

const OSRM_URL =
  process.env.EXPO_PUBLIC_OSRM_URL ?? 'https://router.project-osrm.org';

function resolveOsrmProfile(mode: TransportMode | null): string {
  if (mode === 'bicycle') return 'cycling';
  if (mode === 'walking') return 'foot';
  return 'driving';
}

type LatLng = { latitude: number; longitude: number };

async function fetchOsrmRoute(
  from: LatLng,
  to: LatLng,
  profile: string,
  signal: AbortSignal,
): Promise<LatLng[]> {
  const url = `${OSRM_URL}/route/v1/${profile}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal });
  const data = await res.json() as {
    routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
  };
  const coords = data.routes?.[0]?.geometry?.coordinates;
  if (!coords) return [];
  return coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

// ── Main Screen ────────────────────────────────────────────────────────────

export default function RouteScreen() {
  const router = useRouter();
  const { shift } = useShiftStore();
  const [delivery, setDelivery] = useState<ActiveDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [courierLoc, setCourierLoc] = useState<LatLng | null>(null);
  const [route, setRoute] = useState<LatLng[]>([]);
  const mapRef = useRef<any>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const transportMode = useRef<TransportMode | null>(null);

  const fetchDelivery = useCallback(async () => {
    try {
      const d = await apiGet<ActiveDelivery | null>('/api/v1/deliveries/active');
      setDelivery(d);
      return d;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Get courier's current device location (one-time on focus, passive read)
  const refreshLocation = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCourierLoc({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch {
      // Non-critical — map still shows without route
    }
  }, []);

  // Refresh when tab comes into focus
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      setRoute([]);
      Promise.all([fetchDelivery(), refreshLocation()]);
    }, [fetchDelivery, refreshLocation]),
  );

  // Fetch transport mode for OSRM profile
  useEffect(() => {
    apiGet<{ transport_mode: TransportMode | null }>('/api/v1/couriers/me')
      .then((data) => { transportMode.current = data.transport_mode; })
      .catch(() => {});
  }, []);

  // Fetch OSRM route when delivery in_progress and both locations known
  useEffect(() => {
    routeAbortRef.current?.abort();
    setRoute([]);

    if (
      delivery?.status !== 'in_progress' ||
      !courierLoc ||
      !delivery.order.lat ||
      !delivery.order.lng
    ) return;

    const dest: LatLng = { latitude: delivery.order.lat, longitude: delivery.order.lng };
    const profile = resolveOsrmProfile(transportMode.current);
    const controller = new AbortController();
    routeAbortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 5000);

    fetchOsrmRoute(courierLoc, dest, profile, controller.signal)
      .then((coords) => {
        if (!controller.signal.aborted) setRoute(coords);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [delivery?.id, delivery?.status, delivery?.order.lat, delivery?.order.lng, courierLoc]);

  // Fit map to show both points when route loads
  useEffect(() => {
    if (!mapRef.current || !delivery?.order.lat || !delivery?.order.lng) return;
    const points: LatLng[] = [];
    if (courierLoc) points.push(courierLoc);
    points.push({ latitude: delivery.order.lat, longitude: delivery.order.lng });
    if (points.length > 1) {
      const t = setTimeout(() => {
        mapRef.current?.fitToCoordinates(points, {
          edgePadding: { top: 80, bottom: 260, left: 48, right: 48 },
          animated: true,
        });
      }, 400);
      return () => clearTimeout(t);
    }
  }, [route.length, delivery?.id, courierLoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Delivery actions ───────────────────────────────────────────────────

  async function handleAccept() {
    if (!delivery) return;
    setActionLoading(true);
    try {
      const updated = await apiPatch<ActiveDelivery>(`/api/v1/deliveries/${delivery.id}/start`);
      setDelivery(updated);
    } catch {
      Alert.alert('Помилка', 'Не вдалося прийняти доставку. Спробуйте ще раз.');
    } finally {
      setActionLoading(false);
    }
  }

  function handleNavigate() {
    if (!delivery) return;
    router.push({
      pathname: '/(app)/navigate',
      params: {
        deliveryId: delivery.id,
        address: delivery.order.address,
        lat: delivery.order.lat ?? '',
        lng: delivery.order.lng ?? '',
        notes: delivery.order.notes ?? '',
        externalId: delivery.order.external_id ?? '',
        startedAt: delivery.started_at ?? '',
      },
    });
  }

  function handleComplete() {
    if (!delivery) return;
    router.push({ pathname: '/(app)/proof', params: { deliveryId: delivery.id } });
  }

  function handleFail() {
    if (!delivery) return;
    router.push({
      pathname: '/(app)/fail',
      params: {
        deliveryId: delivery.id,
        address: delivery.order.address,
        externalId: delivery.order.external_id ?? '',
      },
    });
  }

  // ── Render helpers ─────────────────────────────────────────────────────

  const hasCoords = !!(delivery?.order.lat && delivery?.order.lng);

  // ── Expo Go fallback ───────────────────────────────────────────────────

  if (isExpoGo || MapView === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Маршрут</Text>
        </View>
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator color="#9c9b96" />
          ) : !shift ? (
            <EmptyState
              icon="time-outline"
              title="Ви не на зміні"
              subtitle="Почніть зміну на екрані «Доставки», щоб бачити маршрут"
            />
          ) : !delivery ? (
            <EmptyState
              icon="hourglass-outline"
              title="Немає активної доставки"
              subtitle="Коли менеджер призначить замовлення, маршрут зʼявиться тут"
            />
          ) : (
            <View>
              <View style={styles.fallbackMapBanner}>
                <Ionicons name="map-outline" size={18} color="#78776e" />
                <Text style={styles.fallbackMapText}>
                  Карта доступна лише в EAS-білді
                </Text>
              </View>
              <DeliveryCard
                delivery={delivery}
                onAccept={handleAccept}
                onNavigate={handleNavigate}
                onComplete={handleComplete}
                onFail={handleFail}
                actionLoading={actionLoading}
              />
            </View>
          )}
        </View>
        <TabBar />
      </SafeAreaView>
    );
  }

  // ── Full map render ────────────────────────────────────────────────────

  const MapViewC = MapView as React.ComponentType<any>;
  const MarkerC = Marker as React.ComponentType<any>;
  const PolylineC = Polyline as React.ComponentType<any>;

  // Initial region: destination or Kyiv fallback
  const initialRegion = hasCoords
    ? {
        latitude: delivery!.order.lat!,
        longitude: delivery!.order.lng!,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }
    : { latitude: 50.4501, longitude: 30.5234, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Маршрут</Text>
        {delivery?.status === 'in_progress' && (
          <View style={styles.gpsRow}>
            <View style={styles.gpsDot} />
            <Text style={styles.gpsText}>GPS активний</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#9c9b96" size="large" />
        </View>
      ) : !shift ? (
        <View style={styles.content}>
          <EmptyState
            icon="time-outline"
            title="Ви не на зміні"
            subtitle="Почніть зміну на екрані «Доставки», щоб бачити маршрут"
          />
        </View>
      ) : !delivery ? (
        <View style={styles.content}>
          <EmptyState
            icon="hourglass-outline"
            title="Немає активної доставки"
            subtitle="Коли менеджер призначить замовлення, маршрут зʼявиться тут"
          />
        </View>
      ) : !hasCoords ? (
        /* Delivery has no geocoded coordinates — card only */
        <View style={styles.content}>
          <View style={styles.noCoordsCard}>
            <Ionicons name="location-outline" size={20} color="#78776e" style={{ marginBottom: 8 }} />
            <Text style={styles.noCoordsText}>Адресу ще не геокодовано</Text>
          </View>
          <DeliveryCard
            delivery={delivery}
            onAccept={handleAccept}
            onNavigate={handleNavigate}
            onComplete={handleComplete}
            onFail={handleFail}
            actionLoading={actionLoading}
          />
        </View>
      ) : (
        /* Map + overlay card */
        <View style={styles.mapContainer}>
          <MapViewC
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            mapType="standard"
            userInterfaceStyle="dark"
            showsUserLocation
            showsCompass={false}
            showsScale={false}
            showsMyLocationButton={false}
          >
            {/* Destination marker */}
            <MarkerC
              coordinate={{ latitude: delivery.order.lat!, longitude: delivery.order.lng! }}
              anchor={{ x: 0.5, y: 1.0 }}
            >
              <View style={styles.destMarker}>
                <Ionicons name="location" size={28} color="#faf9f6" />
              </View>
            </MarkerC>

            {/* OSRM route */}
            {route.length > 1 && (
              <PolylineC
                coordinates={route}
                strokeColor="#9c9b96"
                strokeWidth={3}
                lineDashPattern={Platform.OS === 'android' ? undefined : [8, 4]}
              />
            )}
          </MapViewC>

          {/* Re-center button */}
          {courierLoc && (
            <TouchableOpacity
              style={styles.recenterBtn}
              onPress={() => {
                if (!delivery.order.lat || !delivery.order.lng) return;
                const points: LatLng[] = [
                  courierLoc,
                  { latitude: delivery.order.lat, longitude: delivery.order.lng },
                ];
                mapRef.current?.fitToCoordinates(points, {
                  edgePadding: { top: 80, bottom: 260, left: 48, right: 48 },
                  animated: true,
                });
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="navigate-circle-outline" size={26} color="#faf9f6" />
            </TouchableOpacity>
          )}

          {/* Overlay card */}
          <View style={styles.cardOverlay}>
            <DeliveryCard
              delivery={delivery}
              onAccept={handleAccept}
              onNavigate={handleNavigate}
              onComplete={handleComplete}
              onFail={handleFail}
              actionLoading={actionLoading}
            />
          </View>
        </View>
      )}

      <TabBar />
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon} size={48} color="#3a3935" style={{ marginBottom: 16 }} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

function DeliveryCard({
  delivery,
  onAccept,
  onNavigate,
  onComplete,
  onFail,
  actionLoading,
}: {
  delivery: ActiveDelivery;
  onAccept: () => void;
  onNavigate: () => void;
  onComplete: () => void;
  onFail: () => void;
  actionLoading: boolean;
}) {
  const isAssigned = delivery.status === 'assigned';

  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, !isAssigned && styles.statusDotActive]} />
        <Text style={styles.statusText}>
          {isAssigned ? 'Нове замовлення' : 'Доставка активна'}
        </Text>
      </View>

      <Text style={styles.address} numberOfLines={2}>{delivery.order.address}</Text>

      {delivery.order.notes ? (
        <Text style={styles.notes} numberOfLines={1}>{delivery.order.notes}</Text>
      ) : null}
      {delivery.order.external_id ? (
        <Text style={styles.externalId}>№ {delivery.order.external_id}</Text>
      ) : null}

      {isAssigned ? (
        <TouchableOpacity
          style={[styles.btn, styles.btnAccept, actionLoading && styles.btnDisabled]}
          onPress={onAccept}
          disabled={actionLoading}
          activeOpacity={0.8}
        >
          {actionLoading ? (
            <ActivityIndicator color="#faf9f6" />
          ) : (
            <Text style={styles.btnText}>Прийняти доставку</Text>
          )}
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity style={[styles.btn, styles.btnNavigate]} onPress={onNavigate} activeOpacity={0.8}>
            <Ionicons name="navigate-outline" size={17} color="#faf9f6" style={{ marginRight: 6 }} />
            <Text style={styles.btnText}>Відкрити навігацію</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnComplete]} onPress={onComplete} activeOpacity={0.8}>
            <Text style={styles.btnText}>Підтвердити доставку</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.failLink} onPress={onFail} activeOpacity={0.7}>
            <Text style={styles.failLinkText}>Не вдалося доставити</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0c0b09',
    zIndex: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
  },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gpsDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  gpsText: { fontSize: 12, color: '#9c9b96', fontFamily: 'Manrope_400Regular' },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },

  // Map container
  mapContainer: {
    flex: 1,
    position: 'relative',
  },

  // Re-center button
  recenterBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: 'rgba(26,25,23,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Bottom overlay card on map
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 8,
    backgroundColor: 'rgba(12,11,9,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,249,246,0.08)',
  },

  // Empty states
  emptyState: { alignItems: 'center', paddingHorizontal: 32 },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    fontFamily: 'Manrope_400Regular',
    color: '#78776e',
    textAlign: 'center',
    lineHeight: 20,
  },

  // No coords notice
  noCoordsCard: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  noCoordsText: {
    fontSize: 13,
    color: '#78776e',
    fontFamily: 'Manrope_400Regular',
  },

  // Expo Go fallback banner
  fallbackMapBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1a1917',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  fallbackMapText: {
    fontSize: 12,
    color: '#78776e',
    fontFamily: 'Manrope_400Regular',
  },

  // Delivery card
  card: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9c9b96' },
  statusDotActive: { backgroundColor: '#22c55e' },
  statusText: { color: '#9c9b96', fontSize: 13, fontFamily: 'Manrope_500Medium' },
  address: {
    fontSize: 18,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    lineHeight: 24,
    marginBottom: 6,
  },
  notes: { fontSize: 13, color: '#9c9b96', marginBottom: 4, fontFamily: 'Manrope_400Regular' },
  externalId: {
    fontSize: 12,
    color: '#78776e',
    marginBottom: 14,
    fontFamily: 'JetBrainsMono_400Regular',
  },

  // Destination marker
  destMarker: { alignItems: 'center' },

  btn: {
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btnAccept: {
    backgroundColor: '#3a3935',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
  },
  btnNavigate: {
    backgroundColor: '#252420',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.10)',
  },
  btnComplete: {
    backgroundColor: '#3a3935',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#faf9f6', fontSize: 16, fontFamily: 'Manrope_600SemiBold' },
  failLink: { alignItems: 'center', paddingTop: 12, marginTop: 2 },
  failLinkText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: '#78776e',
    textDecorationLine: 'underline',
    textDecorationColor: 'rgba(120,119,110,0.5)',
  },
});
