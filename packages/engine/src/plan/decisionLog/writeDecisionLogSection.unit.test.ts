import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { writeDecisionLogSection } from '#src/plan/decisionLog/writeDecisionLogSection.ts';

// The engine-owned region of a plan file: this puts one rendered `## Decision
// Log` section into one plan file and touches nothing else. A section the file
// already carries is replaced in place; a file with no section gets one
// directly above `## Global Constraints`; a section that already matches is
// left on disk untouched, because the sync is meant to be safe to repeat.

/** A section as the renderer hands it over — heading line included, no trailing newline. */
const composedSection = '## Decision Log\n\nComposed by `lightsout plan sync-decisions`. Do not edit by hand.\n\nNo decisions recorded.';

/** The stale section a plan file carries before the sync runs. */
const staleSection = '## Decision Log\n\nhand-typed by the writer.\n\n| # | Source | Choice |\n|---|--------|--------|\n| 1 | Brainstorm | build it |';

/** A plan file whose only variable is the Decision Log section; every other line is fixed, so a diff outside the section is visible. */
const planBody = ({ log }: { log: string }) =>
	`# Some Plan\n\n## Context\n\nthe reason this plan exists.\n\n${log}\n\n## Global Constraints\n\n- no migration work.\n\n## Verification\n\n- \`pnpm test\`\n`;

/** The same plan with the Decision Log as its last section, so no heading follows the span being replaced. */
const planEndingWithLog = ({ log, trailingNewline = true }: { log: string; trailingNewline?: boolean }) =>
	`# Some Plan\n\n## Context\n\nthe reason this plan exists.\n\n## Global Constraints\n\n- no migration work.\n\n${log}${trailingNewline ? '\n' : ''}`;

/** A malformed plan: no Decision Log, and no `## Global Constraints` heading for the insert to anchor on. */
const planWithoutAnchor = ({ trailingNewline = true }: { trailingNewline?: boolean } = {}) =>
	`# Some Plan\n\n## Context\n\nthe reason this plan exists.${trailingNewline ? '\n' : ''}`;

/** The same plan with no Decision Log at all — `## Global Constraints` follows the context directly. */
const planWithoutLog = () =>
	'# Some Plan\n\n## Context\n\nthe reason this plan exists.\n\n## Global Constraints\n\n- no migration work.\n\n## Verification\n\n- `pnpm test`\n';

/** A plan file on disk, backdated so that any rewrite moves its modification time. */
const setupPlanFile = ({ content }: { content: string }) => {
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-decision-log-'));
	const path = join(workspaceDir, 'plan.md');

	writeFileSync(path, content, 'utf8');

	const backdated = new Date('2020-01-01T00:00:00.000Z');

	utimesSync(path, backdated, backdated);

	return { path, modifiedAt: statSync(path).mtimeMs, readPlan: () => readFileSync(path, 'utf8') };
};

describe('writeDecisionLogSection', () => {
	test('writeDecisionLogSection: replaces the existing section and leaves every other line untouched', async () => {
		const plan = setupPlanFile({ content: planBody({ log: staleSection }) });

		const written = await writeDecisionLogSection({ path: plan.path, section: composedSection });

		// the expected text comes from the same template as the input, so only the
		// Decision Log span can differ — the context, the constraints and the
		// trailing verification section all have to survive byte-for-byte
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: planBody({ log: composedSection }),
			written: { path: plan.path, updated: true },
		});
	});

	test("writeDecisionLogSection: keeps the file's own ending when the Decision Log is its last section", async () => {
		const plan = setupPlanFile({ content: planEndingWithLog({ log: staleSection }) });

		const written = await writeDecisionLogSection({ path: plan.path, section: composedSection });

		// no heading follows the replaced span, so the blank line a heading would
		// need is not written — the file keeps the single newline it ended with
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: planEndingWithLog({ log: composedSection }),
			written: { path: plan.path, updated: true },
		});
	});

	test('writeDecisionLogSection: replaces a trailing Decision Log in a file that ends without a newline', async () => {
		const plan = setupPlanFile({ content: planEndingWithLog({ log: staleSection, trailingNewline: false }) });

		const written = await writeDecisionLogSection({ path: plan.path, section: composedSection });

		// the file ended mid-line before the sync and still does after it: the
		// rewriter adds no ending the file did not already have
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: planEndingWithLog({ log: composedSection, trailingNewline: false }),
			written: { path: plan.path, updated: true },
		});
	});

	test('writeDecisionLogSection: appends the section at the end when the file carries neither heading', async () => {
		const plan = setupPlanFile({ content: planWithoutAnchor() });

		const written = await writeDecisionLogSection({ path: plan.path, section: composedSection });

		// a plan with no Global Constraints heading is malformed, and the history
		// is appended rather than dropped on the floor
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: `${planWithoutAnchor({ trailingNewline: false })}\n\n${composedSection}\n`,
			written: { path: plan.path, updated: true },
		});
	});

	test('writeDecisionLogSection: appends the section to an anchorless file that ends without a newline', async () => {
		const plan = setupPlanFile({ content: planWithoutAnchor({ trailingNewline: false }) });

		const written = await writeDecisionLogSection({ path: plan.path, section: composedSection });

		// the appended section carries no ending of its own, so the file still ends
		// exactly where its last line does
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: `${planWithoutAnchor({ trailingNewline: false })}\n\n${composedSection}`,
			written: { path: plan.path, updated: true },
		});
	});

	test('writeDecisionLogSection: inserts the section directly above Global Constraints when the file has none', async () => {
		const plan = setupPlanFile({ content: planWithoutLog() });

		const written = await writeDecisionLogSection({ path: plan.path, section: composedSection });

		// every plan variant carries `## Global Constraints`, so it is the anchor —
		// appending at the end of the file, or landing inside the constraints,
		// would both show up here
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: planBody({ log: composedSection }),
			written: { path: plan.path, updated: true },
		});
	});

	test("writeDecisionLogSection: leaves the file's bytes alone when the section already matches", async () => {
		const content = planBody({ log: composedSection });
		const plan = setupPlanFile({ content });

		const written = await writeDecisionLogSection({ path: plan.path, section: composedSection });

		// the sync is run after every recorded decision and has to be safe to
		// repeat: an unchanged file is not rewritten, so its modification time
		// stays where the backdate put it
		expect({ text: plan.readPlan(), modifiedAt: statSync(plan.path).mtimeMs, written }).toStrictEqual({
			text: content,
			modifiedAt: plan.modifiedAt,
			written: { path: plan.path, updated: false },
		});
	});
});
