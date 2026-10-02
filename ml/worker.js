import { env, pipeline } from "@huggingface/transformers";

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
      extractor = await pipeline("feature-extraction", data.model, {
        revision: data.revision,
        dtype: "q8",
        device: "wasm",
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
      });
      self.postMessage({ id: data.id, ready: true });
    } else if (data.type === "encode") {
      if (!extractor) throw new Error("Embedding model is not ready");
      const vectors = [];
      // Sequential chunks keep peak memory and CPU use bounded.
      for (const text of data.texts) {
        const result = await extractor(text, {
          pooling: "mean",
          normalize: true,
          truncation: true,
          max_length: 256,
        });
        vectors.push(Array.from(result.data));
      }
      self.postMessage({ id: data.id, vectors });
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.message || error) });
  }
};
