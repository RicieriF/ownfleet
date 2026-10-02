import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGet } from "../api/client";

const ROUTE_PACK_STATE_KEY = "transport_offline_route_packs_v1";

export interface OfflineRoutePackManifest {
  manifest_version: number;
  trip_id: string;
  route_id: string | null;
  revision: string;
  margin_meters: number;
  bounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  } | null;
  stops: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    sequence: number | null;
  }>;
  passenger_ids: string[];
}

export interface OfflineRoutePackProvider {
  readonly id: string;
  prepare(manifest: OfflineRoutePackManifest): Promise<void>;
  remove(tripId: string): Promise<void>;
}

export interface OfflineRoutePackState {
  trip_id: string;
  provider_id: string;
  revision: string;
  status: "PREPARING" | "READY" | "FAILED";
  updated_at: string;
  error: string | null;
}

async function readStates(): Promise<Record<string, OfflineRoutePackState>> {
  const raw = await AsyncStorage.getItem(ROUTE_PACK_STATE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, OfflineRoutePackState>;
  } catch {
    return {};
  }
}

async function writeState(state: OfflineRoutePackState): Promise<void> {
  const states = await readStates();
  states[state.trip_id] = state;
  await AsyncStorage.setItem(ROUTE_PACK_STATE_KEY, JSON.stringify(states));
}

export async function prepareOfflineRoutePack(
  tripId: string,
  provider: OfflineRoutePackProvider,
): Promise<OfflineRoutePackState> {
  const manifest = await apiGet<OfflineRoutePackManifest>(
    `/api/v1/transport/trips/${tripId}/offline-route-pack`,
  );
  const states = await readStates();
  const existing = states[tripId];
  if (
    existing?.status === "READY" &&
    existing.revision === manifest.revision &&
    existing.provider_id === provider.id
  ) {
    return existing;
  }

  const preparing: OfflineRoutePackState = {
    trip_id: tripId,
    provider_id: provider.id,
    revision: manifest.revision,
    status: "PREPARING",
    updated_at: new Date().toISOString(),
    error: null,
  };
  await writeState(preparing);
  try {
    await provider.prepare(manifest);
    const ready = {
      ...preparing,
      status: "READY" as const,
      updated_at: new Date().toISOString(),
    };
    await writeState(ready);
    return ready;
  } catch (error) {
    const failed = {
      ...preparing,
      status: "FAILED" as const,
      updated_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Route pack failed",
    };
    await writeState(failed);
    return failed;
  }
}

export async function getOfflineRoutePackState(
  tripId: string,
): Promise<OfflineRoutePackState | null> {
  return (await readStates())[tripId] ?? null;
}

export async function removeOfflineRoutePack(
  tripId: string,
  provider: OfflineRoutePackProvider,
): Promise<void> {
  await provider.remove(tripId);
  const states = await readStates();
  delete states[tripId];
  await AsyncStorage.setItem(ROUTE_PACK_STATE_KEY, JSON.stringify(states));
}
