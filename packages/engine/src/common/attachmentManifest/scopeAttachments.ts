interface Params<Attachment> {
	attachments: Attachment[];
	/** The plan id whose namespace the list is narrowed to. Absent answers the list unchanged. */
	prefix?: string;
}

/**
 * Narrow a ticket's attachment list to one plan's namespace, with the prefix
 * taken off every title that survives.
 *
 * Everything downstream — selecting a generation, parsing a marker, deciding
 * whether a plan was published at all — is written against bare file names, so
 * this is the one place a prefixed ticket is turned back into the single-plan
 * list those steps already read. With no prefix the list passes through, which
 * is what keeps a legacy folder behaving exactly as it did.
 *
 * Generic over `{ title }` so the shared folder never imports the tracker's own
 * attachment type; every other field of each attachment, its url above all, is
 * carried through untouched.
 */
export const scopeAttachments = <Attachment extends { title: string }>({ attachments, prefix }: Params<Attachment>): Attachment[] => {
	if (prefix === undefined) {
		return attachments;
	}

	const namespace = `${prefix}--`;

	return attachments
		.filter(({ title }) => title.startsWith(namespace))
		.map((attachment) => ({ ...attachment, title: attachment.title.slice(namespace.length) }));
};
