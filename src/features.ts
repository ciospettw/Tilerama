import { FeatureCollection } from "geojson";
import osmtogeojson from "osmtogeojson";
import { overpassRequest } from "./overpass";
import { log } from "./utils";
import * as geocoder from "./geocoder";
import { bbox_from_point, bbox_to_poly } from "./utils_geo";
import * as turf from "@turf/turf";
import booleanIntersects from "@turf/boolean-intersects";
import * as fs from "fs";
import { DOMParser } from "@xmldom/xmldom";

/**
 * Download OSM features within a lat-lon bounding box.
 * 
 * @param bbox - Bounding box [north, south, east, west].
 * @param tags - Dict of tags to search for.
 * @returns GeoJSON FeatureCollection.
 */
export async function features_from_bbox(
  bbox: [number, number, number, number],
  tags: Record<string, string | boolean | string[]>
): Promise<FeatureCollection> {
  const [north, south, east, west] = bbox;
  
  const query = build_overpass_features_query(tags, `${south},${west},${north},${east}`);

  log(`Downloading features with query: ${query}`, "INFO");

  const response = await overpassRequest(query);
  
  log(`Downloaded ${response.elements.length} elements. Converting to GeoJSON...`, "INFO");

  // Convert to GeoJSON
  const geojson = osmtogeojson(response);

  log(`Converted to ${geojson.features.length} features.`, "INFO");

  return geojson;
}

/**
 * Download OSM features within a radius of a point.
 */
export async function features_from_point(
    center_point: [number, number],
    tags: Record<string, string | boolean | string[]>,
    dist: number = 1000
): Promise<FeatureCollection> {
    const [lat, lon] = center_point;
    const bbox = bbox_from_point([lat, lon], dist);
    return features_from_bbox(bbox, tags);
}

/** Download OSM features within a polygon or multipolygon (GeoJSON). */
export async function features_from_polygon(
  polygon: any,
  tags: Record<string, string | boolean | string[]>
): Promise<FeatureCollection> {
  const geom = polygon && polygon.type === "Feature" ? polygon.geometry : polygon;
  if (!geom || !geom.coordinates) throw new Error("features_from_polygon expects a GeoJSON Polygon or MultiPolygon.");

  const polygons: any[] = [];
  if (geom.type === "Polygon") polygons.push(turf.polygon(geom.coordinates));
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach((c: any) => polygons.push(turf.polygon(c)));
  else throw new Error(`Unsupported geometry type ${geom.type}`);

  const features: any[] = [];
  for (const poly of polygons) {
    const coords = poly.geometry.coordinates[0];
    const coordStr = coords.map(([lon, lat]: number[]) => `${lat} ${lon}`).join(" ");
    const query = build_overpass_features_query(tags, `poly:\"${coordStr}\"`);
    log(`Downloading features (polygon) with query: ${query}`, "INFO");
    const response = await overpassRequest(query);
    const gj = osmtogeojson(response);
    features.push(...gj.features);
  }

  return { type: "FeatureCollection", features } as FeatureCollection;
}

/** Download OSM features for a place name (uses Nominatim polygon). */
export async function features_from_place(
  query: string | Record<string, string> | (string | Record<string, string>)[],
  tags: Record<string, string | boolean | string[]>,
  which_result: number | null = 1
): Promise<FeatureCollection> {
  const gdf = await geocoder.geocode_to_gdf(query, which_result, false);
  if (!gdf.features?.length) throw new Error("geocode_to_gdf returned no features");
  const geom = gdf.features[0].geometry;
  return features_from_polygon(geom, tags);
}

/** Download OSM features for an address using a buffered point. */
export async function features_from_address(
  query: string,
  tags: Record<string, string | boolean | string[]>,
  dist: number = 1000
): Promise<FeatureCollection> {
  const [lat, lon] = await geocoder.geocode(query);
  const bbox = bbox_from_point([lat, lon], dist);
  return features_from_bbox(bbox, tags);
}

/** 
 * Convert a local OSM XML file to GeoJSON FeatureCollection.
 * 
 * @param filepath - Path to OSM XML file
 * @param polygon - Optional polygon to filter features spatially
 * @param tags - Optional tags to filter features (e.g., {amenity: 'restaurant'})
 * @param encoding - File encoding (default: 'utf-8')
 * @returns GeoJSON FeatureCollection
 */
export function features_from_xml(
  filepath: string,
  polygon?: turf.helpers.Feature<turf.helpers.Polygon | turf.helpers.MultiPolygon> | turf.helpers.Polygon | turf.helpers.MultiPolygon,
  tags?: Record<string, string | boolean | string[]>,
  encoding: string = "utf-8"
): FeatureCollection {
  if (!fs.existsSync(filepath)) {
    throw new Error(`OSM XML file not found: ${filepath}`);
  }
  
  // Read and parse XML file
  const xml = fs.readFileSync(filepath, { encoding: encoding as BufferEncoding });
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  let gj = osmtogeojson(doc) as FeatureCollection;
  
  // Filter by tags if provided
  if (tags && Object.keys(tags).length > 0) {
    gj = {
      ...gj,
      features: gj.features.filter(feature => {
        if (!feature.properties) return false;
        
        // Check if feature matches ALL tags
        for (const [key, value] of Object.entries(tags)) {
          const propValue = feature.properties[key];
          
          if (value === true) {
            // Tag key must exist
            if (propValue === undefined || propValue === null) {
              return false;
            }
          } else if (Array.isArray(value)) {
            // Tag value must match one of the array values
            if (!value.includes(propValue)) {
              return false;
            }
          } else {
            // Tag must match exact value
            if (propValue !== value) {
              return false;
            }
          }
        }
        return true;
      })
    };
  }
  
  // Filter by polygon if provided
  if (polygon) {
    const polyFeature = polygon && 'type' in polygon && polygon.type === 'Feature' 
      ? polygon 
      : turf.feature(polygon as any);
    
    gj = {
      ...gj,
      features: gj.features.filter(feature => {
        if (!feature.geometry) return false;
        try {
          return booleanIntersects(feature, polyFeature);
        } catch {
          return false;
        }
      })
    };
  }
  
  // Remove metadata attributes
  const metadataKeys = ['changeset', 'timestamp', 'uid', 'user', 'version'];
  gj.features = gj.features.map(feature => ({
    ...feature,
    properties: feature.properties ? Object.fromEntries(
      Object.entries(feature.properties).filter(([key]) => !metadataKeys.includes(key))
    ) : {}
  }));
  
  return gj;
}

function build_overpass_features_query(tags: Record<string, string | boolean | string[]>, region: string): string {
  let query = `[out:json][timeout:180];\n(\n`;
  for (const [key, value] of Object.entries(tags)) {
    let tagStr = "";
    if (value === true) tagStr = `[\"${key}\"]`;
    else if (typeof value === "string") tagStr = `[\"${key}\"=\"${value}\"]`;
    else if (Array.isArray(value)) tagStr = `[\"${key}\"~\"${value.join("|")}\"]`;

    query += `  node${tagStr}(${region});\n`;
    query += `  way${tagStr}(${region});\n`;
    query += `  relation${tagStr}(${region});\n`;
  }
  query += `);\n(._;>;);\nout body;`;
  return query;
}
