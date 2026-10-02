import AsyncStorage from "@react-native-async-storage/async-storage";

const OUTBOX_KEY = "transport_outbox_v1";
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const MAX_BATCH_SIZE = 50;
const MAX_ENTRIES = 2_000;

export type OutboxState = "pending" | "syncing" | "failed";
export type ConnectivityState = "ONLINE" | "OFFLINE" | "SYNCING" | "LAST_KNOWN";

interface OutboxBase {
  id: string;
  event_uid: string;
  sequence: number;
  captured_at: string;
  state: OutboxState;
  attempts: number;
  last_error: string | null;
}

export interface LocationOutboxEntry extends OutboxBase {
  kind: "location";
  payload: {
    lat: number;
    lng: number;
    accuracy: number | null;
    battery: number | null;
  };
}

export interface CheckEventOutboxEntry extends OutboxBase {
  kind: "check_event";
  payload: Record<string, unknown>;
}

export type TransportOutboxEntry = LocationOutboxEntry | CheckEventOutboxEntry;

export interface OutboxStatus {
  connectivity: ConnectivityState;
  pending: number;
  failed: number;
}

let queueLock: Promise<void> = Promise.resolve();

async function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = queueLock;
  let release!: () => void;
  queueLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function createEventUid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function readQueue(): Promise<TransportOutboxEntry[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TransportOutboxEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(entries: TransportOutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(
    OUTBOX_KEY,
    JSON.stringify(entries.slice(-MAX_ENTRIES)),
  );
}

async function enqueue(
  entry: Omit<TransportOutboxEntry, keyof OutboxBase | "kind"> &
    Pick<TransportOutboxEntry, "kind" | "payload"> &
    Partial<Pick<OutboxBase, "event_uid" | "captured_at">>,
): Promise<string> {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const eventUid = entry.event_uid ?? createEventUid();
    const nextSequence = (queue.at(-1)?.sequence ?? 0) + 1;
    queue.push({
      ...entry,
      id: eventUid,
      event_uid: eventUid,
      sequence: nextSequence,
      captured_at: entry.captured_at ?? new Date().toISOString(),
      state: "pending",
      attempts: 0,
      last_error: null,
    } as TransportOutboxEntry);
    await writeQueue(queue);
    return eventUid;
  });
}

export function enqueueLocation(input: {
  lat: number;
  lng: number;
  accuracy: number | null;
  battery: number | null;
  captured_at: string;
}): Promise<string> {
  return enqueue({
    kind: "location",
    captured_at: input.captured_at,
    payload: {
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy,
      battery: input.battery,
    },
  });
}

export function enqueuePassengerCheckEvent(
  payload: Record<string, unknown> & {
    event_uid?: string;
    captured_at?: string;
  },
): Promise<string> {
  return enqueue({
    kind: "check_event",
    event_uid: payload.event_uid,
    captured_at: payload.captured_at,
    payload,
  });
}

export async function flushTransportOutbox(
  accessToken: string,
): Promise<OutboxStatus> {
  const batch = await withQueueLock(async () => {
    const queue = await readQueue();
    const selected = queue
      .filter((entry) => entry.state !== "syncing")
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, MAX_BATCH_SIZE);
    const ids = new Set(selected.map((entry) => entry.id));
    await writeQueue(
      queue.map((entry) =>
        ids.has(entry.id) ? { ...entry, state: "syncing" as const } : entry,
      ),
    );
    return selected;
  });

  if (batch.length === 0) return getTransportOutboxStatus(true);

  const succeeded = new Set<string>();
  const errors = new Map<string, { terminal: boolean; message: string }>();
  const locations = batch.filter(
    (entry): entry is LocationOutboxEntry => entry.kind === "location",
  );
  const checkEvents = batch.filter(
    (entry): entry is CheckEventOutboxEntry => entry.kind === "check_event",
  );

  try {
    if (locations.length > 0) {
      const response = await fetch(`${API_URL}/api/v1/tracking/pings/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          pings: locations.map((entry) => ({
            event_uid: entry.event_uid,
            captured_at: entry.captured_at,
            ...entry.payload,
          })),
        }),
      });
      if (response.ok) {
        locations.forEach((entry) => succeeded.add(entry.id));
      } else {
        const message = `HTTP ${response.status}`;
        locations.forEach((entry) =>
          errors.set(entry.id, {
            terminal: response.status < 500 && response.status !== 401,
            message,
          }),
        );
      }
    }

    for (const entry of checkEvents) {
      const response = await fetch(`${API_URL}/api/v1/transport/check-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          ...entry.payload,
          event_uid: entry.event_uid,
          captured_at: entry.captured_at,
          validation_status: "provisional_offline",
        }),
      });
      if (response.ok) succeeded.add(entry.id);
      else {
        errors.set(entry.id, {
          terminal: response.status < 500 && response.status !== 401,
          message: `HTTP ${response.status}`,
        });
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network unavailable";
    batch.forEach((entry) => {
      if (!succeeded.has(entry.id)) {
        errors.set(entry.id, { terminal: false, message });
      }
    });
  }

  await withQueueLock(async () => {
    const queue = await readQueue();
    await writeQueue(
      queue
        .filter((entry) => !succeeded.has(entry.id))
        .map((entry) => {
          const error = errors.get(entry.id);
          if (!error) return entry;
          return {
            ...entry,
            state: error.terminal ? ("failed" as const) : ("pending" as const),
            attempts: entry.attempts + 1,
            last_error: error.message,
          };
        }),
    );
  });

  return getTransportOutboxStatus(errors.size === 0);
}

export async function getTransportOutboxStatus(
  networkSucceeded = false,
): Promise<OutboxStatus> {
  const queue = await withQueueLock(readQueue);
  const pending = queue.filter((entry) => entry.state !== "failed").length;
  const failed = queue.filter((entry) => entry.state === "failed").length;
  return {
    connectivity:
      pending > 0 ? (networkSucceeded ? "SYNCING" : "OFFLINE") : "ONLINE",
    pending,
    failed,
  };
}
