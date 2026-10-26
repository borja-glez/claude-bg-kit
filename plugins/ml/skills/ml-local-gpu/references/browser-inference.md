# In-browser inference with onnxruntime-web

Three rules. Check versions and options in the onnxruntime-web documentation for the version the project pins.

## 1. One serial chain for sessions

The asyncify/JSEP build of ORT (the WebGPU build as of 2026-10; check the version the project pins) does not support concurrent async calls. Create sessions one after another and route every call through a single promise chain. Never `Promise.all` over `InferenceSession.create`. Symptom: WebGPU hangs and the promise never resolves.

Downloads go through the same chain, so the browser never has a download racing a session in flight:

```ts
import * as ort from 'onnxruntime-web/webgpu';

function createSerial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const next = tail.then(job, job); // runs after the previous job, also if it failed
    tail = next.catch(() => undefined); // a failure must not block the chain
    return next;
  };
}
const serial = createSerial();
const bytesA = await serial(() => fetchBytes(urlA));
const bytesB = await serial(() => fetchBytes(urlB));
const sessionA = await serial(() => ort.InferenceSession.create(bytesA, opts));
const sessionB = await serial(() => ort.InferenceSession.create(bytesB, opts));
const out = await serial(() => sessionA.run(feeds));
```

## 2. The webgpu entry

A worker that uses ORT directly imports `onnxruntime-web/webgpu`, and passes `executionProviders: ['webgpu']`. The root entry `onnxruntime-web` is the default WASM build, so the worker silently runs on WASM. Symptom: it works, slowly, with no warning.

## 3. Consent per model

Ask for the download consent per model, not per repository: two models can share a repository. Symptom: one question for two downloads.
