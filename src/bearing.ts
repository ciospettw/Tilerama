import { MultiDirectedGraph } from "graphology";
import { log } from "./utils";

/**
 * Calculate the compass bearing(s) between pairs of lat-lon points.
 * Expects coordinates in decimal degrees.
 */
export function calculate_bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const y1 = (lat1 * Math.PI) / 180;
  const y2 = (lat2 * Math.PI) / 180;
  const delta_lon = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(delta_lon) * Math.cos(y2);
  const x =
    Math.cos(y1) * Math.sin(y2) -
    Math.sin(y1) * Math.cos(y2) * Math.cos(delta_lon);
  
  const initial_bearing = (Math.atan2(y, x) * 180) / Math.PI;

  // normalize to 0-360
  return (initial_bearing + 360) % 360;
}

/**
 * Calculate and add compass `bearing` attributes to all graph edges.
 */
export function add_edge_bearings(G: MultiDirectedGraph): MultiDirectedGraph {
  if (G.getAttribute("crs") && String(G.getAttribute("crs")).includes("projected")) {
      // Warn if projected.
      // We'll just log a warning.
      log("Graph appears to be projected. Bearings might be inaccurate if not using lat/lon.", "WARNING");
  }

  G.forEachEdge((edge, attributes, source, target) => {
      // Ignore self-loops
      if (source === target) return;

      const uNode = G.getNodeAttributes(source);
      const vNode = G.getNodeAttributes(target);

      if (uNode.y !== undefined && uNode.x !== undefined && vNode.y !== undefined && vNode.x !== undefined) {
          const bearing = calculate_bearing(uNode.y, uNode.x, vNode.y, vNode.x);
          G.setEdgeAttribute(edge, "bearing", bearing);
      }
  });

  log("Added bearing attributes to graph edges", "INFO");
  return G;
}

/**
 * Compute entropy of street orientations (bearings). Compute entropy as follows:
 * double the bin count to avoid edge effects, roll counts, merge adjacent bins,
 * then compute Shannon entropy (natural log) of the merged histogram.
 */
export function orientation_entropy(bearings: number[], bins: number = 36): number | null {
  if (!bearings || bearings.length === 0) return null;

  const numSplitBins = bins * 2;
  const width = 360 / numSplitBins;
  const splitCounts = new Array<number>(numSplitBins).fill(0);

  // Normalize to [0, 360) and bucket into split bins
  bearings.forEach((b) => {
    const norm = ((b % 360) + 360) % 360;
    const idx = Math.min(numSplitBins - 1, Math.floor(norm / width));
    splitCounts[idx] += 1;
  });

  // Roll last bin to front, then merge adjacent split bins
  const rolled = [splitCounts[numSplitBins - 1], ...splitCounts.slice(0, numSplitBins - 1)];
  const binCounts = new Array<number>(bins).fill(0);
  for (let i = 0; i < bins; i++) {
    binCounts[i] = rolled[2 * i] + rolled[2 * i + 1];
  }

  const total = binCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  let entropy = 0;
  binCounts.forEach((c) => {
    if (c > 0) {
      const p = c / total;
      entropy -= p * Math.log(p);
    }
  });
  return entropy;
}
