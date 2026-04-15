'use client';

import { useEffect, useRef } from 'react';

interface Props {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  /** When true the marker is not draggable (e.g. during save) */
  readonly?: boolean;
}

/**
 * Leaflet map with a single draggable pin.
 * Dynamically imported (no SSR) to avoid window-not-defined errors.
 */
export function CoordMap({ lat, lng, onChange, readonly = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a ref to the Leaflet map and marker so we can update them imperatively
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markerRef = useRef<import('leaflet').Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      // leaflet CSS — import once
      await import('leaflet/dist/leaflet.css' as string);

      if (cancelled || !containerRef.current) return;

      // Fix default icon paths broken by webpack/next bundling
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (mapRef.current) return; // already initialised (StrictMode double-effect)

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 16,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker([lat, lng], {
        draggable: !readonly,
      }).addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onChange(pos.lat, pos.lng);
      });

      mapRef.current = map;
      markerRef.current = marker;
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init once only

  // Sync lat/lng changes from parent (e.g. after geocoding WS event)
  useEffect(() => {
    if (!markerRef.current || !mapRef.current) return;
    const pos = markerRef.current.getLatLng();
    if (Math.abs(pos.lat - lat) > 0.000001 || Math.abs(pos.lng - lng) > 0.000001) {
      markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], mapRef.current.getZoom(), { animate: true });
    }
  }, [lat, lng]);

  // Toggle draggable when readonly prop changes
  useEffect(() => {
    if (!markerRef.current) return;
    if (readonly) {
      markerRef.current.dragging?.disable();
    } else {
      markerRef.current.dragging?.enable();
    }
  }, [readonly]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '260px',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid var(--br)',
      }}
    />
  );
}
