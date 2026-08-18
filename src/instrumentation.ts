/**
 * Next.js start-up hook.
 *
 * The node-only work lives in ./instrumentation-node so it can be imported
 * *inside* the NEXT_RUNTIME check. Next replaces `process.env.NEXT_RUNTIME`
 * with a literal per runtime, so this shape lets the edge bundle drop the
 * import entirely — an early `return` would not, and the edge build then fails
 * trying to resolve `fs`/`path` through `pg`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
