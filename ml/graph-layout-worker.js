// Adapted from Knowledge Base's force layout and bounded Worker batches.
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
} from "d3-force";
let generation = 0;
self.onmessage = ({ data }) => {
  const token = ++generation;
  const degree = new Map();
  for (const edge of data.edges)
    for (const id of [edge.source, edge.target])
      degree.set(id, (degree.get(id) || 0) + 1);
  const nodes = data.nodes.map((node) => ({
    ...node,
    radius: Math.min(16, 6 + 2 * Math.sqrt(degree.get(node.id) || 0)),
  }));
  const links = data.edges.map((edge) => ({ ...edge }));
  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink(links)
        .id((node) => node.id)
        .distance((edge) => 45 + 110 * (1 - edge.score))
        .strength((edge) => 0.1 + 0.5 * edge.score),
    )
    .force("charge", forceManyBody().strength(-240).distanceMax(900))
    .force("x", forceX(0).strength(0.025))
    .force("y", forceY(0).strength(0.025))
    .force(
      "collide",
      forceCollide()
        .radius((node) => node.radius + 12)
        .iterations(2),
    )
    .stop();
  let ticks = 0;
  const step = () => {
    if (token !== generation) return;
    const until = performance.now() + 8;
    let batch = 0;
    do {
      simulation.tick();
      ticks++;
      batch++;
    } while (batch < 4 && performance.now() < until);
    const done = ticks >= 180;
    const positions = new Float64Array(nodes.length * 3);
    nodes.forEach((node, i) =>
      positions.set([node.x, node.y, node.radius], i * 3),
    );
    self.postMessage({ positions, done }, [positions.buffer]);
    if (!done) self.setTimeout(step, 16);
  };
  step();
};
