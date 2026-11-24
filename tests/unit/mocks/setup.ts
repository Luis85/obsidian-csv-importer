// The importer yields to the UI with window.setTimeout; give Node a `window`.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
