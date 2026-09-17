import { describe, expect, test } from '@jest/globals';
import { parseAttachmentManifest } from '#src/common/attachmentManifest/parseAttachmentManifest.ts';

const sha = 'a'.repeat(64);

const setupBrainstormMarker = ({ text }: { text: string }) => ({
	text,
	markerName: 'brainstorm-attachments.json',
	isAllowedName: ({ name }: { name: string }) => name === 'brainstorm-notes.md' || name === 'brainstorm-decisions.json',
});

const setupMalformedMarkers = () => {
	const texts = [
		'{ this is not json',
		'[]',
		JSON.stringify({ schemaVersion: 2, files: [{ name: 'brainstorm-notes.md', sha256: sha }] }),
		JSON.stringify({ schemaVersion: 1, files: [] }),
		JSON.stringify({ schemaVersion: 1, files: ['brainstorm-notes.md'] }),
		JSON.stringify({ schemaVersion: 1, files: [{ name: '../escape.md', sha256: sha }] }),
		JSON.stringify({ schemaVersion: 1, files: [{ name: 'brainstorm-notes.md', sha256: 'not-a-hash' }] }),
		JSON.stringify({
			schemaVersion: 1,
			files: [
				{ name: 'brainstorm-notes.md', sha256: sha },
				{ name: 'brainstorm-notes.md', sha256: sha },
			],
		}),
	];

	return { params: texts.map((text) => setupBrainstormMarker({ text })) };
};

describe('parseAttachmentManifest', () => {
	test("parseAttachmentManifest: refuses a file name the caller's predicate rejects", () => {
		const params = setupBrainstormMarker({
			text: JSON.stringify({ schemaVersion: 1, files: [{ name: 'plan.md', sha256: sha }] }),
		});

		const result = parseAttachmentManifest(params);

		expect(result).toEqual({ error: expect.stringMatching(/^brainstorm-attachments\.json .*"plan\.md"/) });
	});

	test("parseAttachmentManifest: names the caller's marker title in every refusal", () => {
		const { params } = setupMalformedMarkers();

		const results = params.map((each) => parseAttachmentManifest(each));

		expect(results.map((result) => ('error' in result ? result.error : 'accepted with no refusal'))).toEqual(
			params.map(() => expect.stringMatching(/^brainstorm-attachments\.json /)),
		);
	});
});
