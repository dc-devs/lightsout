import { describe, expect, test } from '@jest/globals';
import { StandardsPackageRoot } from '@/contracts';

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

describe('StandardsPackageRoot', () => {
	test('a package root file parses to its name and format version', () => {
		const { root } = setupRoot();

		const parsed = StandardsPackageRoot.parse(root);

		expect(parsed).toStrictEqual({ name: 'lightsout defaults', formatVersion: 1 });
	});

	test('the name survives verbatim — it is the text every assembled document header carries', () => {
		const { root } = setupRoot({ extra: { name: 'acme/house-rules' } });

		const parsed = StandardsPackageRoot.parse(root);

		expect(parsed.name).toBe('acme/house-rules');
	});

	test('keys the contract does not declare are kept out of the parsed root rather than refused', () => {
		const { root } = setupRoot({ extra: { description: 'the bundled defaults', channels: ['react'] } });

		const parsed = StandardsPackageRoot.parse(root);

		// the root file carries only what the folder tree cannot express, and a later
		// format version may add keys — an unknown key is never worth refusing a
		// package over, so it is dropped instead
		expect(parsed).toStrictEqual({ name: 'lightsout defaults', formatVersion: 1 });
	});

	test.each([{ field: 'name' }, { field: 'formatVersion' }])('rejects a root file with no $field', ({ field }) => {
		const { root } = setupRoot({ omit: field });

		const result = StandardsPackageRoot.safeParse(root);

		// both fields are required: the loader names the package by one and decides
		// how to read the tree by the other, so neither can be inferred
		expect(result.success).toBe(false);
	});

	test('rejects an empty name', () => {
		const { root } = setupRoot({ extra: { name: '' } });

		const result = StandardsPackageRoot.safeParse(root);

		// an empty name would render a document header that identifies no package
		expect(result.success).toBe(false);
	});

	test.each([{ name: 42 }, { name: ['lightsout defaults'] }, { name: null }])('rejects a name that is not a string ($name)', ({ name }) => {
		const { root } = setupRoot({ extra: { name } });

		const result = StandardsPackageRoot.safeParse(root);

		// the name is printed into the header line as-is, never coerced
		expect(result.success).toBe(false);
	});

	test('accepts the one format version this engine knows how to read', () => {
		const { root } = setupRoot({ extra: { formatVersion: 1 } });

		const parsed = StandardsPackageRoot.parse(root);

		expect(parsed.formatVersion).toBe(1);
	});

	test.each([{ formatVersion: 2 }, { formatVersion: 0 }, { formatVersion: '1' }, { formatVersion: true }, { formatVersion: null }])(
		'rejects a format version of $formatVersion',
		({ formatVersion }) => {
			const { root } = setupRoot({ extra: { formatVersion } });

			const result = StandardsPackageRoot.safeParse(root);

			// the version is a single literal, not a range or a coerced number: a package
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
		const result = StandardsPackageRoot.safeParse(value);

		// the file is read as JSON and handed straight here — anything but an object
		// means the path pointed at something that is not a package root
		expect(result.success).toBe(false);
	});
});
