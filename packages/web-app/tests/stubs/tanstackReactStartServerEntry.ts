/**
 * A CommonJS stand-in for `@tanstack/react-start/server-entry`.
 *
 * The subpath the app's default export comes from, and `import`-only like the
 * rest of the package, so Jest needs a resolvable file here before a test can
 * mock the one name it publishes.
 */
export const createServerEntry = ({ fetch }: { fetch: unknown }): { fetch: unknown } => ({ fetch });
