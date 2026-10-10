// Exercise the real macOS helper with local weights; never touch the user library.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import { AutoTokenizer, env } from "@huggingface/transformers";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
env.allowRemoteModels = false;
const dir = process.env.SW_NATIVE_MODEL_DIR;
assert.ok(
  dir,
  "Set SW_NATIVE_MODEL_DIR to a local directory containing tokenizer files and model.onnx",
);
const tokenizer = await AutoTokenizer.from_pretrained(dir);
const texts = [
  "Spectral hashing for fast similarity search with binary codes.",
  "Learning compact binary hashing codes for nearest neighbor retrieval.",
  "Fashion design and clothing style analysis.",
];
const inputs = texts.map((text) =>
  Object.fromEntries(
    Object.entries(
      tokenizer(text, {
        padding: "max_length",
        truncation: true,
        max_length: 256,
      }),
    ).map(([name, tensor]) => [name, Array.from(tensor.data, Number)]),
  ),
);
const executable = fileURLToPath(
  new URL("../build/native/inference", import.meta.url),
);
const results = [];
for (const mode of ["cpu", "coreml"]) {
  const child = spawn(executable, [dir + "/model.onnx", mode], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let diagnostic = "";
  child.stderr.on("data", (bytes) => {
    diagnostic = (diagnostic + bytes).slice(-4000);
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 180000);
  const lines = createInterface({ input: child.stdout })[
    Symbol.asyncIterator
  ]();
  const read = async () => {
    const { value, done } = await lines.next();
    assert.ok(!done, diagnostic || "Helper exited unexpectedly");
    return JSON.parse(value);
  };
  try {
    const started = performance.now();
    const ready = await read();
    assert.ok(ready.ready, JSON.stringify(ready));
    const loadMs = performance.now() - started;
    const vectors = [];
    const times = [];
    for (const input of inputs) {
      const start = performance.now();
      child.stdin.write(JSON.stringify(input) + "\n");
      const result = await read();
      assert.ok(!result.error, result.error);
      assert.equal(result.vector.length, 384);
      assert.ok(result.vector.every(Number.isFinite));
      assert.ok(
        Math.abs(result.vector.reduce((sum, n) => sum + n * n, 0) - 1) < 1e-5,
      );
      vectors.push(result.vector);
      times.push(performance.now() - start);
    }
    const cosine = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
    assert.ok(cosine(vectors[0], vectors[1]) > cosine(vectors[0], vectors[2]));
    child.stdin.write('{"input_ids":[]}\n');
    assert.match((await read()).error, /256-token/);
    const exit = once(child, "exit");
    child.stdin.end();
    assert.equal((await exit)[0], 0, "EOF must close the helper");
    results.push({
      mode,
      backend: ready.backend,
      loadMs,
      inferenceMs: times,
      vectors,
      diagnostic,
    });
    console.log(
      JSON.stringify({
        mode,
        backend: ready.backend,
        loadMs,
        inferenceMs: times,
      }),
    );
  } finally {
    clearTimeout(timeout);
    child.kill("SIGKILL");
  }
}
const minimumCosine = Math.min(
  ...results[0].vectors.map((vector, i) =>
    vector.reduce((sum, n, d) => sum + n * results[1].vectors[i][d], 0),
  ),
);
assert.ok(minimumCosine > 0.995, `Backend vector mismatch: ${minimumCosine}`);
console.log(JSON.stringify({ minimumCosine }));
