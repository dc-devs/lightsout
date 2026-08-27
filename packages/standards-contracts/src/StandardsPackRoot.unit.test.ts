import { describe, expect, test } from '@jest/globals';
import { StandardsPackRoot } from '#src/index.ts';

const setupRoot = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const root: Record<string, unknown> = {
		name: 'lightsout defaults',
		formatVersion: 1,
		...extra,
	};

	if (omit) {
		delete root[omit];
	}

	return { root };
};

describe('StandardsPackRoot', () => {
	test('a pack root file parses to its name and format version', () => {
		const { root } = setupRoot();

		const parsed = StandardsPackRoot.parse(root);

		expect(parsed).toStrictEqual({ name: 'lightsout defaults', formatVersion: 1 });
	});

	test('the name survives verbatim — it is the text every assembled document header carries', () => {
		const { root } = setupRoot({ extra: { name: 'acme/house-rules' } });

		const parsed = StandardsPackRoot.parse(root);

		expect(parsed.name).toBe('acme/house-rules');
	});

	test('an authored root carries no built marker — its absence is what says the fixtures are still there', () => {
		const { root } = setupRoot();

		const parsed = StandardsPackRoot.parse(root);

		expect(parsed.built).toBeUndefined();
	});

	test('a built root carries the marker the bundler stamps, so validate can tell the artifact from the source', () => {
		const { root } = setupRoot({ extra: { built: true } });

		const parsed = StandardsPackRoot.parse(root);

		expect(parsed).toStrictEqual({ name: 'lightsout defaults', formatVersion: 1, built: true });
	});

	test('rejects a root claiming it was not built — the marker is stamped or absent, never argued with', () => {
		const { root } = setupRoot({ extra: { built: false } });

		const result = StandardsPackRoot.safeParse(root);

		expect(result.success).toBe(false);
	});

	test('keys the contract does not declare are kept out of the parsed root rather than refused', () => {
		const { root } = setupRoot({ extra: { channels: ['react'], maintainer: 'acme' } });

		const parsed = StandardsPackRoot.parse(root);

		// the root file carries only what the folder tree cannot express, and a later
		// format version may add keys — an unknown key is never worth refusing a
		// pack over, so it is dropped instead
		expect(parsed).toStrictEqual({ name: 'lightsout defaults', formatVersion: 1 });
	});

	test('carries the one-line description a pack page shows under the pack name', () => {
		const { root } = setupRoot({ extra: { description: 'the bundled defaults' } });

		const parsed = StandardsPackRoot.parse(root);

		expect(parsed.description).toBe('the bundled defaults');
	});

	test('rejects an empty description — a pack with nothing to say omits the key instead', () => {
		const { root } = setupRoot({ extra: { description: '' } });

		const result = StandardsPackRoot.safeParse(root);

		expect(result.success).toBe(false);
	});

	test("carries the pack's own page, so a reader can go from the listing to the source", () => {
		const { root } = setupRoot({ extra: { homepage: 'https://github.com/dc-devs/lightsout' } });

		const parsed = StandardsPackRoot.parse(root);

		expect(parsed.homepage).toBe('https://github.com/dc-devs/lightsout');
	});

	test('rejects a homepage that is not a URL — the page renders it as a link, never as text', () => {
		const { root } = setupRoot({ extra: { homepage: 'packages/standards-typescript' } });

		const result = StandardsPackRoot.safeParse(root);

		expect(result.success).toBe(false);
	});

	test('a root stating neither key still parses — both are optional, so every pack written before them survives', () => {
		const { root } = setupRoot();

		const parsed = StandardsPackRoot.parse(root);

		expect(parsed).toStrictEqual({ name: 'lightsout defaults', formatVersion: 1 });
	});

	test('a built root keeps both page lines alongside the marker — the shape the bundler stamps out', () => {
		const { root } = setupRoot({
			extra: {
				description: 'The default TypeScript pack.',
				homepage: 'https://github.com/dc-devs/lightsout/tree/main/packages/standards-typescript',
				built: true,
			},
		});

		const parsed = StandardsPackRoot.parse(root);

		// the shipped copy of the default pack carries all four optional and required
		// keys at once, so the two page lines have to survive the build that adds the marker
		expect(parsed).toStrictEqual({
			name: 'lightsout defaults',
			formatVersion: 1,
			description: 'The default TypeScript pack.',
			homepage: 'https://github.com/dc-devs/lightsout/tree/main/packages/standards-typescript',
			built: true,
		});
	});

	test.each([{ field: 'name' }, { field: 'formatVersion' }])('rejects a root file with no $field', ({ field }) => {
		const { root } = setupRoot({ omit: field });

		const result = StandardsPackRoot.safeParse(root);

		// both fields are required: the loader names the pack by one and decides
		// how to read the tree by the other, so neither can be inferred
		expect(result.success).toBe(false);
	});

	test('rejects an empty name', () => {
		const { root } = setupRoot({ extra: { name: '' } });

		const result = StandardsPackRoot.safeParse(root);

		// an empty name would render a document header that identifies no pack
		expect(result.success).toBe(false);
	});

	test.each([{ name: 42 }, { name: ['lightsout defaults'] }, { name: null }])('rejects a name that is not a string ($name)', ({ name }) => {
		const { root } = setupRoot({ extra: { name } });

		const result = StandardsPackRoot.safeParse(root);

		// the name is printed into the header line as-is, never coerced
		expect(result.success).toBe(false);
	});

	test('accepts the one format version this engine knows how to read', () => {
		const { root } = setupRoot({ extra: { formatVersion: 1 } });

		const parsed = StandardsPackRoot.parse(root);

		expect(parsed.formatVersion).toBe(1);
	});

	test.each([{ formatVersion: 2 }, { formatVersion: 0 }, { formatVersion: '1' }, { formatVersion: true }, { formatVersion: null }])(
		'rejects a format version of $formatVersion',
		({ formatVersion }) => {
			const { root } = setupRoot({ extra: { formatVersion } });

			const result = StandardsPackRoot.safeParse(root);

			// the version is a single literal, not a range or a coerced number: a pack
			// written against a format this engine does not read is refused at the door
			// rather than half-loaded
			expect(result.success).toBe(false);
		},
	);

	test.each([
		{ label: 'a string', value: 'lightsout defaults' },
		{ label: 'null', value: null },
		{ label: 'an array', value: [] },
	])('rejects a root file that is $label rather than an object', ({ value }) => {
		const result = StandardsPackRoot.safeParse(value);

		// the file is read as JSON and handed straight here — anything but an object
		// means the path pointed at something that is not a pack root
		expect(result.success).toBe(false);
	});
});
