/**
 * A CommonJS stand-in for `@tanstack/react-start/client`.
 *
 * Same reason as the stub beside it for the package root: the subpath publishes
 * only an `import` condition, so Jest's CommonJS resolver cannot load it however
 * it is configured. The browser entry's contract is that it hands this component
 * to `hydrateRoot`, not what the component itself renders — so a stub with a
 * stable identity is exactly what a test needs to assert on. What the real one
 * does is proved by the build and by the app running.
 */
export const StartClient = (): null => null;
