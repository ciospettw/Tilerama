import * as turf from "@turf/turf";
import booleanIntersects from "@turf/boolean-intersects";
import { Polygon, MultiPolygon, Feature, FeatureCollection } from "geojson";
import { log } from "./utils";
import { settings } from "./settings";

/**
 * Convert bounding box coordinates to a Polygon.
 * Expected order: [north, south, east, west].
 */
export function bbox_to_poly(bbox: [number, number, number, number]): any {
  const [north, south, east, west] = bbox;
  // Turf expects [minX, minY, maxX, maxY] -> [west, south, east, north]
  return turf.bboxPolygon([west, south, east, north]);
}

/**
 * Compute a lat/lon bbox around a point by buffering a given distance (meters).
 * Returns [north, south, east, west] to stay consistent with existing code.
 */
export function bbox_from_point(
  point: [number, number],
  dist: number = 1000
): [number, number, number, number] {
  const [lat, lon] = point;

  const northPt = turf.destination([lon, lat], dist, 0, { units: "meters" });
  const southPt = turf.destination([lon, lat], dist, 180, { units: "meters" });
  const eastPt = turf.destination([lon, lat], dist, 90, { units: "meters" });
  const westPt = turf.destination([lon, lat], dist, 270, { units: "meters" });

  const north = northPt.geometry.coordinates[1];
  const south = southPt.geometry.coordinates[1];
  const east = eastPt.geometry.coordinates[0];
  const west = westPt.geometry.coordinates[0];

  return [north, south, east, west];
}

/** Buffer a GeoJSON geometry by `dist` meters. */
export function buffer_geometry(geom: any, dist: number): any {
  return turf.buffer(geom, dist, { units: "meters" });
}

/** Sample n nodes from a graph and return GeoJSON points. */
export function sample_points(G: any, n: number): any {
  // Sample points along edges, weighted by edge lengths.
  // Here we approximate the same semantics using the graph's edge GeoJSON.
  const geo = (G && typeof G.forEachEdge === "function") ? null : null;
  const { graph_to_geojson } = require("./convert");

  const { edges } = graph_to_geojson(G);
  const edgeFeatures = Array.isArray(edges?.features) ? edges.features : [];
  if (edgeFeatures.length === 0) return turf.featureCollection([]);

  const lengths: number[] = edgeFeatures.map((f: any) => {
    const len = f?.properties?.length;
    return typeof len === "number" && isFinite(len) ? len : 0;
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return turf.featureCollection([]);

  // Build cumulative distribution
  const cdf: number[] = [];
  let acc = 0;
  for (const w of lengths) {
    acc += w / total;
    cdf.push(acc);
  }

  const feats: any[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    let idx = cdf.findIndex((x) => r <= x);
    if (idx < 0) idx = cdf.length - 1;

    const f = edgeFeatures[idx];
    const geom = f?.geometry;
    const props = f?.properties || {};
    const length = typeof props.length === "number" ? props.length : 0;
    if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) continue;

    // Sample uniform position along the edge (normalized) and interpolate.
    const t = Math.random();
    const pt = pointAlongLineString(geom.coordinates, t);
    feats.push(turf.point(pt, { u: props.u ?? props.source, v: props.v ?? props.target, key: props.key ?? 0, length }));
  }
  return turf.featureCollection(feats);
}

/** Interpolate points every `dist` meters along a LineString geometry. */
export function interpolate_points(line: any, dist: number): any {
  // dist is in the same units as the LineString's coordinates
  // (typically meters for projected CRS). Points are evenly spaced by normalized
  // distance along the geometry.
  if (!line || line.type !== "LineString") throw new Error("interpolate_points expects a LineString geometry");
  if (!Array.isArray(line.coordinates) || line.coordinates.length < 2) {
    return turf.featureCollection([]);
  }

  const totalLen = euclideanLineLength(line.coordinates);
  const numVert = Math.max(Math.round(totalLen / dist), 1);
  const pts: any[] = [];
  for (let i = 0; i <= numVert; i++) {
    const t = i / numVert;
    const xy = pointAlongLineString(line.coordinates, t);
    pts.push(turf.point(xy));
  }
  return turf.featureCollection(pts);
}

function euclideanLineLength(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    total += Math.hypot(dx, dy);
  }
  return total;
}

function pointAlongLineString(coords: number[][], t: number): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return [coords[0][0], coords[0][1]];
  const clamped = Math.max(0, Math.min(1, t));
  const total = euclideanLineLength(coords);
  if (total === 0) return [coords[0][0], coords[0][1]];

  const target = clamped * total;
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const x0 = coords[i - 1][0];
    const y0 = coords[i - 1][1];
    const x1 = coords[i][0];
    const y1 = coords[i][1];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (acc + seg >= target) {
      const local = seg === 0 ? 0 : (target - acc) / seg;
      return [x0 + (x1 - x0) * local, y0 + (y1 - y0) * local];
    }
    acc += seg;
  }
  return [coords[coords.length - 1][0], coords[coords.length - 1][1]];
}

/**
 * Consolidate and subdivide a (projected) Polygon or MultiPolygon.
 * 
 * Consolidates geometry into convex hull, then subdivides into smaller
 * sub-polygons if area exceeds max_query_area_size setting.
 * 
 * @param geom - Polygon or MultiPolygon (should be projected in meters)
 * @returns MultiPolygon with consolidated and subdivided geometry
 */
export function _consolidate_subdivide_geometry(
  geom: Feature<Polygon> | Feature<MultiPolygon> | Polygon | MultiPolygon
): Feature<MultiPolygon> {
  // Normalize to Feature if raw geometry
  let feature: Feature<Polygon | MultiPolygon>;
  if ("type" in geom && geom.type === "Feature") {
    feature = geom as Feature<Polygon | MultiPolygon>;
  } else {
    feature = turf.feature(geom as Polygon | MultiPolygon);
  }
  
  const mqas = settings.max_query_area_size;
  let workingGeom = feature.geometry;
  
  // Calculate area
  const area = turf.area(turf.feature(workingGeom));
  
  // If MultiPolygon or Polygon area > max size, get convex hull
  if (workingGeom.type === "MultiPolygon" || area > mqas) {
    const convexHull = turf.convex(turf.feature(workingGeom));
    if (convexHull) {
      workingGeom = convexHull.geometry as Polygon;
    }
  }
  
  // Warn if area much larger than max size
  const ratio = Math.floor(area / mqas);
  const warningThreshold = 10;
  if (ratio > warningThreshold) {
    log(
      `This area is ${ratio.toLocaleString()}x your configured max query area size. ` +
      `It will be divided into multiple sub-queries. This may take time.`,
      "WARNING"
    );
  }
  
  // If area exceeds max size, subdivide
  const finalArea = turf.area(turf.feature(workingGeom));
  if (finalArea > mqas) {
    const quadratWidth = Math.sqrt(mqas);
    workingGeom = _quadrat_cut_geometry(turf.feature(workingGeom), quadratWidth).geometry;
  }
  
  // Ensure result is MultiPolygon
  if (workingGeom.type === "Polygon") {
    return turf.feature({
      type: "MultiPolygon",
      coordinates: [workingGeom.coordinates]
    } as MultiPolygon);
  }
  
  return turf.feature(workingGeom as MultiPolygon);
}

/**
 * Split a Polygon or MultiPolygon into sub-polygons using a quadrat grid.
 * 
 * @param geom - Polygon or MultiPolygon to split
 * @param quadratWidth - Width of quadrat squares (in geometry's units)
 * @returns MultiPolygon of subdivided geometries
 */
export function _quadrat_cut_geometry(
  geom: Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon,
  quadratWidth: number
): Feature<MultiPolygon> {
  // Normalize to Feature
  let feature: Feature<Polygon | MultiPolygon>;
  if ("type" in geom && geom.type === "Feature") {
    feature = geom as Feature<Polygon | MultiPolygon>;
  } else {
    feature = turf.feature(geom as Polygon | MultiPolygon);
  }
  
  const minNum = 3; // Minimum number of dividing lines
  
  // Get bounds
  const bbox = turf.bbox(feature);
  const [west, south, east, north] = bbox;
  const width = east - west;
  const height = north - south;
  
  // Calculate number of points
  const xNum = Math.ceil(width / quadratWidth) + 1;
  const yNum = Math.ceil(height / quadratWidth) + 1;
  
  // Create evenly spaced points
  const xPoints: number[] = [];
  const yPoints: number[] = [];
  
  const actualXNum = Math.max(xNum, minNum);
  const actualYNum = Math.max(yNum, minNum);
  
  for (let i = 0; i < actualXNum; i++) {
    xPoints.push(west + (width * i) / (actualXNum - 1));
  }
  
  for (let i = 0; i < actualYNum; i++) {
    yPoints.push(south + (height * i) / (actualYNum - 1));
  }
  
  // Create grid lines
  const lines: Feature<turf.helpers.LineString>[] = [];
  
  // Vertical lines
  for (const x of xPoints) {
    lines.push(turf.lineString([[x, yPoints[0]], [x, yPoints[yPoints.length - 1]]]));
  }
  
  // Horizontal lines
  for (const y of yPoints) {
    lines.push(turf.lineString([[xPoints[0], y], [xPoints[xPoints.length - 1], y]]));
  }
  
  // Recursively split geometry by each line
  let geoms: Feature<Polygon>[] = [];
  // Alternative simpler approach: use turf-square-grid
  // This is more reliable than manual splitting
  const envelope = turf.envelope(feature);
  const grid = turf.squareGrid(turf.bbox(envelope), quadratWidth, { units: "meters" });
  
  const intersectedPolygons: Feature<Polygon>[] = [];
  for (const cell of grid.features) {
    try {
      // @ts-ignore - turf.intersect accepts two polygon arguments
      const intersection = turf.intersect(feature, cell);
      if (intersection && intersection.geometry.type === "Polygon") {
        intersectedPolygons.push(intersection as Feature<Polygon>);
      } else if (intersection && intersection.geometry.type === "MultiPolygon") {
        // Split MultiPolygon into individual Polygons
        for (const coords of intersection.geometry.coordinates) {
          intersectedPolygons.push(turf.feature({ type: "Polygon", coordinates: coords } as Polygon));
        }
      }
    } catch {
      // Skip cells that don't intersect
    }
  }
  
  // If we got intersected polygons, use those
  const finalGeoms = intersectedPolygons.length > 0 ? intersectedPolygons : [turf.feature(feature.geometry)];
  
  // Convert to MultiPolygon
  const coordinates = finalGeoms.map(g => g.geometry.coordinates);
  
  return turf.feature({
    type: "MultiPolygon",
    coordinates
  } as MultiPolygon);
}

/**
 * Identify geometries that intersect a (Multi)Polygon using spatial indexing.
 * 
 * Uses quadrat acceleration and intersection testing to efficiently find
 * geometries within a polygon. Ensure geometries and polygon are in the
 * same coordinate reference system.
 * 
 * @param geoms - FeatureCollection of geometries to test
 * @param polygon - Polygon or MultiPolygon to intersect with
 * @returns Set of indices of geometries that intersect the polygon
 */
export function _intersect_index_quadrats(
  geoms: FeatureCollection,
  polygon: Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon
): Set<number> {
  // Normalize polygon to Feature
  let polyFeature: Feature<Polygon | MultiPolygon>;
  if ("type" in polygon && polygon.type === "Feature") {
    polyFeature = polygon as Feature<Polygon | MultiPolygon>;
  } else {
    polyFeature = turf.feature(polygon as Polygon | MultiPolygon);
  }
  
  log(`Testing intersection for ${geoms.features.length.toLocaleString()} geometries`, "INFO");
  
  // Calculate sensible quadrat width
  // 0.1 degrees ≈ 8 km at mid-latitudes
  const area = turf.area(polyFeature);
  const quadratWidth = Math.max(0.1, Math.sqrt(area) / 10);
  
  // Cut polygon into quadrats for acceleration
  const multipoly = _quadrat_cut_geometry(polyFeature, quadratWidth);
  const numQuadrats = multipoly.geometry.coordinates.length;
  
  log(`Accelerating with ${numQuadrats} quadrats`, "INFO");
  
  // Find intersecting geometries
  const geomsInPoly = new Set<number>();
  
  for (const polyCoords of multipoly.geometry.coordinates) {
    const poly = turf.feature({ type: "Polygon", coordinates: polyCoords } as Polygon);
    
    // Get bounding box for quick rejection
    const bbox = turf.bbox(poly);
    
    // Test each geometry
    geoms.features.forEach((geom, idx) => {
      try {
        // Quick bbox test first
        const geomBbox = turf.bbox(geom);
        const bboxOverlaps = !(
          geomBbox[2] < bbox[0] || // geom east < poly west
          geomBbox[0] > bbox[2] || // geom west > poly east
          geomBbox[3] < bbox[1] || // geom north < poly south
          geomBbox[1] > bbox[3]    // geom south > poly north
        );
        
        if (bboxOverlaps) {
          // Precise intersection test
          // Use different test depending on geometry type
          let intersects = false;
          
          if (geom.geometry.type === "Point") {
            intersects = turf.booleanPointInPolygon(geom.geometry.coordinates, poly);
          } else {
            intersects = booleanIntersects(geom, poly);
          }
          
          if (intersects) {
            geomsInPoly.add(idx);
          }
        }
      } catch {
        // Skip geometries that cause errors
      }
    });
  }
  
  log(`Identified ${geomsInPoly.size.toLocaleString()} geometries inside polygon`, "INFO");
  
  return geomsInPoly;
}
