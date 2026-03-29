'use client';

/**
 * TrackWidget — main client component for the public tracking embed.
 *
 * Responsibilities:
 * - WebSocket connection to /public namespace (auth: tracking token)
 * - Real-time state updates (courier:location, delivery:status, delivery:eta, delivery:route, order:coords_ready)
 * - 6 UI states + TOKEN_EXPIRED + loading skeleton
 * - Show/Minimize toggle with sessionStorage persistence
 * - Reconnect → re-fetch snapshot to fill the gap
 * - Standalone (hosted page) vs iframe layout detection
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';

import { t, type Locale } from './i18n/translations';
import { LoadingSkeleton } from './LoadingSkeleton';
import { EtaBar } from './EtaBar';
import { MapView } from './MapView';
import {
  deriveWidgetState,
  TRANSPORT_ICON,
  type GeoJsonLineString,
  type TrackSnapshot,
  type WidgetState,
} from './types';

interface Props {
  token: string;
  initialSnapshot: TrackSnapshot | null;
}

const SESSION_KEY = 'weego_widget_minimized';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3000';

async function fetchSnapshot(token: string): Promise<TrackSnapshot | null> {
  try {
    const res = await fetch(`/api/v1/public/track/${token}`);
    if (!res.ok) return null;
    return (await res.json()) as TrackSnapshot;
  } catch {
    return null;
  }
}

export function TrackWidget({ token, initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState<TrackSnapshot | null>(initialSnapshot);
  const [isMinimized, setIsMinimized] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(SESSION_KEY) === 'true';
  });
  const [isExpired, setIsExpired] = useState(false);

  // Detect if we're inside an iframe
  const isIframe =
    typeof window !== 'undefined' && window.self !== window.top;

  const socketRef = useRef<Socket | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Overlay cursor coordinates onto snapshot for real-time courier position
  const [courierPos, setCourierPos] = useState<{ lat: number; lng: number } | null>(
    snapshot?.courierLat != null && snapshot?.courierLng != null
      ? { lat: snapshot.courierLat, lng: snapshot.courierLng }
      : null,
  );
  const [liveEta, setLiveEta] = useState<number | null>(snapshot?.etaSeconds ?? null);
  const [liveRoute, setLiveRoute] = useState<GeoJsonLineString | null>(
    snapshot?.routeGeometry ?? null,
  );
  const [liveOrderCoords, setLiveOrderCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(
    snapshot?.orderLat != null && snapshot?.orderLng != null
      ? { lat: snapshot.orderLat, lng: snapshot.orderLng }
      : null,
  );

  const handleMinimize = useCallback(() => {
    setIsMinimized((prev) => {
      const next = !prev;
      sessionStorage.setItem(SESSION_KEY, String(next));
      return next;
    });
  }, []);

  // WebSocket setup
  useEffect(() => {
    const socket = io(`${WS_URL}/public`, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });
    socketRef.current = socket;

    // Track last disconnect time to debounce snapshot re-fetches on rapid reconnects.
    // Avoids thundering herd: 20 reconnect attempts × HTTP fetch during API downtime.
    let lastDisconnectAt = 0;

    socket.on('disconnect', () => {
      lastDisconnectAt = Date.now();
    });

    socket.on('connect', async () => {
      // Skip re-fetch if reconnect happened < 5s after disconnect (transient blip).
      // On first connect lastDisconnectAt is 0, so the gap is always > 5s.
      if (Date.now() - lastDisconnectAt < 5_000) return;

      // Re-fetch snapshot on (re)connect to fill any gap
      const fresh = await fetchSnapshot(token);
      if (fresh) {
        setSnapshot(fresh);
        if (fresh.courierLat != null && fresh.courierLng != null) {
          setCourierPos({ lat: fresh.courierLat, lng: fresh.courierLng });
        }
        setLiveEta(fresh.etaSeconds);
        setLiveRoute(fresh.routeGeometry);
        if (fresh.orderLat != null && fresh.orderLng != null) {
          setLiveOrderCoords({ lat: fresh.orderLat, lng: fresh.orderLng });
        }
      }
    });

    socket.on('courier:location', (data: { lat: number; lng: number }) => {
      setCourierPos(data);
    });

    socket.on(
      'delivery:status',
      (data: { orderStatus: string; deliveryStatus: string | null }) => {
        setSnapshot((prev) =>
          prev
            ? { ...prev, orderStatus: data.orderStatus, deliveryStatus: data.deliveryStatus }
            : prev,
        );
      },
    );

    socket.on('delivery:eta', (data: { etaSeconds: number }) => {
      setLiveEta(data.etaSeconds);
    });

    socket.on('delivery:route', (data: { routeGeometry: GeoJsonLineString }) => {
      setLiveRoute(data.routeGeometry);
    });

    socket.on('order:coords_ready', (data: { lat: number; lng: number }) => {
      setSnapshot((prev) => (prev ? { ...prev, orderLat: data.lat, orderLng: data.lng } : prev));
      setLiveOrderCoords(data);
    });

    socket.on('error', (data: { type: string }) => {
      if (data.type === 'TOKEN_EXPIRED') {
        setIsExpired(true);
        socket.disconnect();
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const locale = (snapshot?.locale as Locale | undefined) ?? 'uk';

  // Determine widget state
  const widgetState: WidgetState = isExpired
    ? 'expired'
    : snapshot === null
      ? 'loading'
      : deriveWidgetState(snapshot);

  const establishmentName = snapshot?.establishmentName ?? '';
  const courierName = snapshot?.courierName ?? '';
  const transportMode = snapshot?.courierTransportMode ?? 'moto_gas';
  const transportIcon = TRANSPORT_ICON[transportMode] ?? '🛵';

  // Order coords: prefer live (post-geocoding WS) over snapshot
  const orderLat = liveOrderCoords?.lat ?? snapshot?.orderLat ?? null;
  const orderLng = liveOrderCoords?.lng ?? snapshot?.orderLng ?? null;
  const hasMap = orderLat != null && orderLng != null;

  const etaForDisplay = liveEta ?? snapshot?.etaSeconds ?? null;

  // ── Minimized bar ─────────────────────────────────────────────────────────

  function getMinimizedLabel(): string {
    if (isExpired) return t('minExpired', locale);
    switch (widgetState) {
      case 'loading': return t('loading', locale);
      case 'state0':  return t('minState0', locale);
      case 'state1':  return t('minState1', locale);
      case 'state2': {
        const etaMin = etaForDisplay != null && etaForDisplay > 0
          ? Math.ceil(etaForDisplay / 60)
          : null;
        return etaMin != null
          ? t('minState2', locale)(courierName, etaMin)
          : t('minState2NoEta', locale)(courierName);
      }
      case 'state3':  return t('minState3', locale);
      case 'state4':  return t('minState4', locale);
      case 'state5':  return t('minState5', locale);
      case 'expired': return t('minExpired', locale);
    }
  }

  if (isMinimized) {
    return (
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl shadow-lg cursor-pointer select-none ${
          isIframe
            ? 'fixed bottom-4 left-4 right-4 z-50'
            : 'w-full'
        }`}
        style={{ background: '#fff', border: '1px solid #e5e7eb' }}
        onClick={handleMinimize}
        role="button"
        aria-label={t('expand', locale)}
      >
        <span className="text-sm font-medium text-gray-800">{getMinimizedLabel()}</span>
        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 16 16" fill="none">
          <path d="M3 10l5-5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  // ── Full widget ───────────────────────────────────────────────────────────

  function renderContent() {
    if (widgetState === 'loading') {
      return <LoadingSkeleton />;
    }

    if (widgetState === 'expired') {
      return (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <span className="text-2xl">⏱</span>
          <p className="text-base font-semibold text-gray-700">{t('trackingExpired', locale)}</p>
        </div>
      );
    }

    if (widgetState === 'state3') {
      return (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <span className="text-4xl">✅</span>
          <p className="text-xl font-bold text-gray-900">{t('delivered', locale)}</p>
          {establishmentName && (
            <p className="text-sm text-gray-500">
              {t('thankYou', locale)} <strong>{establishmentName}</strong>
            </p>
          )}
        </div>
      );
    }

    if (widgetState === 'state4') {
      return (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
          <span className="text-3xl">❌</span>
          <p className="text-base font-bold text-gray-900">{t('cancelled', locale)}</p>
          <p className="text-sm text-gray-500">{t('cancelledNote', locale)}</p>
        </div>
      );
    }

    if (widgetState === 'state5') {
      return (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
          <span className="text-3xl">⚠️</span>
          <p className="text-base font-bold text-gray-900">{t('failed', locale)}</p>
          <p className="text-sm text-gray-500">{t('failedNote', locale)}</p>
        </div>
      );
    }

    if (widgetState === 'state0') {
      return (
        <div className="flex flex-col gap-3 py-4 px-1">
          <div className="flex items-start gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-base font-bold text-gray-900">{t('orderAccepted', locale)}</p>
              <p className="text-sm text-gray-500 mt-0.5">{t('waitingForCourier', locale)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 text-sm text-gray-400">
            <LoadingDots />
            <span>{t('findingCourier', locale)}</span>
          </div>
        </div>
      );
    }

    if (widgetState === 'state1') {
      return (
        <div className="flex flex-col gap-3 py-4 px-1">
          <div className="flex items-start gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-base font-bold text-gray-900">{t('orderAccepted', locale)}</p>
              <p className="text-sm text-gray-600 mt-0.5">{t('orderPreparing', locale)}</p>
              {courierName && (
                <p className="text-sm text-gray-700 mt-1 font-medium">
                  {t('courier', locale)}: {courierName}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
            <LoadingDots />
            <span>{t('waitingForDeparture', locale)}</span>
          </div>
          {etaForDisplay != null && etaForDisplay > 0 && (
            <EtaBar
              etaSeconds={etaForDisplay}
              slaDeadline={snapshot?.slaDeadline ?? null}
              locale={locale}
            />
          )}
        </div>
      );
    }

    // State 2 — in_progress
    return (
      <div className="flex flex-col gap-3 py-2 px-1">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-2xl">{transportIcon}</span>
          <p className="text-base font-bold text-gray-900">
            {courierName} {t('courierEnRoute', locale)}
          </p>
        </div>

        {/* ETA bar */}
        {etaForDisplay != null && (
          <EtaBar
            etaSeconds={etaForDisplay}
            slaDeadline={snapshot?.slaDeadline ?? null}
            locale={locale}
          />
        )}

        {/* Map */}
        {hasMap ? (
          <MapView
            orderLat={orderLat!}
            orderLng={orderLng!}
            courierLat={courierPos?.lat ?? snapshot?.courierLat ?? null}
            courierLng={courierPos?.lng ?? snapshot?.courierLng ?? null}
            routeGeometry={liveRoute}
            transportIcon={transportIcon}
          />
        ) : (
          <p className="text-xs text-gray-400">{t('noCoords', locale)}</p>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col rounded-xl shadow-lg overflow-hidden ${
        isIframe ? 'fixed bottom-4 left-4 right-4 z-50 max-h-[80vh] overflow-y-auto' : 'w-full'
      }`}
      style={{ background: '#fff', border: '1px solid #e5e7eb' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-100"
        style={{ background: '#f9fafb' }}
      >
        <p className="text-sm font-semibold text-gray-700 truncate">{establishmentName}</p>
        {/* Don't show minimize for terminal states or expired */}
        {!['state3', 'state4', 'state5', 'expired'].includes(widgetState) && (
          <button
            onClick={handleMinimize}
            className="ml-2 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            aria-label={t('minimize', locale)}
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
              <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pb-4">{renderContent()}</div>
    </div>
  );
}

/** Three-dot loading animation */
function LoadingDots() {
  return (
    <span className="flex gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
