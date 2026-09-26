interface Params {
	/** The document's intro — its `document.md` body, which opens on a `# ` heading. */
	intro: string;
	/** Pack-relative folder path, the fallback when the intro has no heading. */
	path: string;
}

/**
 * A document's title: its intro's top heading, or its folder name made readable
 * when it has none.
 *
 * @param intro - the document's intro
 * @param path - the document's folder path
 */
export const readDocumentTitle = ({ intro, path }: Params): string => {
	const heading = /^#\s+(.+)$/m.exec(intro)?.[1]?.trim();
	const folder = path.split('/').at(-1) ?? path;

	return heading ?? folder.charAt(0).toUpperCase() + folder.slice(1).replaceAll('-', ' ');
};
