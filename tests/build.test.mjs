import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

async function fixture(t, response) {
  const root = await mkdtemp(join(tmpdir(), "related-work-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = "onnxruntime-osx-universal2-1.22.0";
  await mkdir(join(root, "archive", directory, "include"), { recursive: true });
  await mkdir(join(root, "archive", directory, "lib"));
  await writeFile(
    join(root, "archive", directory, "include/onnxruntime_cxx_api.h"),
    "header",
  );
  await writeFile(
    join(root, "archive", directory, "lib/libonnxruntime.1.22.0.dylib"),
    "library",
  );
  execFileSync("tar", [
    "-czf",
    join(root, "fixture.tgz"),
    "-C",
    join(root, "archive"),
    directory,
  ]);
  const bytes = await readFile(join(root, "fixture.tgz"));
  let requests = 0;
  const server = createServer((request, res) => {
    requests++;
    if (response === "stall") {
      res.writeHead(200);
      res.write("partial");
    } else if (response === "bad") res.end("corrupted archive");
    else res.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const source = (
    await readFile(
      new URL("../scripts/build-native.mjs", import.meta.url),
      "utf8",
    )
  )
    .replace(
      /const checksum =\s*"[a-f0-9]+";/,
      `const checksum = "${checksum}";`,
    )
    .replace(
      /const url = `[^`]+`;/,
      `const url = "http://127.0.0.1:${server.address().port}/sdk";`,
    )
    .replace('"180"', '"0.3"');
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "scripts/build-native.mjs"), source);
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          "import {prepareNativeSDK} from './scripts/build-native.mjs'; await prepareNativeSDK();",
        ],
        { cwd: root },
      );
      let output = "";
      child.stdout.on("data", (bytes) => (output += bytes));
      child.stderr.on("data", (bytes) => (output += bytes));
      child.once("error", reject);
      child.once("exit", (code) => resolve({ code, output }));
    });
  return {
    root,
    run,
    requests: () => requests,
    sdk: join(root, "build/native-sdk", directory),
  };
}

test(
  "native build tools download visibly, verify and reuse their archive without another request",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const h = await fixture(t);
    let result = await h.run();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Downloading native build tools/);
    assert.equal(
      existsSync(join(h.sdk, "lib/libonnxruntime.1.22.0.dylib")),
      true,
    );
    await rm(h.sdk, { recursive: true });
    result = await h.run();
    assert.equal(result.code, 0, result.output);
    assert.equal(h.requests(), 1);
    result = await h.run();
    assert.equal(result.code, 0, result.output);
    assert.equal(h.requests(), 1);
  },
);

for (const response of ["stall", "bad"])
  test(
    `failed ${response} download exits promptly, reports recovery and removes partial files`,
    { skip: process.platform !== "darwin" },
    async (t) => {
      const h = await fixture(t, response);
      const start = Date.now(),
        result = await h.run();
      assert.notEqual(result.code, 0, result.output);
      assert.ok(Date.now() - start < 10000, result.output);
      assert.match(result.output, /Check the network or proxy/);
      assert.equal(existsSync(h.sdk), false);
      assert.deepEqual(await readdir(join(h.root, "build/native-sdk")), []);
    },
  );
