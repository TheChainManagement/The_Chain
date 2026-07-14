export function locationHref(path: string, locationId: string | null): string {
  return locationId ? `${path}?location=${encodeURIComponent(locationId)}` : path;
}
