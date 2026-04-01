'use client';

/**
 * Leaflet map for the public tracking embed.
 * Light theme — CartoDB Positron tiles.
 * Shows: order destination marker, courier animated marker, OSRM route.
 */

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Map, Marker, Polyline } from 'leaflet';
import type { GeoJsonLineString } from './types';

interface Props {
  orderLat: number;
  orderLng: number;
  courierLat: number | null;
  courierLng: number | null;
  routeGeometry: GeoJsonLineString | null;
  transportIcon: string;
}

function makeOrderMarkerHtml(): string {
  return `<div style="
    width:24px;height:24px;border-radius:50%;
    background:#3d7a5a;
    border:3px solid white;
    box-shadow:0 2px 8px rgba(0,0,0,0.3);
    display:flex;align-items:center;justify-content:center;
    font-size:11px;
  ">📍</div>`;
}

function makeCourierMarkerHtml(icon: string): string {
  return `<div style="
    width:32px;height:32px;border-radius:50%;
    background:#3d7a5a;
    border:3px solid white;
    box-shadow:0 2px 8px rgba(0,0,0,0.3);
    display:flex;align-items:center;justify-content:center;
    font-size:16px;
    transition:all 0.8s ease;
  ">${icon}</div>`;
}

export function MapView({ orderLat, orderLng, courierLat, courierLng, routeGeometry, transportIcon }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<Map | null>(null);
  const courierMarkerRef = useRef<Marker | null>(null);
  const routeLayerRef = useRef<Polyline | null>(null);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;
    let mounted = true;

    import('leaflet').then((L) => {
      if (!mounted || !mapRef.current || leafletRef.current) return;

      const map = L.map(mapRef.current, { zoomControl: true }).setView(
        [orderLat, orderLng],
        14,
      );
      leafletRef.current = map;

      // CartoDB Positron — light tiles
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(map);

      // Order destination marker
      const orderIcon = L.divIcon({
        html: makeOrderMarkerHtml(),
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([orderLat, orderLng], { icon: orderIcon }).addTo(map);

      // Courier marker if available
      if (courierLat != null && courierLng != null) {
        const courierIcon = L.divIcon({
          html: makeCourierMarkerHtml(transportIcon),
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        courierMarkerRef.current = L.marker([courierLat, courierLng], {
          icon: courierIcon,
        }).addTo(map);
      }

      // Route if available
      if (routeGeometry) {
        const latlngs = routeGeometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as [number, number],
        );
        routeLayerRef.current = L.polyline(latlngs, {
          color: '#3d7a5a',
          weight: 4,
          opacity: 0.8,
          dashArray: '8, 6',
        }).addTo(map);
      }

      // Fit bounds to show both order and courier
      const points: [number, number][] = [[orderLat, orderLng]];
      if (courierLat != null && courierLng != null) {
        points.push([courierLat, courierLng]);
      }
      if (points.length > 1) {
        map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
      }
    });

    return () => {
      mounted = false;
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animate courier marker when position changes
  useEffect(() => {
    if (!leafletRef.current || courierLat == null || courierLng == null) return;
    import('leaflet').then((L) => {
      if (!leafletRef.current) return;
      if (courierMarkerRef.current) {
        // Smooth pan — CSS transition handles the animation via divIcon
        courierMarkerRef.current.setLatLng([courierLat, courierLng]);
      } else {
        // First courier position received after map init
        const courierIcon = L.divIcon({
          html: makeCourierMarkerHtml(transportIcon),
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        courierMarkerRef.current = L.marker([courierLat, courierLng], {
          icon: courierIcon,
        }).addTo(leafletRef.current);
      }
    });
  }, [courierLat, courierLng]);

  // Update route polyline
  useEffect(() => {
    if (!leafletRef.current) return;
    import('leaflet').then((L) => {
      if (!leafletRef.current) return;
      if (routeLayerRef.current) {
        leafletRef.current.removeLayer(routeLayerRef.current);
        routeLayerRef.current = null;
      }
      if (routeGeometry) {
        const latlngs = routeGeometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as [number, number],
        );
        routeLayerRef.current = L.polyline(latlngs, {
          color: '#3d7a5a',
          weight: 4,
          opacity: 0.8,
          dashArray: '8, 6',
        }).addTo(leafletRef.current);
      }
    });
  }, [routeGeometry]);

  return (
    <div
      ref={mapRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height: '220px' }}
    />
  );
}
