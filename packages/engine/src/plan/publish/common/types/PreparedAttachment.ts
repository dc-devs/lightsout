/** One file's bare name and the exact bytes read for it, before any title prefix is decided. */
export interface PreparedAttachment {
	name: string;
	content: Buffer;
}
