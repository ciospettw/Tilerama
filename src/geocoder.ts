import { _download_nominatim_element } from "./nominatim";
import { log } from "./utils";
import * as turf from "@turf/turf";

/**
 * Geocode place names or addresses to (lat, lon) with the Nominatim API.
 */
export async function geocode(query: string): Promise<[number, number]> {
  const params = {
    format: "json",
    limit: 1,
    dedupe: 0,
    q: query,
  };

  // We can reuse _download_nominatim_element logic or call request directly.
  // _download_nominatim_element wraps the request logic nicely.
  const response_json = await _download_nominatim_element(query, false, 1, false);

  if (response_json && response_json.length > 0 && response_json[0].lat && response_json[0].lon) {
    const lat = parseFloat(response_json[0].lat);
    const lon = parseFloat(response_json[0].lon);
    const point: [number, number] = [lat, lon];
    log(`Geocoded '${query}' to ${point}`, "INFO");
    return point;
  }

  throw new Error(`Nominatim could not geocode query '${query}'.`);
}

/**
 * Retrieve OSM elements by place name or OSM ID with the Nominatim API.
 * Returns a GeoJSON FeatureCollection (simulating GeoDataFrame).
 */
export async function geocode_to_gdf(
  query: string | Record<string, string> | (string | Record<string, string>)[],
  which_result: number | number[] | null = null,
  by_osmid: boolean = false
): Promise<any> {
  let q_list: (string | Record<string, string>)[];
  let wr_list: (number | null)[];

  if (Array.isArray(query)) {
    q_list = query;
    wr_list = Array.isArray(which_result) ? which_result : Array(query.length).fill(which_result);
  } else {
    q_list = [query];
    wr_list = Array.isArray(which_result) ? [which_result[0]] : [which_result];
  }

  const features = [];

  for (let i = 0; i < q_list.length; i++) {
    const q = q_list[i];
    const wr = wr_list[i];
    const feature = await _geocode_query_to_gdf(q, wr, by_osmid);
    features.push(feature);
  }

  return turf.featureCollection(features);
}

async function _geocode_query_to_gdf(
  query: string | Record<string, string>,
  which_result: number | null,
  by_osmid: boolean
): Promise<any> {
  const limit = which_result === null ? 50 : which_result;
  let results = await _download_nominatim_element(query, by_osmid, limit, true);

  // Sort by importance
  results.sort((a, b) => b.importance - a.importance);

  if (results.length === 0) {
    throw new Error(`Nominatim geocoder returned 0 results for query '${JSON.stringify(query)}'.`);
  }

  let result;
  if (by_osmid) {
    result = results[0];
  } else if (which_result === null) {
    result = _get_first_polygon(results);
  } else if (results.length >= which_result) {
    result = results[which_result - 1];
  } else {
    throw new Error(`Nominatim returned ${results.length} results but which_result=${which_result}.`);
  }

  // Build GeoJSON feature
  const [bottom, top, left, right] = result.boundingbox.map(parseFloat);
  const feature = {
    type: "Feature",
    geometry: result.geojson,
    properties: {
      bbox_west: left,
      bbox_south: bottom,
      bbox_east: right,
      bbox_north: top,
      ...result
    }
  };
  
  // Clean up properties
  delete feature.properties.geojson;
  delete feature.properties.boundingbox;

  return feature;
}

function _get_first_polygon(results: any[]): any {
  const polygon_types = new Set(["Polygon", "MultiPolygon"]);
  for (const result of results) {
    if (result.geojson && polygon_types.has(result.geojson.type)) {
      return result;
    }
  }
  throw new Error("Nominatim did not geocode query to a geometry of type (Multi)Polygon.");
}
