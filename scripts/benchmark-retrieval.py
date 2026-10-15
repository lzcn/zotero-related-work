"""Local, offline paper retrieval benchmark. Private inputs stay under build/."""

import argparse
import hashlib
import json
import pathlib
import platform
import re
import time

import numpy as np


def readJson(path):
    return json.loads(path.read_text())


def writeJson(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def normalizeTitle(title):
    import unicodedata

    return re.sub(r"[^\w]", "", unicodedata.normalize("NFKC", title).casefold())


def cleanText(text):
    import html

    return html.unescape(re.sub(r"<[^>]*>", " ", text or "")).strip()


def encode(args):
    import torch
    from transformers import AutoConfig, AutoModel, AutoTokenizer

    torch.set_num_threads(6)
    torch.manual_seed(20261015)
    docs = readJson(args.root / "corpus.json")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    modelPath = args.root / "models" / {
        "minilm": "minilm", "specter": "specter-base", "gemma": "gemma"
    }[args.model]
    started = time.perf_counter()
    tokenizer = AutoTokenizer.from_pretrained(modelPath, local_files_only=True)
    if args.model == "specter":
        from adapters import AutoAdapterModel

        model = AutoAdapterModel.from_pretrained(modelPath, local_files_only=True)
        model.load_adapter(str(args.root / "models/specter-adapter"), set_active=True)
    else:
        config = AutoConfig.from_pretrained(modelPath, local_files_only=True)
        if args.model == "gemma":
            config.vision_config = None
            config.audio_config = None
        model = AutoModel.from_pretrained(
            modelPath, config=config, local_files_only=True, dtype=torch.float32
        )
    model.eval().to(device)
    loadSeconds = time.perf_counter() - started
    texts, owners, weights = [], [], []
    storedChunks = readJson(args.root / "chunks.json") if args.model == "minilm" else None
    for i, doc in enumerate(docs):
        title, abstract = cleanText(doc["title"]), cleanText(doc["abstract"])
        if args.model == "minilm":
            # Match SWSemantic.chunks: 120 words, first chunk weighted 3:1.
            chunks = storedChunks[doc["id"]]
        elif args.model == "specter":
            chunks = [title + tokenizer.sep_token + abstract]
        else:
            chunks = ["task: sentence similarity | query: " + title + ". " + abstract]
        for j, text in enumerate(chunks):
            texts.append(text)
            owners.append(i)
            weights.append(3 if j == 0 else 1)
    maxLength = {"minilm": 256, "specter": 512, "gemma": 512}[args.model]
    output = None
    encodingStarted = time.perf_counter()
    with torch.inference_mode():
        for offset in range(0, len(texts), args.batch):
            inputs = tokenizer(texts[offset:offset + args.batch], padding=True,
                               truncation=True, max_length=maxLength, return_tensors="pt").to(device)
            result = model(**inputs)
            hidden = result.last_hidden_state
            if args.model == "specter":
                pooled = hidden[:, 0, :]
            else:
                mask = inputs["attention_mask"].unsqueeze(-1).to(hidden.dtype)
                pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1)
            pooled = torch.nn.functional.normalize(pooled, dim=-1).cpu().numpy()
            if not np.isfinite(pooled).all():
                raise ValueError("Non-finite embeddings")
            if output is None:
                output = np.zeros((len(docs), pooled.shape[1]), dtype=np.float32)
            for j, vector in enumerate(pooled):
                at = offset + j
                output[owners[at]] += weights[at] * vector
            if offset % (args.batch * 32) == 0:
                print(f"{args.model}: {offset}/{len(texts)} texts, {time.perf_counter() - encodingStarted:.1f}s", flush=True)
    if device == "mps":
        torch.mps.synchronize()
    encodeSeconds = time.perf_counter() - encodingStarted
    output /= np.linalg.norm(output, axis=1, keepdims=True)
    np.save(args.root / (args.model + ".npy"), output)
    writeJson(args.root / (args.model + "-timing.json"), {
        "model": args.model, "papers": len(docs), "texts": len(texts),
        "dimensions": output.shape[1], "maxTokens": maxLength,
        "batch": args.batch, "dtype": "float32", "device": device,
        "engine": "PyTorch " + torch.__version__, "platform": platform.platform(),
        "loadSeconds": loadSeconds, "encodeSeconds": encodeSeconds,
        "note": "Offline title/abstract benchmark; no cached PDF fallback. Not deployed Core ML timings."
    })


def prepare(args):
    docs = readJson(args.root / "library.json")
    seenTitles, seenDois, corpus, duplicates = {}, {}, [], []
    for doc in docs:
        title = normalizeTitle(doc["title"])
        doi = doc["doi"].strip().lower()
        prior = seenTitles.get(title) or (seenDois.get(doi) if doi else None)
        if prior:
            duplicates.append({"excluded": doc["id"], "retained": prior})
            continue
        corpus.append(doc)
        seenTitles[title] = doc["id"]
        if doi:
            seenDois[doi] = doc["id"]
    writeJson(args.root / "corpus.json", corpus)
    writeJson(args.root / "duplicates.json", duplicates)
    print(f"{len(corpus)} papers; {len(duplicates)} duplicate records excluded")


def rank(args):
    docs = readJson(args.root / "corpus.json")
    queries = readJson(args.root / "queries.json")
    ids = [d["id"] for d in docs]
    byId = {key: i for i, key in enumerate(ids)}
    rankings = readJson(args.root / "lexical.json")["rankings"]
    exclusionsPath = args.root / "ranking-exclusions.json"
    excluded = set(readJson(exclusionsPath)) if exclusionsPath.exists() else set()
    for modelName in ["minilm", "specter", "gemma"]:
        vectors = np.load(args.root / (modelName + ".npy"))
        rankings[modelName] = {}
        for query in queries:
            key = query["id"]
            scores = vectors @ vectors[byId[key]]
            scores[byId[key]] = -np.inf
            ranked = [i for i in np.argsort(-scores, kind="stable") if ids[i] not in excluded][:100]
            rankings[modelName][key] = [{"key": ids[i], "score": float(scores[i])} for i in ranked]
    for source in rankings.values():
        for key in source:
            source[key] = [hit for hit in source[key] if hit["key"] not in excluded]
    # Pre-specified equal-weight reciprocal rank fusion, k=60, window=100.
    for modelName in ["minilm", "specter", "gemma"]:
        rankings[modelName + "-rrf"] = {}
        for query in queries:
            key, scores = query["id"], {}
            for source in ["lexical", modelName]:
                for i, hit in enumerate(rankings[source][key]):
                    scores[hit["key"]] = scores.get(hit["key"], 0) + 1 / (60 + i + 1)
            rankings[modelName + "-rrf"][key] = [
                {"key": key, "score": score} for key, score in
                sorted(scores.items(), key=lambda x: (-x[1], x[0]))[:100]
            ]
    writeJson(args.root / "rankings.json", rankings)
    # Anonymous, shuffled pooled candidates. Scores/model identities are omitted.
    import random

    rng = random.Random(20261015)
    lookup = {d["id"]: d for d in docs}
    packets = []
    for query in queries:
        key = query["id"]
        pool = set(hit["key"] for source in rankings.values() for hit in source[key][:10])
        pool.update(rng.sample([i for i in ids if i != key and i not in pool], 2))
        pool = sorted(pool)
        rng.shuffle(pool)
        packets.append({"query": lookup[key], "split": query["split"], "topic": query["topic"],
                        "candidates": [lookup[k] for k in pool]})
    writeJson(args.root / "annotation-packets.json", packets)
    print("Pooled pairs:", sum(len(p["candidates"]) for p in packets))


def lookup(args):
    import hnswlib

    docs = readJson(args.root / "corpus.json")
    queries = readJson(args.root / "queries.json")
    byId = {d["id"]: i for i, d in enumerate(docs)}
    queryIds = [byId[q["id"]] for q in queries]
    results = {}
    for modelName in ["minilm", "specter", "gemma"]:
        vectors = np.load(args.root / (modelName + ".npy"))
        exact = np.argsort(-(vectors[queryIds] @ vectors.T), axis=1, kind="stable")[:, :11]
        exactSets = [set(row) - {queryId} for row, queryId in zip(exact, queryIds)]
        times = []
        for roundIndex in range(11):
            for queryId in queryIds:
                started = time.perf_counter()
                scores = vectors @ vectors[queryId]
                np.argpartition(-scores, 11)[:11]
                if roundIndex:
                    times.append((time.perf_counter() - started) * 1000)
        results[modelName] = {"exact": {"p50Ms": float(np.percentile(times, 50)),
                                                "p95Ms": float(np.percentile(times, 95))}}
        index = hnswlib.Index(space="cosine", dim=vectors.shape[1])
        started = time.perf_counter()
        index.init_index(max_elements=len(docs), ef_construction=200, M=16, random_seed=20261015)
        index.add_items(vectors, num_threads=1)
        buildSeconds = time.perf_counter() - started
        index.set_num_threads(1)
        for ef in [20, 50, 100]:
            index.set_ef(ef)
            labels, _ = index.knn_query(vectors[queryIds], k=11)
            recall = np.mean([len((set(row) - {queryId}) & expected) / 10
                              for row, queryId, expected in zip(labels, queryIds, exactSets)])
            times = []
            for roundIndex in range(11):
                for queryId in queryIds:
                    started = time.perf_counter()
                    index.knn_query(vectors[queryId], k=11)
                    if roundIndex:
                        times.append((time.perf_counter() - started) * 1000)
            results[modelName]["hnsw-ef" + str(ef)] = {
                "p50Ms": float(np.percentile(times, 50)), "p95Ms": float(np.percentile(times, 95)),
                "recallVsExactAt10": float(recall), "buildSeconds": buildSeconds,
                "note": "Native Python microbenchmark; excludes Zotero IPC, filters and index maintenance."
            }
    writeJson(args.root / "lookup-timing.json", results)


def evaluate(args):
    labelsPath = args.root / "judgments.json"
    digest = hashlib.sha256(labelsPath.read_bytes()).hexdigest()
    expected = (args.root / "judgments.sha256").read_text().strip()
    if digest != expected:
        raise ValueError("GT has changed since freezing")
    judgments = readJson(labelsPath)
    rankings = readJson(args.root / "rankings.json")
    queries = readJson(args.root / "queries.json")
    grades = {}
    for judgment in judgments:
        pair = (judgment["query"], judgment["candidate"])
        if pair in grades or judgment["grade"] not in [0, 1, 2, 3]:
            raise ValueError("Invalid or duplicate judgment")
        grades[pair] = judgment["grade"]
    metrics, perQuery = {}, {}
    discount = np.log2(np.arange(2, 12))
    for name, source in rankings.items():
        perQuery[name] = {}
        for query in queries:
            key = query["id"]
            hits = source[key][:10]
            relevantGrades = [grade for (q, _), grade in grades.items() if q == key]
            ideal = sorted(relevantGrades, reverse=True)[:10]
            idcg = float(((2 ** np.array(ideal) - 1) / discount[:len(ideal)]).sum())
            if any((key, hit["key"]) not in grades for hit in hits):
                raise ValueError(f"Unjudged Top-10: {name}, {key}")
            actual = [grades[key, hit["key"]] for hit in hits]
            dcg = float(((2 ** np.array(actual) - 1) / discount[:len(actual)]).sum())
            relevant = sum(g >= 2 for g in actual)
            totalRelevant = sum(g >= 2 for g in relevantGrades)
            perQuery[name][key] = {"nDCG@10": dcg / idcg if idcg else 0,
                                   "P@10": relevant / 10,
                                   "pooledRecall@10": relevant / totalRelevant if totalRelevant else 0,
                                   "judgedCoverage@10": 1.0}
        metrics[name] = {}
        for split in ["dev", "test", "all"]:
            keys = [q["id"] for q in queries if split == "all" or q["split"] == split]
            metrics[name][split] = {metric: float(np.mean([perQuery[name][key][metric] for key in keys]))
                                    for metric in ["nDCG@10", "P@10", "pooledRecall@10", "judgedCoverage@10"]}
    rng = np.random.default_rng(20261015)
    keys = [q["id"] for q in queries if q["split"] == "test"]
    samples = rng.integers(0, len(keys), size=(10000, len(keys)))
    differences = {}
    for baseline in ["lexical", "minilm"]:
        differences[baseline] = {}
        for name in rankings:
            values = np.array([perQuery[name][k]["nDCG@10"] - perQuery[baseline][k]["nDCG@10"] for k in keys])
            bootstrap = values[samples].mean(axis=1)
            differences[baseline][name] = {"delta": float(values.mean()),
                                           "ci95": list(np.percentile(bootstrap, [2.5, 97.5]))}
    writeJson(args.root / "results.json", {"judgmentsSha256": digest, "pairs": len(judgments),
                                           "metrics": metrics, "perQuery": perQuery,
                                           "pairedHoldoutDifferences": differences})
    for name, values in metrics.items():
        print(name, "test", values["test"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "encode", "rank", "lookup", "evaluate"])
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path("build/retrieval-benchmark"))
    parser.add_argument("--model", choices=["minilm", "specter", "gemma"])
    parser.add_argument("--batch", type=int, default=16)
    args = parser.parse_args()
    globals()[args.command](args)
