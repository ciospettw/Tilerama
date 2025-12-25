import { MultiDirectedGraph } from "graphology";
import { log } from "./utils";
import proj4 from "proj4";

// Define WGS84 (default for OSM)
const WGS84 = "EPSG:4326";

/** Heuristic check if CRS is projected (not EPSG:4326). */
export function is_projected(crs: any): boolean {
  if (!crs || typeof crs !== "string") return false;
  return crs.toUpperCase() !== "EPSG:4326";
}

/** Project a GeoJSON geometry from one CRS to another using proj4. */
export function project_geometry(geom: any, from_crs: string, to_crs: string): any {
  const transformCoord = (coord: number[]) => {
    const [x, y] = proj4(from_crs, to_crs, coord);
    return [x, y];
  };

  const recurse = (g: any): any => {
    if (!g) return g;
    const type = g.type;
    if (type === "Point") return { type, coordinates: transformCoord(g.coordinates) };
    if (type === "LineString" || type === "MultiPoint") return { type, coordinates: g.coordinates.map(transformCoord) };
    if (type === "Polygon" || type === "MultiLineString") return { type, coordinates: g.coordinates.map((ring: any) => ring.map(transformCoord)) };
    if (type === "MultiPolygon") return { type, coordinates: g.coordinates.map((poly: any) => poly.map((ring: any) => ring.map(transformCoord))) };
    return g;
  };

  return recurse(geom);
}

/** Project a FeatureCollection from one CRS to another. */
export function project_gdf(gdf: any, from_crs: string, to_crs: string): any {
  if (!gdf?.features) return gdf;
  const features = gdf.features.map((f: any) => ({
    ...f,
    geometry: project_geometry(f.geometry, from_crs, to_crs),
  }));
  return { ...gdf, features };
}

/**
 * Project a graph from its current CRS to another.
 * 
 * @param G - The graph to project.
 * @param to_crs - The CRS to project to. If null, projects to the local UTM zone.
 * @returns The projected graph.
 */
export function project_graph(
  G: MultiDirectedGraph,
  to_crs: string | null = null
): MultiDirectedGraph {
  let current_crs = G.getAttribute("crs");
  
  // Default to WGS84 if not set or if it looks like WGS84
  if (!current_crs || current_crs.toLowerCase() === "epsg:4326") {
      current_crs = WGS84;
  }

  // If to_crs is not provided, estimate UTM zone
  if (!to_crs) {
    // Calculate centroid to determine UTM zone
    let min_x = Infinity, max_x = -Infinity;
    let min_y = Infinity, max_y = -Infinity;
    let count = 0;

    G.forEachNode((node, attr) => {
      // Assuming x is longitude, y is latitude in WGS84
      if (attr.x !== undefined && attr.y !== undefined) {
        if (attr.x < min_x) min_x = attr.x;
        if (attr.x > max_x) max_x = attr.x;
        if (attr.y < min_y) min_y = attr.y;
        if (attr.y > max_y) max_y = attr.y;
        count++;
      }
    });

    if (count === 0) {
        log("Graph has no nodes with coordinates. Cannot project.", "WARNING");
        return G;
    }

    const center_x = (min_x + max_x) / 2;
    const center_y = (min_y + max_y) / 2;

    // Calculate UTM zone
    const zone = Math.floor((center_x + 180) / 6) + 1;
    const hemisphere = center_y >= 0 ? "north" : "south";
    const epsg_code = hemisphere === "north" ? 32600 + zone : 32700 + zone;
    
    to_crs = `EPSG:${epsg_code}`;
    
    // Define the UTM projection if not already defined in proj4
    if (!proj4.defs(to_crs)) {
        proj4.defs(to_crs, `+proj=utm +zone=${zone} +${hemisphere} +ellps=WGS84 +datum=WGS84 +units=m +no_defs`);
    }
    
    log(`Projecting graph to UTM zone ${zone} ${hemisphere} (${to_crs})`, "INFO");
  } else {
      log(`Projecting graph to ${to_crs}`, "INFO");
  }

  if (current_crs === to_crs) {
      log("Target CRS is same as current CRS. Skipping projection.", "INFO");
      return G;
  }

  // Reproject nodes
  G.forEachNode((node, attr) => {
      if (attr.x !== undefined && attr.y !== undefined) {
          // proj4(from, to, [x, y])
          const [new_x, new_y] = proj4(current_crs!, to_crs!, [attr.x, attr.y]);
          G.setNodeAttribute(node, "x", new_x);
          G.setNodeAttribute(node, "y", new_y);
      }
  });

  // Update graph CRS
  G.setAttribute("crs", to_crs);

  return G;
}
