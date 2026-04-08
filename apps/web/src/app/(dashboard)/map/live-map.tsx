'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { CourierWithStatus, CourierMovedEvent } from '@/types';
import { getSocket } from '@/lib/socket';

interface Props {
  couriers: CourierWithStatus[];
  initialCenter?: [number, number];
}

const STATUS_COLOR: Record<string, string> = {
  online:         '#22c55e',
  background:     '#f59e0b',
  not_responding: '#ef4444',
  offline:        '#71717a',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function makeMarkerHtml(name: string, status: string): string {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.offline;
  const initials = getInitials(name);
  return `<div style="
    background:${color};
    width:32px;height:32px;border-radius:50%;
    border:2px solid rgba(255,255,255,0.15);
    box-shadow:0 2px 8px rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;
    font-family:Manrope,system-ui,sans-serif;
    font-size:11px;font-weight:700;
    color:var(--bg);
    user-select:none;
  ">${initials}</div>`;
}

export function LiveMap({ couriers, initialCenter }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMapRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    // Hoist socket outside .then() so cleanup can call socket.off()
    const socket = getSocket();
    let mounted = true;

    import('leaflet').then((L) => {
      if (!mounted || !mapRef.current) return;

      const center: [number, number] = initialCenter ?? [50.45, 30.52];
      const map = L.map(mapRef.current!).setView(center, 12);
      leafletMapRef.current = map;

      // CartoDB Dark Matter tiles — per design system
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(map);

      couriers.forEach((courier) => {
        if (courier.last_lat == null || courier.last_lng == null) return;

        const icon = L.divIcon({
          html: makeMarkerHtml(courier.name, courier.status),
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const marker = L.marker([courier.last_lat, courier.last_lng], { icon })
          .addTo(map)
          .bindPopup(`<b>${courier.name}</b><br>${courier.phone}`);

        markersRef.current.set(courier.id, { marker, name: courier.name });
      });

      socket.on('courier:moved', (event: CourierMovedEvent) => {
        const entry = markersRef.current.get(event.courier_id);
        if (entry) {
          entry.marker.setLatLng([event.lat, event.lng]);
        } else {
          const icon = L.divIcon({
            html: makeMarkerHtml(event.courier_id, 'online'),
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          });
          const marker = L.marker([event.lat, event.lng], { icon }).addTo(map);
          markersRef.current.set(event.courier_id, { marker, name: event.courier_id });
        }
      });
    });

    return () => {
      mounted = false;
      socket.off('courier:moved');
      markersRef.current.clear();
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <style>{`
        .leaflet-popup-content-wrapper {
          background: #18181b;
          color: #fafafa;
          border: 1px solid #27272a;
          border-radius: 6px;
          box-shadow: 0 4px 16px rgba(0,0,0,.6);
        }
        .leaflet-popup-tip { background: #18181b; }
        .leaflet-popup-content b { color: #fafafa; }
        .leaflet-control-attribution { background: rgba(9,9,11,.8) !important; color: #71717a !important; }
        .leaflet-control-attribution a { color: var(--acm) !important; }
        .leaflet-control-zoom a {
          background: #18181b !important;
          color: #a1a1aa !important;
          border-color: #27272a !important;
        }
        .leaflet-control-zoom a:hover { background: #27272a !important; color: #fafafa !important; }
      `}</style>
      <div ref={mapRef} className="w-full h-full" />
    </>
  );
}
