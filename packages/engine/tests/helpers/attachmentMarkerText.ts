import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';

interface Params {
	/** One generation's files, by name and body. */
	files: Record<string, string>;
}

/**
 * The commit marker one generation of files carries, exactly as publishing
 * writes it.
 *
 * A fixture planting a marker on a ticket has to spell the bytes a real publish
 * would have sent, so it asks the serializer that owns that spelling rather
 * than restating the shape beside every test that needs one.
 */
export const attachmentMarkerText = ({ files }: Params): string =>
	serializeAttachmentManifest({ files: Object.entries(files).map(([name, body]) => ({ name, content: Buffer.from(body, 'utf8') })) }).toString('utf8');
