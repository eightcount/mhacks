export interface LocationMatcher {
  canServe(input: {
    catererLocation: string;
    serviceAreas: string[];
    requestedLocation: string;
  }): boolean;
}

function normalizeLocation(location: string): string {
  return location.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * Phase 2 deliberately uses exact normalized location strings. `serviceRadius`
 * is persisted for a later distance-aware matcher, but is not interpreted here.
 */
export const exactLocationMatcher: LocationMatcher = {
  canServe({ catererLocation, serviceAreas, requestedLocation }): boolean {
    const requested = normalizeLocation(requestedLocation);
    return [catererLocation, ...serviceAreas].some(
      (servedLocation) => normalizeLocation(servedLocation) === requested
    );
  }
};
