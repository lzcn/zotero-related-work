/* global window, document, ResizeObserver */
(() => {
  const { api, libraryID, isMac } = window.arguments[0];
  const $ = (id) => document.getElementById(id);
  const canvas = $("graph"),
    ctx = canvas.getContext("2d");
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  let graph = { nodes: [], edges: [] },
    nodes = [],
    edges = [],
    byID = new Map(),
    adjacency = new Map();
  let center = window.arguments[0].centerId,
    selected = center,
    hovered,
    query = "";
  let transform = { x: 0, y: 0, k: 1 },
    width = 0,
    height = 0,
    frame = 0;
  let version = 0,
    closed = false,
    busy = false,
    invalidated = false;
  let similarityWorker,
    layoutWorker,
    unsubscribe,
    refreshTimer,
    drag,
    splitDrag;
  const titleLength = 20;
  let viewMoved = false;
  const positions = new Map();
  const active = (token) => !closed && token === version;
  const status = (id, args) =>
    document.l10n.setAttributes($("status"), id, args);
  const error = (err) => {
    if (closed) return;
    const message = String(err.message || err);
    if (message.startsWith("similar-works-")) status(message);
    else status("similar-works-graph-error", { message });
  };
  const run = (fn) => {
    try {
      Promise.resolve(fn()).catch(error);
    } catch (err) {
      error(err);
    }
  };
  function workersStop() {
    similarityWorker?.terminate();
    layoutWorker?.terminate();
    similarityWorker = layoutWorker = null;
  }
  function setBusy(value) {
    busy = value;
    $("refresh").disabled = value;
    $("cancel").hidden = $("progress").hidden = !value;
    if (value) $("progress").removeAttribute("value");
  }
  function cancel() {
    version++;
    window.clearTimeout(refreshTimer);
    workersStop();
    setBusy(false);
    status("similar-works-graph-cancelled");
  }
  async function refresh() {
    const token = ++version;
    workersStop();
    invalidated = false;
    setBusy(true);
    status("similar-works-graph-loading");
    try {
      const snapshot = await api.snapshot(libraryID, center, () =>
        active(token),
      );
      if (!snapshot || !active(token)) return;
      const worker = (similarityWorker = new window.Worker(
        "chrome://similar-works/content/graph-worker.js",
      ));
      worker.onerror = (event) => {
        event.preventDefault();
        if (active(token)) {
          workersStop();
          setBusy(false);
          error(event.message);
        }
      };
      worker.onmessage = async ({ data }) => {
        if (!active(token)) return;
        if (data.progress) {
          $("progress").max = Math.max(1, data.progress.total);
          $("progress").value = data.progress.done;
          return;
        }
        worker.terminate();
        similarityWorker = null;
        try {
          if (data.error) throw new Error(data.error);
          const nextNodes = await api.describe(libraryID, data.graph.ids, () =>
            active(token),
          );
          if (!nextNodes || !active(token)) return;
          if (!nextNodes.some((node) => node.id === center))
            throw new Error("similar-works-graph-unavailable");
          const visibleIDs = new Set(nextNodes.map((node) => node.id));
          graph = {
            nodes: nextNodes,
            edges: data.graph.edges.filter(
              (edge) =>
                visibleIDs.has(edge.source) && visibleIDs.has(edge.target),
            ),
          };
          setBusy(false);
          $("status").textContent = "";
          $("status").removeAttribute("data-l10n-id");
          if (invalidated) status("similar-works-graph-changed");
          else if (!data.graph.hasIndex) status("similar-works-graph-no-index");
          renderScope();
        } catch (err) {
          if (active(token)) {
            setBusy(false);
            error(err);
          }
        }
      };
      worker.postMessage({
        documents: snapshot.documents,
        method: snapshot.method,
        centerId: snapshot.centerId,
      });
      // The Worker owns its cloned fingerprints; keep only display metadata here.
      snapshot.documents = undefined;
    } catch (err) {
      if (active(token)) {
        workersStop();
        setBusy(false);
        error(err);
      }
    }
  }
  function remember() {
    for (const node of nodes) positions.set(node.id, { x: node.x, y: node.y });
  }
  function renderScope() {
    remember();
    viewMoved = false;
    layoutWorker?.terminate();
    layoutWorker = null;
    edges = graph.edges;
    nodes = graph.nodes.map((node, i) => ({
      ...node,
      ...positions.get(node.id),
      radius: 6,
      x:
        positions.get(node.id)?.x ?? Math.cos(i * 2.399963) * 18 * Math.sqrt(i),
      y:
        positions.get(node.id)?.y ?? Math.sin(i * 2.399963) * 18 * Math.sqrt(i),
    }));
    byID = new Map(nodes.map((node) => [node.id, node]));
    adjacency = new Map(nodes.map((node) => [node.id, []]));
    for (const edge of edges) {
      adjacency.get(edge.source).push({ id: edge.target, score: edge.score });
      adjacency.get(edge.target).push({ id: edge.source, score: edge.score });
    }
    for (const node of nodes)
      node.radius = Math.min(
        16,
        6 + 2 * Math.sqrt(adjacency.get(node.id).length),
      );
    const liveIDs = new Set(graph.nodes.map((node) => node.id));
    for (const key of [...positions.keys()])
      if (!liveIDs.has(key)) positions.delete(key);
    hovered = null;
    $("empty").hidden = !!nodes.length;
    canvas.dataset.nodes = String(nodes.length);
    canvas.dataset.edges = String(edges.length);
    document.l10n.setAttributes($("stats"), "similar-works-graph-stats", {
      nodes: nodes.length,
      edges: edges.length,
    });
    inspector();
    yearLegend();
    if (!nodes.length) {
      paint();
      return;
    }
    const fitOnFinish =
      !positions.size ||
      !canvas.dataset.scope ||
      canvas.dataset.scope !== center;
    canvas.dataset.scope = center;
    if (fitOnFinish) fit();
    const worker = (layoutWorker = new window.Worker(
      "chrome://similar-works/content/graph-layout-worker.js",
    ));
    worker.onerror = (event) => {
      event.preventDefault();
      if (worker !== layoutWorker) return;
      worker.terminate();
      layoutWorker = null;
      error(event.message);
    };
    worker.onmessage = ({ data }) => {
      if (closed || worker !== layoutWorker) return;
      if (!reducedMotion || data.done) {
        nodes.forEach((node, i) => {
          node.x = data.positions[i * 3];
          node.y = data.positions[i * 3 + 1];
          node.radius = data.positions[i * 3 + 2];
        });
        paint();
      }
      if (data.done) {
        remember();
        if (fitOnFinish && !viewMoved) fit();
        worker.terminate();
        layoutWorker = null;
        canvas.dataset.settled = "true";
      }
    };
    canvas.dataset.settled = "false";
    worker.postMessage({
      nodes: nodes.map(({ id, x, y }) => ({ id, x, y })),
      edges,
    });
    paint();
  }
  function yearLegend() {
    const dated = nodes
      .filter((node) => node.year)
      .sort((a, b) => a.year - b.year);
    $("year-legend").hidden = !dated.length;
    if (!dated.length) return;
    const oldest = dated[0],
      newest = dated[dated.length - 1];
    $("year-old").textContent = oldest.year;
    $("year-new").textContent = newest.year === oldest.year ? "" : newest.year;
    $("year-scale").style.background =
      `linear-gradient(to right, ${oldest.color}, ${newest.color})`;
  }
  function select(id) {
    selected = id;
    inspector();
    paint();
  }
  function inspector() {
    const node = byID.get(selected);
    $("selection").hidden = !node;
    $("hint").hidden = !!node;
    if (!node) return;
    $("node-title").textContent = node.title;
    $("node-meta").textContent = node.meta;
    $("node-tags").textContent = node.tags.join(" · ");
    $("node-abstract").textContent = node.abstract;
    const rows = (adjacency.get(node.id) || [])
      .slice()
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((peer) => {
        const button = document.createElement("button");
        const title = document.createElement("span"),
          score = document.createElement("span");
        title.textContent = byID.get(peer.id).title;
        score.textContent = (peer.score * 100).toFixed(1) + "%";
        button.append(title, score);
        button.addEventListener("click", () => select(peer.id));
        return button;
      });
    $("connections").replaceChildren(...rows);
  }
  function fit() {
    if (!nodes.length || !width || !height) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x - 20);
      maxX = Math.max(maxX, node.x + 20);
      minY = Math.min(minY, node.y - 20);
      maxY = Math.max(maxY, node.y + 20);
    }
    const k = Math.max(
      0.02,
      Math.min(
        2,
        (width - 80) / (maxX - minX || 1),
        (height - 80) / (maxY - minY || 1),
      ),
    );
    transform = {
      x: width / 2 - ((minX + maxX) / 2) * k,
      y: height / 2 - ((minY + maxY) / 2) * k,
      k,
    };
    paint();
  }
  function paint() {
    if (!frame && !closed) frame = window.requestAnimationFrame(draw);
  }
  function screen(node) {
    return {
      x: node.x * transform.k + transform.x,
      y: node.y * transform.k + transform.y,
      radius: Math.max(3, node.radius * transform.k),
    };
  }
  function draw() {
    frame = 0;
    if (closed) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const focus = hovered || selected;
    const neighbors = new Set(
      (adjacency.get(focus) || []).map((peer) => peer.id),
    );
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    for (const edge of edges) {
      const a = screen(byID.get(edge.source)),
        b = screen(byID.get(edge.target));
      if (
        Math.max(a.x, b.x) < 0 ||
        Math.min(a.x, b.x) > width ||
        Math.max(a.y, b.y) < 0 ||
        Math.min(a.y, b.y) > height
      )
        continue;
      const connected = edge.source === focus || edge.target === focus;
      ctx.strokeStyle = connected
        ? `rgba(52,120,246,${0.45 + 0.5 * edge.score})`
        : `rgba(${dark ? "180,190,205" : "110,125,145"},${0.1 + 0.35 * edge.score})`;
      ctx.lineWidth = (connected ? 1.2 : 0.4) + edge.score * 1.4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const labels = [];
    for (const node of nodes) {
      const p = screen(node);
      if (
        p.x + p.radius < 0 ||
        p.x - p.radius > width ||
        p.y + p.radius < 0 ||
        p.y - p.radius > height
      )
        continue;
      const matched =
        !!query &&
        `${node.title} ${node.meta} ${node.tags.join(" ")}`
          .toLowerCase()
          .includes(query);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      if (node.id === focus || neighbors.has(node.id) || matched) {
        ctx.lineWidth = node.id === focus ? 3 : 1.5;
        ctx.strokeStyle = matched ? "#f59e0b" : dark ? "#eee" : "#202c40";
        ctx.stroke();
      }
      labels.push({
        node,
        p,
        priority:
          node.id === focus ? 3 : matched ? 2 : neighbors.has(node.id) ? 1 : 0,
      });
    }
    labels.sort(
      (a, b) => b.priority - a.priority || b.node.radius - a.node.radius,
    );
    ctx.font = "12px system-ui";
    ctx.textBaseline = "middle";
    const occupied = new Set();
    for (const { node, p } of labels) {
      const chars = Array.from(node.title),
        label =
          chars.length > titleLength
            ? chars.slice(0, Math.max(1, titleLength - 1)).join("") + "…"
            : node.title;
      let x = p.x + p.radius + 5;
      const y = p.y;
      const length = ctx.measureText(label).width;
      if (x + length > width - 8) x = p.x - p.radius - 5 - length;
      if (x < 8 || x + length > width - 8) continue;
      const cells = [];
      for (let a = Math.floor(x / 24); a <= Math.floor((x + length) / 24); a++)
        for (
          let b = Math.floor((y - 7) / 16);
          b <= Math.floor((y + 7) / 16);
          b++
        )
          cells.push(`${a}/${b}`);
      if (cells.some((cell) => occupied.has(cell))) continue;
      for (const cell of cells) occupied.add(cell);
      ctx.fillStyle = dark ? "#ddd" : "#344054";
      ctx.fillText(label, x, y);
    }
  }
  function hit(x, y) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const p = screen(nodes[i]);
      if (Math.hypot(p.x - x, p.y - y) <= Math.max(8, p.radius + 3))
        return nodes[i];
    }
    return null;
  }
  function pointer(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const p = pointer(event);
    drag = {
      ...p,
      node: hit(p.x, p.y),
      moved: false,
      tx: transform.x,
      ty: transform.y,
      pointer: event.pointerId,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus();
  });
  canvas.addEventListener("pointermove", (event) => {
    const p = pointer(event);
    if (drag) {
      if (Math.hypot(p.x - drag.x, p.y - drag.y) > 3) drag.moved = true;
      if (!drag.moved) return;
      viewMoved = true;
      if (drag.node) {
        layoutWorker?.terminate();
        layoutWorker = null;
        drag.node.x = (p.x - transform.x) / transform.k;
        drag.node.y = (p.y - transform.y) / transform.k;
      } else {
        transform.x = drag.tx + p.x - drag.x;
        transform.y = drag.ty + p.y - drag.y;
      }
      paint();
    } else {
      const node = hit(p.x, p.y);
      if (hovered !== node?.id) {
        hovered = node?.id;
        canvas.title = node?.title || "";
        canvas.style.cursor = node ? "grab" : "default";
        paint();
      }
    }
  });
  const endDrag = (event) => {
    if (!drag) return;
    if (!drag.moved && event.type === "pointerup") select(drag.node?.id);
    remember();
    drag = null;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!drag) {
      hovered = null;
      canvas.title = "";
      paint();
    }
  });
  canvas.addEventListener("dblclick", (event) => {
    const p = pointer(event),
      node = hit(p.x, p.y);
    if (node) run(() => api.select(node.id));
  });
  function zoomAt(x, y, factor) {
    viewMoved = true;
    const next = Math.min(8, Math.max(0.02, transform.k * factor));
    transform.x = x - ((x - transform.x) * next) / transform.k;
    transform.y = y - ((y - transform.y) * next) / transform.k;
    transform.k = next;
    paint();
  }
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      if (event.ctrlKey || event.metaKey) {
        const p = pointer(event);
        zoomAt(p.x, p.y, Math.exp(-event.deltaY * scale * 0.01));
      } else {
        viewMoved = true;
        transform.x -= event.deltaX * scale;
        transform.y -= event.deltaY * scale;
        paint();
      }
    },
    { passive: false },
  );
  const splitter = $("splitter");
  const resizeInspector = (value) => {
    $("inspector").style.width =
      Math.max(200, Math.min(window.innerWidth / 2, value)) + "px";
  };
  splitter.addEventListener("pointerdown", (event) => {
    splitDrag = {
      x: event.clientX,
      width: $("inspector").getBoundingClientRect().width,
    };
    splitter.setPointerCapture(event.pointerId);
  });
  splitter.addEventListener("pointermove", (event) => {
    if (splitDrag)
      resizeInspector(splitDrag.width - event.clientX + splitDrag.x);
  });
  for (const name of ["pointerup", "pointercancel"])
    splitter.addEventListener(name, () => {
      splitDrag = null;
    });
  splitter.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      resizeInspector(
        $("inspector").getBoundingClientRect().width +
          (event.key === "ArrowLeft" ? 20 : -20),
      );
    }
  });
  $("fit").addEventListener("click", fit);
  $("refresh").addEventListener("click", () => run(refresh));
  $("cancel").addEventListener("click", cancel);
  $("open").addEventListener("click", () => {
    if (selected) run(() => api.select(selected));
  });
  const search = () => {
    query = $("search").value.trim().toLowerCase();
    paint();
  };
  $("search").addEventListener("input", (event) => {
    if (!event.isComposing) search();
  });
  $("search").addEventListener("compositionend", search);
  window.addEventListener("related-work-center", () => {
    const next = window.arguments[0].centerId;
    if (next === center) return;
    selected = center = next;
    positions.clear();
    run(refresh);
  });
  window.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const accel = isMac ? event.metaKey : event.ctrlKey;
    if (accel && event.key.toLowerCase() === "w") {
      event.preventDefault();
      window.close();
    } else if (accel && event.key.toLowerCase() === "f") {
      event.preventDefault();
      $("search").focus();
      $("search").select();
    } else if (event.key === "Escape") {
      if (busy) cancel();
      else {
        select(undefined);
        hovered = null;
        paint();
      }
    } else if (event.target === canvas) {
      if (event.key === "+" || event.key === "=")
        zoomAt(width / 2, height / 2, 1.25);
      else if (event.key === "-") zoomAt(width / 2, height / 2, 0.8);
      else if (event.key === "0") fit();
      else if (event.key === "Enter" && selected)
        run(() => api.select(selected));
      else return;
      event.preventDefault();
    }
  });
  const observer = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * (window.devicePixelRatio || 1));
    canvas.height = Math.round(height * (window.devicePixelRatio || 1));
    paint();
  });
  observer.observe($("viewport"));
  unsubscribe = api.subscribe((kind) => {
    if (closed) return;
    if (kind === "preferences") {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => run(refresh), 300);
    } else {
      invalidated = true;
      if (!busy) status("similar-works-graph-changed");
    }
  });
  window.addEventListener(
    "unload",
    () => {
      closed = true;
      version++;
      workersStop();
      unsubscribe?.();
      observer.disconnect();
      window.clearTimeout(refreshTimer);
      window.cancelAnimationFrame(frame);
    },
    { once: true },
  );
  run(async () => {
    await document.l10n.ready;
    if (!closed) await refresh();
  });
})();
