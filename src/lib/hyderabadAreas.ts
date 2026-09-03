/**
 * Hyderabad V1 location catalogue.
 * City is fixed for launch; areas + neighbour map power Home filters.
 */

export const LAUNCH_CITY = "Hyderabad";

export const HYDERABAD_AREAS = [
  "Madhapur",
  "Hitech City",
  "Gachibowli",
  "Kondapur",
  "Jubilee Hills",
  "Banjara Hills",
  "Film Nagar",
  "Ameerpet",
] as const;

export type HyderabadArea = (typeof HYDERABAD_AREAS)[number];

/** Fixed neighbour map for filter mode B (exact + nearby). */
export const AREA_NEIGHBOURS: Record<HyderabadArea, readonly HyderabadArea[]> = {
  Madhapur: ["Hitech City", "Gachibowli", "Kondapur"],
  "Hitech City": ["Madhapur", "Gachibowli", "Kondapur"],
  Gachibowli: ["Madhapur", "Hitech City", "Kondapur"],
  Kondapur: ["Madhapur", "Hitech City", "Gachibowli"],
  "Jubilee Hills": ["Banjara Hills", "Film Nagar", "Ameerpet"],
  "Banjara Hills": ["Jubilee Hills", "Film Nagar", "Ameerpet"],
  "Film Nagar": ["Jubilee Hills", "Banjara Hills"],
  Ameerpet: ["Jubilee Hills", "Banjara Hills"],
};

/** Approximate centroids for “use my location” → nearest area. */
export const AREA_CENTROIDS: Record<
  HyderabadArea,
  { lat: number; lng: number }
> = {
  Madhapur: { lat: 17.4483, lng: 78.3915 },
  "Hitech City": { lat: 17.4435, lng: 78.3772 },
  Gachibowli: { lat: 17.4401, lng: 78.3489 },
  Kondapur: { lat: 17.4670, lng: 78.3670 },
  "Jubilee Hills": { lat: 17.4308, lng: 78.4070 },
  "Banjara Hills": { lat: 17.4140, lng: 78.4370 },
  "Film Nagar": { lat: 17.4135, lng: 78.4170 },
  Ameerpet: { lat: 17.4375, lng: 78.4482 },
};

export function isHyderabadArea(value: string): value is HyderabadArea {
  return (HYDERABAD_AREAS as readonly string[]).includes(value);
}

/** Areas to include for filter B: selected + neighbours. */
export function areasForFilter(selected: string | undefined): string[] | null {
  if (!selected || selected === "ALL") return null;
  if (!isHyderabadArea(selected)) return [selected];
  return [selected, ...AREA_NEIGHBOURS[selected]];
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function nearestHyderabadArea(lat: number, lng: number): HyderabadArea {
  let best: HyderabadArea = "Madhapur";
  let bestKm = Number.POSITIVE_INFINITY;
  for (const area of HYDERABAD_AREAS) {
    const km = haversineKm({ lat, lng }, AREA_CENTROIDS[area]);
    if (km < bestKm) {
      bestKm = km;
      best = area;
    }
  }
  return best;
}
