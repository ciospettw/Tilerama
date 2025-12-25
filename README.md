# tilerama

Tilerama is a Node.js/TypeScript library for acquiring, constructing, analyzing, and visualizing complex street networks.

## Install

```sh
npm install tilerama
```

## Usage

```ts
import { graph_from_bbox, truncate_graph_bbox } from "tilerama";

const bbox: [number, number, number, number] = [
  37.80, // north
  37.78, // south
  -122.40, // east
  -122.43  // west
];

// Example: build a graph, then truncate it.
// (Exact options depend on how you're constructing the graph.)
// const G = await graph_from_bbox(bbox);
// const G2 = truncate_graph_bbox(G, bbox, true);
```

## Build (for contributors)

```sh
npm run build
```
