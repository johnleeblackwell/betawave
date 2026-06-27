// Redirect console.log/info/warn to STDERR.
//
// CRITICAL for stdio transport: the MCP stdio protocol uses STDOUT as the
// JSON-RPC channel. Any stray stdout write (e.g. db.ts's "[db] Running
// local-only" banner, fired at import time) corrupts the protocol stream and
// the client disconnects. This module must be imported as the VERY FIRST
// statement in the stdio entry point, before anything that imports db.ts.
//
// console.error already goes to stderr, so we leave it untouched.
const toStderr = console.error.bind(console)
console.log = (...args: unknown[]) => toStderr(...args)
console.info = (...args: unknown[]) => toStderr(...args)
console.warn = (...args: unknown[]) => toStderr(...args)

export {}
