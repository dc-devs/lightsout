import { expect, test } from '@jest/globals';
import { commandCatalog, renderUsage } from '#src/commands/index.ts';
import { usageFixture } from '#tests/helpers/usageFixture.ts';

/** The usage lines, without the header above them or the exit codes below. */
const setupRenderUsage = () => {
	const usage = renderUsage();
	const lines = usage.split('\n').filter((line) => line.startsWith('  lightsout '));

	return { usage, lines };
};

test('renderUsage: reproduces the checked-in --help text byte for byte', () => {
	const { usage } = setupRenderUsage();

	expect(usage).toBe(usageFixture);
});

test('renderUsage: emits one line for every catalog invocation of a command with a CLI form, and no others', () => {
	const { lines } = setupRenderUsage();
	const invocations = commandCatalog.filter((entry) => entry.cli !== undefined).flatMap((entry) => entry.invocations);

	expect(lines).toHaveLength(invocations.length);
});

test('renderUsage: gives every command exactly as many lines as it has invocation shapes', () => {
	const { lines } = setupRenderUsage();
	const runnable = commandCatalog.filter((entry) => entry.cli !== undefined);
	const counted = runnable.map((entry) => [entry.id, lines.filter((line) => line.startsWith(`  ${entry.cli} `)).length]);

	expect(counted).toStrictEqual(runnable.map((entry) => [entry.id, entry.invocations.length]));
});

test('renderUsage: renders a mutually exclusive pair inside one bracket rather than two', () => {
	const { lines } = setupRenderUsage();

	expect(lines.some((line) => line.includes('[--code-checks | --agent-review]'))).toBe(true);
});

test('renderUsage: aligns a note that fits to column 55, and leaves three spaces before one that does not', () => {
	const { lines } = setupRenderUsage();
	const short = lines.find((line) => line.startsWith('  lightsout standards-health')) ?? '';
	const long = lines.find((line) => line.startsWith('  lightsout plan grade')) ?? '';

	expect(short.indexOf('(')).toBe(54);
	expect(long.slice(long.indexOf('(') - 3, long.indexOf('('))).toBe('   ');
});

test('renderUsage: renders a required flag bare and every optional one in brackets', () => {
	const { lines } = setupRenderUsage();

	const resume = lines.find((line) => line.startsWith('  lightsout test-coverage-to-threshold --run')) ?? '';

	expect(resume).toContain('--run <id> [--cwd <path>]');
	expect(resume).not.toContain('[--run <id>]');
});

test('renderUsage: keeps a flag that names one shape off the lines of the other shapes', () => {
	const { lines } = setupRenderUsage();

	const fresh = lines.find((line) => line.startsWith('  lightsout test-coverage-to-threshold [')) ?? '';
	const resume = lines.find((line) => line.startsWith('  lightsout test-coverage-to-threshold --run')) ?? '';

	expect(fresh).toContain('[--max-batches <n>]');
	expect(resume).not.toContain('--max-batches');
});

test('renderUsage: prints a shape’s positional words straight after the command word', () => {
	const { lines } = setupRenderUsage();

	const toggle = lines.find((line) => line.startsWith('  lightsout voice on|off')) ?? '';
	const hook = lines.find((line) => line.startsWith('  lightsout voice hook')) ?? '';

	expect(toggle).toContain('lightsout voice on|off [--cwd <path>]');
	expect(hook).toContain('lightsout voice hook [--cwd <path>]');
});

test('renderUsage: leaves a shape with no gloss unpadded, so only a glossed line carries a parenthetical', () => {
	const { lines } = setupRenderUsage();

	const plain = lines.find((line) => line.startsWith('  lightsout status')) ?? '';

	expect(plain).toBe('  lightsout status [--cwd <path>]');
});

test('renderUsage: emits the brainstorm publish line above the plan lines', () => {
	const { lines } = setupRenderUsage();

	const brainstorm = lines.findIndex((line) => line.startsWith('  lightsout brainstorm publish'));
	const firstPlan = lines.findIndex((line) => line.startsWith('  lightsout plan '));

	expect(lines[brainstorm]).toBe('  lightsout brainstorm publish --name <name> [--cwd <path>]');
	expect(brainstorm).toBeLessThan(firstPlan);
});
