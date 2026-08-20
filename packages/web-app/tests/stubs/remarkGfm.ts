/**
 * A CommonJS no-op stand-in for `remark-gfm`.
 *
 * The real package is ESM-only, and so is its whole dependency tree. What it
 * adds — tables, task lists, strikethrough — is the library's contract rather
 * than this app's, and it is proved by the Vite build and the dev run. Under
 * Jest the plugin only has to exist so the component can be rendered.
 */
const remarkGfm = () => undefined;

export default remarkGfm;
