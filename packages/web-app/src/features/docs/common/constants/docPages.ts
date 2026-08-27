import configurationDoc from '#docs/configuration.md';
import monoreposDoc from '#docs/monorepos.md';

/** One document the site serves: what the page is called, and the markdown it renders. */
interface DocPageEntry {
	title: string;
	text: string;
}

/**
 * The markdown documents the site renders, by route param.
 *
 * The text is the repo's own `docs/` folder, bundled at build time rather than
 * read from disk — the public build holds no repo, and a doc that shipped with
 * the app cannot describe a version of lightsout the app is not.
 *
 * Typed against a plain string key rather than its own two names: the route
 * param is whatever a reader typed, and an entry that may be absent is what
 * lets the page answer a wrong one instead of throwing.
 */
export const docPages: Record<string, DocPageEntry | undefined> = {
	configuration: { title: 'Configuration', text: configurationDoc },
	monorepos: { title: 'Monorepos', text: monoreposDoc },
};
