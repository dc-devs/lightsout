import { describe, expect, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';

const setupGeneration = () => {
	const files = [
		{ name: 'brainstorm-notes.md', content: Buffer.from('# Brainstorm notes\n', 'utf8') },
		{ name: 'brainstorm-decisions.json', content: Buffer.from('{\n\t"planName": "lo-117"\n}\n', 'utf8') },
	];

	return { files };
};

describe('serializeAttachmentManifest', () => {
	test('serializeAttachmentManifest: names each file with the SHA-256 of its own bytes', () => {
		const { files } = setupGeneration();

		const marker = serializeAttachmentManifest({ files });

		expect(JSON.parse(marker.toString('utf8'))).toStrictEqual({
			schemaVersion: 1,
			files: [
				{ name: 'brainstorm-notes.md', sha256: '193e4a425d4229fd2a4e67a8e2af0c1f01e3f702d45ae8c869fe486042916278' },
				{ name: 'brainstorm-decisions.json', sha256: 'd66f1e86556ebdb81f9184bda6665fdbfee293470f8c2fe315cd6219eef2e48e' },
			],
		});
	});
});
