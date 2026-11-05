import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface MapPoint {
  lat: number;
  lng: number;
  segment: number;
}

/**
 * Mapa del recorrido con OpenStreetMap. Sin conexión, el trazado igual se dibuja
 * (las calles aparecen solo si esos tiles ya estaban en caché).
 */
export default function RouteMap({ points, follow = false, className }: { points: MapPoint[]; follow?: boolean; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([-32.95, -60.65], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      className: 'fit20-tiles',
    }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    if (!points.length) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#d7ff3c';
    const bySeg = new Map<number, L.LatLngExpression[]>();
    for (const p of points) bySeg.set(p.segment, [...(bySeg.get(p.segment) ?? []), [p.lat, p.lng]]);
    for (const line of bySeg.values()) {
      L.polyline(line, { color: '#111', weight: 8, opacity: 0.5 }).addTo(g);
      L.polyline(line, { color: accent, weight: 5 }).addTo(g);
    }
    const first = points[0]!;
    const last = points[points.length - 1]!;
    L.circleMarker([first.lat, first.lng], { radius: 6, color: '#111', weight: 2, fillColor: '#43d6a0', fillOpacity: 1 }).addTo(g).bindTooltip('Inicio');
    L.circleMarker([last.lat, last.lng], { radius: 7, color: '#111', weight: 2, fillColor: follow ? accent : '#ff6250', fillOpacity: 1 }).addTo(g).bindTooltip(follow ? 'Vos' : 'Fin');

    if (follow) {
      m.setView([last.lat, last.lng], Math.max(m.getZoom(), 16), { animate: false });
    } else if (!fitted.current) {
      m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as L.LatLngTuple)), { padding: [24, 24], maxZoom: 17 });
      fitted.current = true;
    }
  }, [points, follow]);

  return <div ref={el} role="img" aria-label="Mapa del recorrido" className={className ?? 'h-64 w-full overflow-hidden rounded-3xl'} />;
}
