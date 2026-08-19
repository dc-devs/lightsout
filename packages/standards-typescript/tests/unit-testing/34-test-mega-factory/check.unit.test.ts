import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const path = 'src/feature/getLabel.unit.test.ts';

/** A test file whose only content is the factory declaration given, sitting on line 3. */
const buildFactorySource = ({ declaration }: { declaration: string }) =>
	["import { describe, expect, test } from '@jest/globals';", '', declaration].join('\n');

/** Four parameters, one over the cap the tests set. */
const sprawlingFactory = 'const setupInvoice = ({ a = 1, b = 2, c = 3, d = 4 }: Params = {}) => ({ a });';

/** The same four parameters, awaited. */
const asyncSprawlingFactory = 'const setupInvoice = async ({ a = 1, b = 2, c = 3, d = 4 }: Params = {}) => ({ a });';

/** Three parameters — exactly the cap. */
const cappedFactory = 'const setupInvoice = ({ a = 1, b = 2, c = 3 }: Params = {}) => ({ a });';

/** Three parameters whose defaults hold commas of their own. */
const bracketedDefaultsFactory = "const setupInvoice = ({ items = ['a', 'b'], amount = pick(1, 2), currency = 'USD' }: Params = {}) => ({ amount });";

/** Four parameters, the first defaulting to an object — a shape the pattern cannot measure. */
const nestedDefaultFactory = "const setupInvoice = ({ customer = { name: 'Ada' }, b = 2, c = 3, d = 4 }: Params = {}) => ({ b });";

/** Two sprawling factories in one file, declared on lines 3 and 5. */
const twoFactoriesSource = [
	"import { describe, expect, test } from '@jest/globals';",
	'',
	'const setupInvoice = ({ a = 1, b = 2, c = 3, d = 4 }: Params = {}) => ({ a });',
	'',
	'const setupCustomer = ({ a = 1, b = 2, c = 3, d = 4, e = 5 }: Params = {}) => ({ a });',
].join('\n');

describe('test-mega-factory check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a factory past the cap, stating its count and the cap it broke', async () => {
		const input = setupTestFileInput({ contents: [[path, buildFactorySource({ declaration: sprawlingFactory })]] });

		const findings = await check.run({ input, settings: { maxParams: 3 } });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-mega-factory:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 3, endLine: 3 }],
				detail: "'setupInvoice' takes 4 parameters (line 3), over the cap of 3",
				guidance: 'A substantially different arrangement gets a second named factory. Heuristic — judge before acting.',
			},
		]);
	});

	test('measures an async factory by the same cap', async () => {
		const input = setupTestFileInput({ contents: [[path, buildFactorySource({ declaration: asyncSprawlingFactory })]] });

		const findings = await check.run({ input, settings: { maxParams: 3 } });

		expect(findings.map((finding) => finding.detail)).toStrictEqual(["'setupInvoice' takes 4 parameters (line 3), over the cap of 3"]);
	});

	test('leaves a factory at the cap alone — the cap is a ceiling, not a target to stay clear of', async () => {
		const input = setupTestFileInput({ contents: [[path, buildFactorySource({ declaration: cappedFactory })]] });

		const findings = await check.run({ input, settings: { maxParams: 3 } });

		expect(findings).toStrictEqual([]);
	});

	test('counts a default value holding commas as the one parameter it declares', async () => {
		const input = setupTestFileInput({ contents: [[path, buildFactorySource({ declaration: bracketedDefaultsFactory })]] });

		const findings = await check.run({ input, settings: { maxParams: 3 } });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a factory whose default nests an object unjudged, rather than reporting a guessed count', async () => {
		const input = setupTestFileInput({ contents: [[path, buildFactorySource({ declaration: nestedDefaultFactory })]] });

		const findings = await check.run({ input, settings: { maxParams: 3 } });

		expect(findings).toStrictEqual([]);
	});

	test('names every sprawling factory of one file in a single finding', async () => {
		const input = setupTestFileInput({ contents: [[path, twoFactoriesSource]] });

		const findings = await check.run({ input, settings: { maxParams: 3 } });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-mega-factory:src/feature/getLabel.unit.test.ts',
				files: [
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 3, endLine: 3 },
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 5, endLine: 5 },
				],
				detail: "'setupInvoice' takes 4 parameters (line 3), 'setupCustomer' takes 5 parameters (line 5), over the cap of 3",
				guidance: 'A substantially different arrangement gets a second named factory. Heuristic — judge before acting.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: { maxParams: 3 } });

		expect(findings).toStrictEqual([]);
	});
});
