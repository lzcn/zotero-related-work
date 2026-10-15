// Expand only the center and its nearest neighbors; graph limits are internal.
const GRAPH_HOPS = 2;
const GRAPH_CONNECTIONS = 10;
const GRAPH_MINIMUM_SIMILARITY = 0.25;
async function swGraphNeighborhood(
  documents,
  method,
  centerId,
  active = () => true,
  progress = (_progress) => {},
  pause = async () => {},
) {
  const byKey = new Map(documents.map((doc) => [doc.key, doc]));
  const ids = new Set([centerId]);
  if (!active()) return null;
  if (!byKey.has(centerId))
    return { ids: [...ids], edges: [], hasIndex: false, comparisons: 0 };
  let comparisons = 0,
    sliceStarted = Date.now();
  const total = documents.length * (GRAPH_CONNECTIONS + 1);
  const scorePair = (a, b) => {
    let score = 0;
    if (method === "semantic") {
      for (let d = 0; d < a.vector.length; d++)
        score += a.vector[d] * b.vector[d];
    } else score = SWSearch.Index.prototype.similarity(a, b);
    if (!Number.isFinite(score)) throw new Error("Invalid graph similarity");
    comparisons++;
    return Math.min(1, Math.max(0, score));
  };
  const offer = (list, key, score) => {
    if (score < GRAPH_MINIMUM_SIMILARITY) return;
    const last = list[list.length - 1];
    if (
      list.length === GRAPH_CONNECTIONS &&
      (score < last.score ||
        (score === last.score && key.localeCompare(last.key) >= 0))
    )
      return;
    list.push({ key, score });
    list.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    if (list.length > GRAPH_CONNECTIONS) list.pop();
  };
  const yieldIfNeeded = async () => {
    if (comparisons % 256 === 0 && Date.now() - sliceStarted >= 8) {
      progress({ done: comparisons, total: Math.max(total, comparisons) });
      await pause();
      sliceStarted = Date.now();
    }
  };
  let frontier = [centerId];
  const expanded = new Set();
  for (let hop = 0; hop < GRAPH_HOPS; hop++) {
    const next = [];
    for (const key of frontier) {
      if (expanded.has(key)) continue;
      expanded.add(key);
      const source = byKey.get(key),
        nearest = [];
      for (const candidate of documents) {
        if (!active()) return null;
        if (candidate.key === key) continue;
        offer(nearest, candidate.key, scorePair(source, candidate));
        await yieldIfNeeded();
      }
      for (const peer of nearest) {
        if (ids.has(peer.key)) continue;
        ids.add(peer.key);
        next.push(peer.key);
      }
    }
    frontier = next;
  }
  // Include connections between visible second-hop papers, without expanding them.
  const visible = [...ids].sort().map((id) => byKey.get(id));
  const lists = visible.map(() => []);
  for (let i = 0; i < visible.length; i++)
    for (let j = i + 1; j < visible.length; j++) {
      if (!active()) return null;
      const score = scorePair(visible[i], visible[j]);
      offer(lists[i], visible[j].key, score);
      offer(lists[j], visible[i].key, score);
      await yieldIfNeeded();
    }
  if (!active()) return null;
  const edges = new Map();
  lists.forEach((list, i) => {
    for (const peer of list) {
      const [source, target] = [visible[i].key, peer.key].sort();
      edges.set(JSON.stringify([source, target]), {
        source,
        target,
        score: peer.score,
      });
    }
  });
  progress({ done: comparisons, total: comparisons });
  return {
    ids: [...ids],
    edges: [...edges.values()].sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    ),
    hasIndex: true,
    comparisons,
  };
}
if (typeof module !== "undefined") module.exports = { swGraphNeighborhood };
