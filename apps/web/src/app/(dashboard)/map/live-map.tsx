'use client';

import { useEffect, useRef } from 'react';
import { CourierWithStatus, CourierMovedEvent } from '@/types';
import { getSocket } from '@/lib/socket';

interface Props {
  couriers: CourierWithStatus[];
}

export function LiveMap({ couriers }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMapRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    // Dynamic import — Leaflet uses `window`, so it can't be bundled as SSR
    import('leaflet').then((L) => {
      // Fix default icon paths (Next.js asset handling)
      // @ts-expect-error Leaflet internal
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      // Center on Kyiv by default
      const map = L.map(mapRef.current!).setView([50.45, 30.52], 12);
      leafletMapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Add initial markers for couriers with known positions
      couriers.forEach((courier) => {
        if (courier.last_lat == null || courier.last_lng == null) return;

        const color = courier.status === 'online' ? '#22c55e' : courier.status === 'background' ? '#eab308' : '#ef4444';
        const icon = L.divIcon({
          html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
          className: '',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        const marker = L.marker([courier.last_lat, courier.last_lng], { icon })
          .addTo(map)
          .bindPopup(`<b>${courier.name}</b><br>${courier.phone}`);

        markersRef.current.set(courier.id, { marker, L });
      });

      // Socket.IO real-time updates
      const socket = getSocket();
      socket.on('courier:moved', (event: CourierMovedEvent) => {
        const entry = markersRef.current.get(event.courier_id);
        if (entry) {
          entry.marker.setLatLng([event.lat, event.lng]);
        } else {
          // New courier just came online — add marker
          const icon = L.divIcon({
            html: `<div style="background:#22c55e;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          const marker = L.marker([event.lat, event.lng], { icon }).addTo(map);
          markersRef.current.set(event.courier_id, { marker, L });
        }
      });

      return () => {
        socket.off('courier:moved');
      };
    });

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Leaflet CSS */}
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <div ref={mapRef} className="w-full h-full" />
    </>
  );
}
