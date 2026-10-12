// Stub for the `server-only` package in tests.
//
// `server-only`'s real `index.js` throws unconditionally unless resolved
// under the `react-server` export condition (see vitest.config.ts's
// comment) - and Vitest externalizes node_modules packages by default,
// which bypasses Vite's `resolve.conditions` entirely for them. Aliasing
// the package to this empty file sidesteps that resolution gap rather than
// fighting it.
export {};
