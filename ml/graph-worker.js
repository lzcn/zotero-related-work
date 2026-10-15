import { SWSearch } from "../src/search.js";
import { swGraphNeighborhood } from "../src/graph-similarity.js";
// The shared scorer uses the same field-normalized cosine as sidebar results.
globalThis.SWSearch = SWSearch;
let generation = 0;
self.onmessage = async ({ data }) => {
  const token = ++generation;
  try {
    const graph = await swGraphNeighborhood(
      data.documents,
      data.method,
      data.centerId,
      () => token === generation,
      (progress) => self.postMessage({ progress }),
      () => new Promise((resolve) => self.setTimeout(resolve, 0)),
    );
    if (graph && token === generation) self.postMessage({ graph });
  } catch (error) {
    self.postMessage({ error: String(error.message || error) });
  }
};
