// bysquare/pay is a pure-ESM package (see types/bysquare-pay.d.ts for why it needs a type shim
// at all) whose own dependency (lzma1, used for the PAY by square binary payload compression)
// declares no CJS "require" export condition. A statically compiled `import "bysquare/pay"`
// downlevels to `require("bysquare/pay")` under this project's `module: "CommonJS"` target and
// throws ERR_PACKAGE_PATH_NOT_EXPORTED at runtime — confirmed by actually starting the dev
// server, not just by running the test suite (Vitest resolves modules via Vite's ESM-native
// pipeline and never hits Node's CJS loader, so paymentQr.test.ts passed throughout even while
// the real server crashed on this). Plain dynamic `import()` doesn't help either — TypeScript
// downlevels that to `Promise.resolve().then(() => require(...))` under CommonJS too (verified
// by inspecting tsc's own output). Routing through `new Function` is opaque to that downlevel
// transform, so it survives as a genuine native `import()` call, which resolves the whole ESM
// chain (including lzma1) correctly — verified with a standalone Node script.
//
// This lives in its own module (instead of inline in paymentQr.ts) purely so tests can swap it
// out: the `new Function`-based dynamic import also doesn't work inside Vitest's worker-thread
// sandbox (`TypeError: A dynamic import callback was not specified` — a V8 embedder-level
// restriction on dynamically-compiled code, not something fixable at the syntax level; a plain
// `import "bysquare/pay"` at the top of a test file works fine there, which is what the test's
// mock substitutes underneath).
const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

export async function loadBysquarePay(): Promise<typeof import("bysquare/pay")> {
  return (await dynamicImport("bysquare/pay")) as typeof import("bysquare/pay");
}
