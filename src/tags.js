function swTagWords(name, preserveHyphens = false) {
  return String(name)
    .normalize("NFKC")
    .trim()
    .replace(/^#+\s*/u, "")
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Nd})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/([\p{Lu}])([\p{Lu}][\p{Ll}])/gu, "$1 $2")
    .split(preserveHyphens ? /[\s_]+/u : /[\s_\p{Pd}−]+/u)
    .filter(Boolean);
}

function swTagKey(name) {
  return swTagWords(name).join(" ").toLowerCase();
}

var SWTags = {
  _stopped: false,
  _dialogs: new Set(),
  _writes: new Set(),

  recommend(target, rows, limit = 6, excluded = new Set()) {
    const existing = new Set(
      (target.getTags?.() || []).map((tag) => swTagKey(tag.tag)),
    );
    const candidates = new Map();
    const seenItems = new Set();
    for (const row of rows) {
      if (
        row.item.libraryID !== target.libraryID ||
        row.item.id === target.id ||
        row.item.deleted ||
        !Number.isFinite(row.score) ||
        row.score <= 0
      )
        continue;
      if (seenItems.has(row.item.id)) continue;
      seenItems.add(row.item.id);
      const seen = new Set();
      for (const { tag } of row.item.getTags?.() || []) {
        const key = swTagKey(tag);
        if (!key || seen.has(key) || existing.has(key) || excluded.has(key))
          continue;
        seen.add(key);
        const candidate = candidates.get(key) || {
          name: tag,
          score: 0,
          count: 0,
        };
        candidate.score += row.score;
        candidate.count++;
        candidates.set(key, candidate);
      }
    }
    return [...candidates.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.count - a.count ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit);
  },

  normalizeName(name) {
    return String(name).normalize("NFKC").replace(/\s+/gu, " ").trim();
  },

  // Split naming boundaries without stemming or guessing unbroken words.
  words: swTagWords,

  formatName(name, options = this.namingOptions()) {
    const words = this.words(
      name,
      options.style === "space" && options.preserveHyphens,
    );
    if (!words.length) return "";
    const lower = (word) => (/[+#.]/u.test(word) ? word : word.toLowerCase());
    const styles = {
      space: () =>
        words
          .map((word) => {
            if (options.spaceCase === "keep" || !options.spaceCase) return word;
            if (/[+#.]/u.test(word) || /^[\p{Lu}\p{Nd}]+$/u.test(word))
              return word;
            const text = word.toLowerCase();
            return options.spaceCase === "title"
              ? text[0].toUpperCase() + text.slice(1)
              : text;
          })
          .join(" "),
      kebab: () => words.map(lower).join("-"),
      snake: () => words.map(lower).join("_"),
      camel: () =>
        words
          .map((word, i) => {
            if (!i) return lower(word);
            if (/[+#.]/u.test(word) || /^[\p{Lu}\p{Nd}]+$/u.test(word))
              return word;
            const text = word.toLowerCase();
            return text[0].toUpperCase() + text.slice(1);
          })
          .join(""),
    };
    const text = (styles[options.style] || styles.space)();
    return (options.hashtag ? "#" : "") + text;
  },

  namingOptions() {
    return {
      style:
        typeof SWPref === "undefined"
          ? "space"
          : SWPref("tagNameStyle", "space"),
      hashtag:
        typeof SWPref === "undefined" ? false : SWPref("tagHashtag", false),
      spaceCase:
        typeof SWPref === "undefined"
          ? "lower"
          : SWPref("tagSpaceCase", "lower"),
      preserveHyphens:
        typeof SWPref === "undefined"
          ? true
          : SWPref("tagPreserveHyphens", true),
    };
  },

  protectedKeys(libraryID) {
    const excluded =
      typeof SWPref === "undefined" ? "" : SWPref("excludedTags", "");
    const keys = new Set(
      String(excluded).split(/\r?\n/u).map(swTagKey).filter(Boolean),
    );
    if (typeof SWPref === "undefined" || SWPref("excludeColoredTags", true))
      for (const name of Zotero.Tags.getColors(libraryID).keys())
        keys.add(swTagKey(name));
    return keys;
  },

  _assertAllowed(libraryID, names) {
    const protectedKeys = this.protectedKeys(libraryID);
    if (names.some((name) => protectedKeys.has(swTagKey(name))))
      throw new Error("similar-works-tags-protected");
  },

  phrases(item) {
    const found = new Map();
    for (const [field, weight] of [
      ["title", 3],
      ["abstractNote", 1],
    ]) {
      const text = String(item.getField?.(field) || "")
        .replace(/<[^>]*>/g, " ")
        .slice(0, 12000);
      const runs =
        text.match(
          /[\p{L}][\p{L}\p{N}+.#-]*(?: +[\p{L}][\p{L}\p{N}+.#-]*)*/gu,
        ) || [];
      for (const run of runs) {
        const words = run
          .split(/ +/)
          .map((word) => word.replace(/[.,]+$/u, ""));
        for (let i = 0; i < words.length; i++) {
          const standalone =
            /^[A-Z][A-Z0-9]{1,9}$/.test(words[i]) ||
            /^[\p{Script=Han}]{2,10}$/u.test(words[i]);
          for (
            let n = standalone ? 1 : 2;
            n <= 3 && i + n <= words.length;
            n++
          ) {
            const part = words.slice(i, i + n);
            if (
              part.some((word) => SWTokenizer.isStopword(word.toLowerCase())) ||
              part.some((word) =>
                /^(paper|study|results?|method|approach|proposed|using|based|novel)$/i.test(
                  word,
                ),
              )
            )
              continue;
            const name = part.join(" "),
              key = swTagKey(name);
            if (name.length > 64 || name.length < (n === 1 ? 2 : 5)) continue;
            const old = found.get(key) || { name, weight: 0, occurrences: 0 };
            old.weight += weight;
            old.occurrences++;
            found.set(key, old);
          }
        }
      }
    }
    // Repeated phrases are safer topics than arbitrary fragments from one sentence.
    const repeated = [...found.values()].filter((p) => p.occurrences >= 2);
    return repeated
      .filter(
        (p) =>
          !repeated.some(
            (other) =>
              other.name.length > p.name.length &&
              (" " + swTagKey(other.name) + " ").includes(
                " " + swTagKey(p.name) + " ",
              ),
          ),
      )
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12)
      .map((p) => p.name);
  },

  rank(target, rows, names, excluded = new Set()) {
    const current = new Set(
      (target.getTags?.() || []).map((t) => swTagKey(t.tag)),
    );
    const votes = new Map(
      this.recommend(target, rows, Infinity, excluded).map((t) => [
        swTagKey(t.name),
        t,
      ]),
    );
    const catalog = new Map();
    for (const name of names)
      if (!catalog.has(swTagKey(name))) catalog.set(swTagKey(name), name);
    const terms = SWTokenizer.termFreq(
      String(target.getField?.("title") || "") +
        " " +
        String(target.getField?.("abstractNote") || ""),
    );
    const candidates = new Map(catalog);
    for (const name of this.phrases(target))
      if (!candidates.has(swTagKey(name))) candidates.set(swTagKey(name), name);
    // Fixtures and still-loading catalogs may only have neighbor tags available.
    for (const [key, vote] of votes)
      if (!candidates.has(key)) candidates.set(key, vote.name);
    const maximum = Math.max(1, ...[...votes.values()].map((v) => v.score));
    const seenNeighbors = new Set();
    const neighbors = rows
      .filter((row) => {
        if (
          row.item.libraryID !== target.libraryID ||
          row.item.id === target.id ||
          row.item.deleted ||
          !Number.isFinite(row.score) ||
          row.score <= 0 ||
          seenNeighbors.has(row.item.id)
        )
          return false;
        seenNeighbors.add(row.item.id);
        return true;
      })
      .map((row) => ({
        score: row.score,
        terms: new Set(
          SWTokenizer.tokenize(
            String(row.item.getField?.("title") || "") +
              " " +
              String(row.item.getField?.("abstractNote") || ""),
          ),
        ),
      }));
    const neighborWeight = Math.max(
      1,
      neighbors.reduce((sum, row) => sum + row.score, 0),
    );
    const out = [];
    for (const [key, name] of candidates) {
      if (!key || current.has(key) || excluded.has(key)) continue;
      const tagTerms = [...SWTokenizer.termFreq(name).keys()];
      const direct = tagTerms.length
        ? tagTerms.filter((t) => terms.has(t)).length / tagTerms.length
        : 0;
      const vote = votes.get(key);
      const support = tagTerms.length
        ? neighbors.filter((row) =>
            tagTerms.every((term) => row.terms.has(term)),
          )
        : [];
      const contextualScore =
        support.reduce((sum, row) => sum + row.score, 0) / neighborWeight;
      const neighborScore = Math.max(
        (vote?.score || 0) / maximum,
        contextualScore,
      );
      if (!direct && !neighborScore) continue;
      out.push({
        name,
        isNew: !catalog.has(key) && !vote,
        count: Math.max(vote?.count || 0, support.length),
        directScore: direct,
        neighborScore,
        score: 0.55 * direct + 0.45 * neighborScore,
      });
    }
    return out.sort(
      (a, b) =>
        b.score - a.score || b.count - a.count || a.name.localeCompare(b.name),
    );
  },

  async suggest(target, rows, active = () => true) {
    const names = await this.catalog(target.libraryID);
    if (this._stopped || !active()) return [];
    const protectedKeys = this.protectedKeys(target.libraryID);
    let candidates = this.rank(target, rows, names, protectedKeys).filter(
      (tag) => !protectedKeys.has(swTagKey(tag.name)),
    );
    if (
      typeof SWSemantic !== "undefined" &&
      typeof SWSemantic.tagSimilarity === "function" &&
      typeof SWPref !== "undefined" &&
      SWPref("recommendationMethod", "text") === "semantic"
    ) {
      let scores;
      try {
        scores = await SWSemantic.tagSimilarity(
          target,
          candidates.slice(0, 12).map((t) => t.name),
          active,
        );
      } catch (error) {
        if (!this._stopped && active()) Zotero.logError(error);
      }
      if (scores) {
        candidates = candidates.slice(0, 12);
        candidates.forEach((tag, i) => {
          tag.directScore = Math.max(0, scores[i]);
          tag.score = 0.55 * tag.directScore + 0.45 * tag.neighborScore;
        });
      }
    }
    if (this._stopped || !active()) return [];
    candidates.sort((a, b) => b.score - a.score || b.count - a.count);
    // Keep both kinds visible when a paper has well-supported new topic phrases.
    const existingKeys = new Set(
      [...names, ...(target.getTags?.() || []).map((tag) => tag.tag)].map(
        (name) => this.words(name).join(" ").toLowerCase(),
      ),
    );
    const newKeys = new Set();
    const currentProtected = this.protectedKeys(target.libraryID);
    candidates = candidates
      .map((tag) =>
        tag.isNew ? { ...tag, name: this.formatName(tag.name) } : tag,
      )
      .filter((tag) => {
        if (currentProtected.has(swTagKey(tag.name))) return false;
        if (!tag.isNew) return true;
        const key = this.words(tag.name).join(" ").toLowerCase();
        if (!key || existingKeys.has(key) || newKeys.has(key)) return false;
        newKeys.add(key);
        return true;
      });
    return [
      ...candidates.filter((t) => !t.isNew).slice(0, 4),
      ...candidates.filter((t) => t.isNew && t.directScore >= 0.35).slice(0, 2),
    ].sort((a, b) => b.score - a.score);
  },

  duplicateGroups(names) {
    const groups = new Map();
    for (const name of new Set(names)) {
      const key = swTagKey(name);
      if (!key) continue;
      const group = groups.get(key) || [];
      group.push(name);
      groups.set(key, group);
    }
    return [...groups.values()].filter((group) => group.length > 1);
  },

  _check(libraryID, active = () => true) {
    if (this._stopped || !active())
      throw new Error("similar-works-tags-cancelled");
    const library = Zotero.Libraries.get(libraryID);
    if (!library || !library.editable)
      throw new Error("similar-works-tags-readonly");
  },

  async _write(work) {
    const pending = work();
    this._writes.add(pending);
    try {
      return await pending;
    } finally {
      this._writes.delete(pending);
    }
  },

  async addSelected(itemID, libraryID, names, active = () => true) {
    const choices = names.map((value) =>
      typeof value === "string" ? { name: value, isNew: false } : value,
    );
    names = choices.map((choice) => choice.name);
    const existingChoice = (name) =>
      choices.some((choice) => choice.name === name && !choice.isNew);
    if (
      names.some(
        (name) =>
          typeof name !== "string" ||
          !name ||
          (!existingChoice(name) && name !== this.normalizeName(name)) ||
          name.length > 255 ||
          [...name].some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
          ),
      )
    )
      throw new Error("similar-works-tags-invalid-name");
    this._check(libraryID, active);
    this._assertAllowed(libraryID, names);
    const item = await Zotero.Items.getAsync(itemID);
    this._check(libraryID, active);
    if (
      !item ||
      item.deleted ||
      item.libraryID !== libraryID ||
      !item.isEditable()
    )
      throw new Error("similar-works-tags-readonly");
    const existing = new Set(
      (await Zotero.Tags.getAll(libraryID)).map((tag) => tag.tag),
    );
    this._check(libraryID, active);
    if (choices.some((choice) => !existing.has(choice.name) && !choice.isNew))
      throw new Error("similar-works-tags-changed");
    let added = 0;
    try {
      await this._write(() =>
        Zotero.DB.executeTransaction(async () => {
          this._check(libraryID, active);
          this._assertAllowed(libraryID, names);
          if (item.deleted || !item.isEditable())
            throw new Error("similar-works-tags-readonly");
          for (const name of new Set(names))
            if (!item.hasTag(name) && item.addTag(name, 0)) added++;
          if (added) await item.save();
          this._check(libraryID, active);
          this._assertAllowed(libraryID, names);
        }),
      );
    } catch (error) {
      await item.reload(null, true);
      throw error;
    }
    return added;
  },

  async catalog(libraryID, managed = false) {
    const tags = await Zotero.Tags.getAll(libraryID);
    const protectedKeys = managed ? this.protectedKeys(libraryID) : new Set();
    return [...new Set(tags.map((tag) => tag.tag))]
      .filter((name) => !protectedKeys.has(swTagKey(name)))
      .sort((a, b) => a.localeCompare(b));
  },

  async preview(libraryID, names, active = () => true) {
    this._check(libraryID, active);
    this._assertAllowed(libraryID, names);
    const existing = new Set(await this.catalog(libraryID));
    if (new Set(names).size < 1 || names.some((name) => !existing.has(name)))
      throw new Error("similar-works-tags-changed");
    const items = new Set();
    for (const name of new Set(names)) {
      this._check(libraryID, active);
      const tagID = Zotero.Tags.getID(name);
      if (!tagID) throw new Error("similar-works-tags-changed");
      for (const id of await Zotero.Tags.getTagItems(libraryID, tagID))
        items.add(id);
    }
    this._check(libraryID, active);
    return items.size;
  },

  async merge(libraryID, names, target, active = () => true) {
    if (
      !target ||
      target !== this.normalizeName(target) ||
      target.length > 255 ||
      [...target].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw new Error("similar-works-tags-invalid-name");
    this._assertAllowed(libraryID, [...names, target]);
    await this.preview(libraryID, names, active);
    let merged = 0;
    for (const name of new Set(names)) {
      if (name === target) continue;
      await this._rename(libraryID, name, target, active);
      merged++;
    }
    return merged;
  },

  async remove(
    libraryID,
    names,
    active = () => true,
    progress = (_done, _total) => {},
  ) {
    const sources = [...new Set(names)];
    await this.preview(libraryID, sources, active);
    let done = 0;
    for (let offset = 0; offset < sources.length; offset += 50) {
      const chunk = sources.slice(offset, offset + 50);
      this._check(libraryID, active);
      this._assertAllowed(libraryID, chunk);
      const ids = chunk.map((name) => {
        const id = Zotero.Tags.getID(name);
        if (!id) throw new Error("similar-works-tags-changed");
        return id;
      });
      // Native removal updates item caches and sends the host notifications.
      await this._write(() =>
        Zotero.Tags.removeFromLibrary(libraryID, ids, undefined, undefined),
      );
      done += chunk.length;
      progress(done, sources.length);
    }
    return done;
  },

  async _rename(libraryID, name, target, active) {
    this._check(libraryID, active);
    this._assertAllowed(libraryID, [name, target]);
    // The host returns color/position; zotero-types declares a tag object.
    const color = /** @type {{color: string, position: number} | false} */ (
      /** @type {unknown} */ (
        Zotero.Tags.getColor(libraryID, target) ||
          Zotero.Tags.getColor(libraryID, name)
      )
    );
    // Finish the current native write before releasing resources on close.
    await this._write(async () => {
      try {
        await Zotero.Tags.rename(libraryID, name, target);
      } finally {
        if (color)
          await Zotero.DB.executeTransaction(() =>
            Zotero.Tags.setColor(
              libraryID,
              target,
              color.color,
              color.position,
            ),
          );
      }
    });
  },

  async planFormat(libraryID, names, active = () => true) {
    this._check(libraryID, active);
    const sources = [...new Set(names)];
    this._assertAllowed(libraryID, sources);
    const existing = new Set(await this.catalog(libraryID));
    if (!sources.length || sources.some((name) => !existing.has(name)))
      throw new Error("similar-works-tags-changed");
    const options = this.namingOptions();
    const changes = sources
      .map((from) => ({ from, to: this.formatName(from, options) }))
      .filter((change) => change.from !== change.to);
    this._assertAllowed(
      libraryID,
      changes.map((change) => change.to),
    );
    if (changes.some((change) => !change.to || change.to.length > 255))
      throw new Error("similar-works-tags-invalid-name");
    const destinations = new Set();
    const items = new Set();
    const counted = new Set();
    let collisions = 0;
    for (const [i, change] of changes.entries()) {
      this._check(libraryID, active);
      if (existing.has(change.to) || destinations.has(change.to)) collisions++;
      destinations.add(change.to);
      for (const name of [
        change.from,
        ...(existing.has(change.to) ? [change.to] : []),
      ]) {
        if (counted.has(name)) continue;
        counted.add(name);
        const id = Zotero.Tags.getID(name);
        if (!id) throw new Error("similar-works-tags-changed");
        for (const itemID of await Zotero.Tags.getTagItems(libraryID, id))
          items.add(itemID);
      }
      if (i % 50 === 49) await Zotero.Promise.delay(0);
    }
    this._check(libraryID, active);
    this._assertAllowed(libraryID, [...sources, ...destinations]);
    return { sources, options, changes, itemCount: items.size, collisions };
  },

  async applyFormat(
    libraryID,
    plan,
    active = () => true,
    progress = (_done, _total) => {},
  ) {
    const current = await this.planFormat(libraryID, plan.sources, active);
    if (
      JSON.stringify(current.changes) !== JSON.stringify(plan.changes) ||
      JSON.stringify(current.options) !== JSON.stringify(plan.options) ||
      current.collisions !== plan.collisions
    )
      throw new Error("similar-works-tags-changed");
    // Formatting produces fixed-point destinations, so later sources cannot
    // be overwritten by an earlier rename. Native rename handles collisions.
    let done = 0;
    for (const change of current.changes) {
      await this._rename(libraryID, change.from, change.to, active);
      done++;
      progress(done, current.changes.length);
      if (done % 25 === 0) await Zotero.Promise.delay(0);
    }
    return done;
  },

  open(win, libraryID) {
    this._check(libraryID);
    const existing = [...this._dialogs].find(
      (dialog) => !dialog.closed && dialog.arguments[0].libraryID === libraryID,
    );
    if (existing) {
      existing.focus();
      return existing;
    }
    const url = "chrome://similar-works/content/tags.xhtml";
    const dialog = win.openDialog(
      url,
      "",
      "chrome,centerscreen,resizable,width=700,height=560",
      { api: this, libraryID },
    );
    this._dialogs.add(dialog);
    // Ignore the initial about:blank unload during native window navigation.
    const loaded = () => {
      if (
        dialog.document.documentURI !== url ||
        dialog.document.readyState !== "complete"
      )
        return;
      dialog.removeEventListener("load", loaded);
      dialog.addEventListener("unload", () => this._dialogs.delete(dialog), {
        once: true,
      });
    };
    dialog.addEventListener("load", loaded);
    loaded();
    return dialog;
  },

  stop() {
    this._stopped = true;
    for (const dialog of this._dialogs) if (!dialog.closed) dialog.close();
    this._dialogs.clear();
  },

  async finishWrites() {
    await Promise.allSettled([...this._writes]);
  },
};

if (typeof module !== "undefined") module.exports = { SWTags, swTagKey };
