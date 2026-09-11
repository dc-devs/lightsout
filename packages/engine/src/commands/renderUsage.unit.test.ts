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

test('renderUsage: prints the self-check line, so an agent-run command is listed with every other command', () => {
	const { lines } = setupRenderUsage();

	const selfCheck = lines.find((line) => line.startsWith('  lightsout self-check')) ?? '';
	const ticketState = lines.findIndex((line) => line.startsWith('  lightsout ticket-state'));

	expect(selfCheck).toContain('lightsout self-check --run <id> [--cwd <path>]');
	expect(lines.indexOf(selfCheck)).toBe(ticketState + 1);
});

test('renderUsage: prints the plan sync-decisions line between plan draft and plan lint', () => {
	const { lines } = setupRenderUsage();

	const sync = lines.filter((line) => line.startsWith('  lightsout plan sync-decisions'));
	const draft = lines.findIndex((line) => line.startsWith('  lightsout plan draft'));
	const lint = lines.findIndex((line) => line.startsWith('  lightsout plan lint'));

	expect(sync).toStrictEqual(['  lightsout plan sync-decisions --name <name> [--cwd <path>]']);
	expect(lines.indexOf(sync[0] ?? '')).toBe(draft + 1);
	expect(lint).toBe(draft + 2);
});

test('prints the status --planning line directly after the status --run line', () => {
	const { lines } = setupRenderUsage();

	const planning = lines.filter((line) => line.startsWith('  lightsout status --planning'));
	const run = lines.findIndex((line) => line.startsWith('  lightsout status ') && line.includes('--run <id>'));

	expect(planning).toHaveLength(1);
	expect(planning[0]).toContain('lightsout status --planning <name> [--cwd <path>]');
	expect(lines.indexOf(planning[0] ?? '')).toBe(run + 1);
});

test('renderUsage: prints the status --shipping line after the other status lines and before doctor', () => {
	const { lines } = setupRenderUsage();

	const shipping = lines.filter((line) => line.startsWith('  lightsout status --shipping <branch> [--cwd <path>]'));
	const mentions = lines.filter((line) => line.includes('--shipping'));
	const shippingIndex = lines.indexOf(shipping[0] ?? '');
	// The --queue shape came after --shipping and is the one status line printed below it; its own test pins that.
	const queueIndex = lines.findIndex((line) => line.startsWith('  lightsout status --queue'));
	const otherStatus = lines.flatMap((line, index) =>
		line.startsWith('  lightsout status ') && index !== shippingIndex && index !== queueIndex ? [index] : [],
	);
	const doctor = lines.findIndex((line) => line.startsWith('  lightsout doctor'));

	expect(shipping).toHaveLength(1);
	expect(mentions).toStrictEqual(shipping);
	expect(otherStatus.length).toBeGreaterThan(0);
	expect(Math.max(...otherStatus)).toBeLessThan(shippingIndex);
	expect(shippingIndex).toBeLessThan(doctor);
});

test('renderUsage: prints the status --queue shape after the other status lines, with --run and without --watch', () => {
	const { lines } = setupRenderUsage();

	const queue = lines.filter((line) => line.startsWith('  lightsout status --queue'));
	const mentions = lines.filter((line) => line.includes('--queue'));
	const queueIndex = lines.indexOf(queue[0] ?? '');
	const otherStatus = lines.flatMap((line, index) => (line.startsWith('  lightsout status') && index !== queueIndex ? [index] : []));

	expect(queue).toHaveLength(1);
	expect(mentions).toStrictEqual(queue);
	expect(queue[0]).toMatch(/^ {2}lightsout status --queue \[--run <id>\] \[--cwd <path>\](?: |$)/);
	expect(queue[0]).not.toContain('--watch');
	expect(otherStatus.length).toBeGreaterThan(0);
	expect(queueIndex).toBe(Math.max(...otherStatus) + 1);
});
