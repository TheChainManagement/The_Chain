// Stub for `server-only` under vitest's node env. The real package throws on
// import outside a React Server Component bundle; in tests we exercise the
// server modules directly, so we resolve it to this no-op.
export {};
