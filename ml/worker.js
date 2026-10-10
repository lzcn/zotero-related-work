import { env, pipeline, AutoTokenizer } from "@huggingface/transformers";

// This worker only receives text from the add-on. Model files come from its
// disk cache; inference makes no network requests and uses one WASM thread.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let sequence = 0;
const assets = new Map();
function asset(url) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    assets.set(id, { resolve, reject });
    self.postMessage({ type: "asset", id, url });
  });
}
env.customCache = {
  async match(url) {
    const bytes = await asset(url);
    return new Response(bytes, { status: 200 });
  },
  async put() {},
};
let extractor;
let tokenizer;
self.onmessage = async ({ data }) => {
  if (data.type === "asset-result") {
    const pending = assets.get(data.id);
    assets.delete(data.id);
    if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve(data.bytes);
    return;
  }
  try {
    if (data.type === "init") {
      env.backends.onnx.wasm.wasmPaths = {
        mjs: data.runtime + "ort-wasm-simd-threaded.mjs",
        wasm: data.runtime + "ort-wasm-simd-threaded.wasm",
      };
      if (data.native) {
        tokenizer = await AutoTokenizer.from_pretrained(data.model, {
          revision: data.revision,
        });
        self.postMessage({ id: data.id, ready: true });
        return;
      }
      extractor = await pipeline("feature-extraction", data.model, {
        revision: data.revision,
        dtype: "q8",
        device: "wasm",
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
      });
      self.postMessage({ id: data.id, ready: true });
    } else if (data.type === "tokenize") {
      if (!tokenizer) throw new Error("Tokenizer is not ready");
      const inputs = data.texts.map((text) => {
        const tokens = tokenizer(text, {
          padding: "max_length",
          truncation: true,
          max_length: 256,
        });
        return Object.fromEntries(
          Object.entries(tokens).map(([name, tensor]) => [
            name,
            Array.from(tensor.data, Number),
          ]),
        );
      });
      self.postMessage({ id: data.id, inputs });
    } else if (data.type === "encode") {
      if (!extractor) throw new Error("Embedding model is not ready");
      const vectors = new Array(data.texts.length);
      // Similar-length pairs limit padding; transfer vectors instead of cloning boxed numbers.
      const ordered = data.texts
        .map((text, index) => ({ text, index, length: text.length }))
        .sort((a, b) => a.length - b.length);
      for (let offset = 0; offset < ordered.length; ) {
        const batch = [ordered[offset++]];
        if (
          offset < ordered.length &&
          ordered[offset].length <= Math.max(80, batch[0].length * 1.5)
        )
          batch.push(ordered[offset++]);
        const result = await extractor(
          batch.map((entry) => entry.text),
          {
            pooling: "mean",
            normalize: true,
            padding: true,
            truncation: true,
            max_length: 256,
          },
        );
        if (result.data.length !== batch.length * 384)
          throw new Error("Invalid embedding batch dimensions");
        batch.forEach((entry, index) => {
          vectors[entry.index] = new Float32Array(
            result.data.slice(index * 384, (index + 1) * 384),
          );
        });
        await new Promise((resolve) => self.setTimeout(resolve, 0));
      }
      self.postMessage(
        { id: data.id, vectors },
        vectors.map((vector) => vector.buffer),
      );
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.message || error) });
  }
};
