/**
 * IIIT Kottayam campus geometry (see project.md §8). The server derives zone and
 * normalized map coordinates from raw GPS so clients cannot spoof them.
 */

export interface CampusZone {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export const CAMPUS_ZONES: readonly CampusZone[] = [
  { id: "academic_1", name: "Academic Block 1", lat: 9.754904, lon: 76.649988 },
  { id: "academic_2", name: "Academic Block 2", lat: 9.755232, lon: 76.648973 },
  { id: "admin", name: "Admin Block", lat: 9.754938, lon: 76.649575 },
  { id: "oat", name: "Open Area Theatre (OAT)", lat: 9.755043, lon: 76.650634 },
  { id: "dining", name: "Dining Hall & Cafeteria", lat: 9.755678, lon: 76.650101 },
  { id: "fitness", name: "Fitness Centre / Gym", lat: 9.755684, lon: 76.649227 },
  { id: "sports_ground", name: "Main Sports Ground", lat: 9.754, lon: 76.649392 },
  { id: "volleyball", name: "Volleyball Ground", lat: 9.754986, lon: 76.651298 },
];

/** Playable-area bounding box with margin around the zone centres. */
export const CAMPUS_BOUNDS = {
  minLat: 9.7532,
  maxLat: 9.7564,
  minLon: 76.6482,
  maxLon: 76.6521,
} as const;

/** Map grid used by the surveillance portal (project.md §5.2). */
export const GRID = { width: 1000, height: 750 } as const;

/** A fix within this distance of a zone centre is attributed to that zone. */
export const ZONE_RADIUS_M = 75;

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Projection {
  x: number;
  y: number;
  inBounds: boolean;
  zoneId: string | null;
  zoneName: string | null;
}

export function projectToCampus(lat: number, lon: number): Projection {
  const b = CAMPUS_BOUNDS;
  const inBounds = lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
  const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(v, 0), max) * 10) / 10;
  const x = clamp(((lon - b.minLon) / (b.maxLon - b.minLon)) * GRID.width, GRID.width);
  const y = clamp(((b.maxLat - lat) / (b.maxLat - b.minLat)) * GRID.height, GRID.height);

  let zone: CampusZone | null = null;
  let best = Number.POSITIVE_INFINITY;
  if (inBounds) {
    for (const z of CAMPUS_ZONES) {
      const d = haversineMeters(lat, lon, z.lat, z.lon);
      if (d < best) {
        best = d;
        zone = z;
      }
    }
  }
  if (!inBounds) return { x, y, inBounds, zoneId: "out_of_bounds", zoneName: "Out of bounds" };
  if (zone && best <= ZONE_RADIUS_M) return { x, y, inBounds, zoneId: zone.id, zoneName: zone.name };
  return { x, y, inBounds, zoneId: "open_ground", zoneName: "Open ground" };
}
