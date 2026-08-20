/**
 * A stand-in for a `?url` stylesheet import.
 *
 * `import appCss from '…/app.css?url'` is a Vite instruction, not a module
 * reference: the suffix asks the bundler for the URL the stylesheet will be
 * served from, and nothing matching that specifier exists on disk. Jest resolves
 * requires against the filesystem, so the root route cannot be required at all
 * without this. What the href finally is comes from the build, and no unit test
 * asserts on it.
 */
export default '/assets/app.css';
