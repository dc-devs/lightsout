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
		const { root } = setupRoot({ extra: { description: 'the bundled defaults', channels: ['react'] } });

		const parsed = StandardsPackRoot.parse(root);

		// the root file carries only what the folder tree cannot express, and a later
		// format version may add keys — an unknown key is never worth refusing a
		// pack over, so it is dropped instead
		expect(parsed).toStrictEqual({ name: 'lightsout defaults', formatVersion: 1 });
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
