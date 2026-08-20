/**
 * A CommonJS stand-in for `@tanstack/react-start/server`.
 *
 * Same reason as the stubs beside it: the subpath publishes only an `import`
 * condition, so Jest's CommonJS resolver cannot load it however it is
 * configured — and requiring the server entry has to reach *something* before a
 * test can mock these two names over the top of it. Neither body is ever run;
 * what the real pair does is proved by the build and by the server answering a
 * request.
 */
export const defaultStreamHandler = (): null => null;

export const createStartHandler = (): (() => null) => () => null;
