import { describe, expect, it } from "vitest";
import { CAMPUS_ZONES, GRID, haversineMeters, projectToCampus } from "../../src/lib/geo.js";

describe("projectToCampus", () => {
  it("maps each zone centre to its own zone", () => {
    for (const z of CAMPUS_ZONES) {
      const p = projectToCampus(z.lat, z.lon);
      expect(p.inBounds).toBe(true);
      expect(p.zoneId).toBe(z.id);
    }
  });

  it("keeps coordinates on the 1000×750 grid", () => {
    for (const z of CAMPUS_ZONES) {
      const p = projectToCampus(z.lat, z.lon);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(GRID.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(GRID.height);
    }
  });

  it("flags and clamps off-campus fixes", () => {
    const p = projectToCampus(10.0, 77.0);
    expect(p.inBounds).toBe(false);
    expect(p.zoneId).toBe("out_of_bounds");
    expect(p.x).toBe(GRID.width);
    expect(p.y).toBe(0);
  });

  it("uses open_ground between zones", () => {
    expect(projectToCampus(9.7533, 76.6519).zoneId).toBe("open_ground");
  });
});

describe("haversineMeters", () => {
  it("is ~111 km per degree of latitude", () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeGreaterThan(111_000);
    expect(haversineMeters(0, 0, 1, 0)).toBeLessThan(111_400);
  });
});
