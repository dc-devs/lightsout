import type { AttachmentManifest } from '#src/common/types/AttachmentManifest.ts';
import { sha256 } from '#src/common/utils/sha256.ts';

interface Params {
	files: { name: string; content: Buffer }[];
}

/** Build the commit marker for one fully read generation, in the order the files will be attached. */
export const serializeAttachmentManifest = ({ files }: Params): Buffer =>
	Buffer.from(
		`${JSON.stringify(
			{
				schemaVersion: 1,
				files: files.map(({ name, content }) => ({ name, sha256: sha256({ content }) })),
			} satisfies AttachmentManifest,
			null,
			2,
		)}\n`,
		'utf8',
	);
