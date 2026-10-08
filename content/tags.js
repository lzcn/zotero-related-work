/* global window, document */
(async () => {
  const { api, libraryID, isMac } = window.arguments[0];
  const accel = (event) =>
    (isMac ? event.metaKey : event.ctrlKey) &&
    !event.altKey &&
    !event.isComposing &&
    event.keyCode !== 229;
  let searchTimer = null;
  const search = document.getElementById("search");
  const duplicates = document.getElementById("duplicates");
  const list = document.getElementById("tags");
  const target = document.getElementById("target");
  const preview = document.getElementById("preview");
  const apply = document.getElementById("merge");
  const refresh = document.getElementById("refresh");
  const selectAll = document.getElementById("select-all");
  const mode = document.getElementById("mode");
  const selected = new Set();
  let names = [],
    counts = new Map(),
    visible = [],
    groups = new Set(),
    revision = 0,
    renderRevision = 0,
    loadRevision = 0,
    busy = false,
    closed = false,
    previewReady = false,
    plan = null,
    anchor = null;
  const fmt = (id, args) => document.l10n.formatValue(id, args);
  const active = () => !closed;
  const errorText = (error) =>
    fmt(
      String(error.message).startsWith("similar-works-")
        ? error.message
        : "similar-works-tags-error",
      { message: String(error.message || error) },
    );
  const report = async (error) => {
    if (active()) preview.textContent = await errorText(error);
  };
  window.addEventListener(
    "unload",
    () => {
      closed = true;
      window.clearTimeout(searchTimer);
      revision++;
      renderRevision++;
    },
    { once: true },
  );
  document
    .getElementById("close")
    .addEventListener("click", () => window.close());

  function updateSelection() {
    const available = visible;
    const checked = available.filter((name) => selected.has(name)).length;
    selectAll.disabled = busy || !available.length;
    selectAll.checked = !!available.length && checked === available.length;
    selectAll.indeterminate = checked > 0 && checked < available.length;
    for (const input of list.querySelectorAll("input"))
      input.checked = selected.has(input.value);
  }

  async function selectionChanged() {
    const token = ++revision;
    plan = null;
    previewReady = false;
    apply.disabled = true;
    updateSelection();
    const count = await fmt("similar-works-tags-selection-count", {
      selected: selected.size,
      total: names.length,
    });
    if (!active() || token !== revision) return;
    document.getElementById("selection-count").textContent = count;
    const merging = mode.value === "merge",
      deleting = mode.value === "delete",
      singleRename = mode.value === "format" && selected.size === 1;
    document.l10n.setAttributes(
      apply,
      deleting
        ? "similar-works-tags-delete-button"
        : merging
          ? "similar-works-tags-merge-button"
          : "similar-works-tags-rename-button",
    );
    apply.dataset.action = mode.value;
    target.hidden = document.getElementById("target-label").hidden = !(
      merging || singleRename
    );
    target.disabled = busy || !selected.size;
    const options = document.getElementById("selected-names");
    options.replaceChildren();
    for (const name of selected) {
      const option = document.createElement("option");
      option.value = option.textContent = name;
      options.appendChild(option);
    }
    target.value = api.formatName([...selected][0] || "");
    if (!selected.size) {
      preview.textContent = "";
      return;
    }
    preview.textContent = await fmt("similar-works-tags-preparing");
    try {
      const valid = () => active() && token === revision;
      let text;
      if (merging || deleting || singleRename) {
        const affected = await api.preview(libraryID, [...selected], valid);
        text = await fmt(
          deleting
            ? "similar-works-tags-delete-preview"
            : singleRename
              ? "similar-works-tags-rename-preview"
              : "similar-works-tags-preview",
          {
            tags: selected.size,
            count: affected,
          },
        );
      } else {
        const result = await api.planFormat(libraryID, [...selected], valid);
        text = await fmt("similar-works-tags-format-preview", {
          count: result.changes.length,
          items: result.itemCount,
          merges: result.collisions,
        });
        if (valid()) plan = result;
      }
      if (!valid()) return;
      preview.textContent = text;
      previewReady = true;
      apply.disabled =
        busy ||
        (deleting
          ? false
          : merging || singleRename
            ? !target.value.trim() ||
              (singleRename && target.value === [...selected][0])
            : !plan?.changes.length);
    } catch (error) {
      if (active() && token === revision) await report(error);
    }
  }

  async function render() {
    const token = ++renderRevision;
    const query = search.value.normalize("NFKC").toLowerCase().trim();
    const words = api.words(query).join(" ").toLowerCase();
    visible = names.filter(
      (name) =>
        (!duplicates.checked || groups.has(name)) &&
        (name.toLowerCase().includes(query) ||
          (!!words && api.words(name).join(" ").toLowerCase().includes(words))),
    );
    anchor = null;
    list.replaceChildren();
    // Every tag is reachable; yield between batches instead of truncating the list.
    for (let offset = 0; offset < visible.length; offset += 100) {
      if (!active() || token !== renderRevision) return;
      const fragment = document.createDocumentFragment();
      for (const name of visible.slice(offset, offset + 100)) {
        const label = document.createElement("label");
        label.className = "tag";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = name;
        input.checked = selected.has(name);
        input.disabled = busy;
        const text = document.createElement("span");
        text.textContent = name;
        const count = document.createElement("small");
        count.className = "tag-count";
        count.textContent =
          " (" + (counts.get(name) || 0).toLocaleString() + ")";
        text.appendChild(count);
        const hint = document.createElement("small");
        const normalized = mode.value === "format" ? api.formatName(name) : "";
        if (normalized && normalized !== name)
          hint.textContent = "→ " + normalized;
        input.addEventListener("click", (event) => {
          if (event.shiftKey && anchor !== null) {
            const first = visible.indexOf(anchor),
              last = visible.indexOf(name);
            for (const value of visible.slice(
              Math.min(first, last),
              Math.max(first, last) + 1,
            )) {
              if (input.checked) selected.add(value);
              else selected.delete(value);
            }
          }
          anchor = name;
        });
        input.addEventListener("change", () => {
          if (input.checked) selected.add(name);
          else selected.delete(name);
          void selectionChanged();
        });
        label.append(input, text, hint);
        fragment.appendChild(label);
      }
      if (!active() || token !== renderRevision) return;
      list.appendChild(fragment);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.textContent = await fmt("similar-works-tags-no-matches");
      if (active() && token === renderRevision) list.appendChild(empty);
    }
    updateSelection();
  }

  async function load() {
    const token = ++loadRevision;
    const [catalog, usage] = await Promise.all([
      api.catalog(libraryID, true),
      api.usageCounts(libraryID),
    ]);
    if (!active() || token !== loadRevision) return;
    names = catalog;
    counts = usage;
    for (const name of selected)
      if (!names.includes(name)) selected.delete(name);
    groups = new Set(api.duplicateGroups(names).flat());
    await render();
    await selectionChanged();
  }
  function chooseVisible(checked) {
    for (const name of visible) {
      if (checked) selected.add(name);
      else selected.delete(name);
    }
    void selectionChanged();
  }
  selectAll.addEventListener("change", () => chooseVisible(selectAll.checked));
  list.addEventListener("keydown", (event) => {
    if (accel(event) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      chooseVisible(true);
    }
  });
  target.addEventListener("input", () => {
    apply.disabled =
      busy ||
      !previewReady ||
      !selected.size ||
      !target.value.trim() ||
      (mode.value === "format" && target.value === [...selected][0]);
  });
  refresh.addEventListener("click", () => {
    if (!busy) void load().catch(report);
  });
  const searchChanged = (event) => {
    window.clearTimeout(searchTimer);
    renderRevision++;
    if (event.isComposing) return;
    searchTimer = window.setTimeout(() => {
      if (active()) void render().catch(report);
    }, 120);
  };
  search.addEventListener("input", searchChanged);
  search.addEventListener("compositionend", searchChanged);
  search.addEventListener("compositionstart", () => {
    window.clearTimeout(searchTimer);
    renderRevision++;
  });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
      return;
    if (accel(event) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      search.focus();
      search.select();
    } else if (accel(event) && event.key.toLowerCase() === "w") {
      event.preventDefault();
      window.close();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (search.value) {
        search.value = "";
        searchChanged(event);
      } else window.close();
    }
  });
  duplicates.addEventListener("change", () => {
    void render().catch(report);
  });
  mode.addEventListener("change", () => {
    void selectionChanged();
    void render().catch(report);
  });
  apply.addEventListener("click", async () => {
    if (busy || apply.disabled) return;
    const currentPlan = plan,
      merging = mode.value === "merge",
      deleting = mode.value === "delete",
      singleRename = mode.value === "format" && selected.size === 1,
      keep = api.normalizeName(target.value);
    busy = true;
    revision++;
    apply.disabled =
      target.disabled =
      refresh.disabled =
      search.disabled =
      duplicates.disabled =
      mode.disabled =
      selectAll.disabled =
        true;
    await render();
    let resultText;
    try {
      const progress = (done, total) => {
        if (active()) {
          preview.textContent = done + " / " + total;
          preview.setAttribute("aria-busy", "true");
        }
      };
      const count = deleting
        ? await api.remove(libraryID, [...selected], active, progress)
        : merging || singleRename
          ? await api.merge(libraryID, [...selected], keep, active)
          : await api.applyFormat(libraryID, currentPlan, active, progress);
      selected.clear();
      resultText = await fmt(
        deleting
          ? "similar-works-tags-deleted"
          : merging
            ? "similar-works-tags-merged"
            : singleRename
              ? "similar-works-tags-renamed"
              : "similar-works-tags-formatted",
        { count, name: keep },
      );
    } catch (error) {
      resultText = await errorText(error);
    } finally {
      busy = false;
      if (active()) {
        preview.removeAttribute("aria-busy");
        refresh.disabled =
          search.disabled =
          duplicates.disabled =
          mode.disabled =
            false;
        try {
          await load();
        } catch (error) {
          resultText = await errorText(error);
        }
        if (active()) preview.textContent = resultText;
      }
    }
  });
  try {
    await load();
  } catch (error) {
    await report(error);
  }
})();
