import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { writePlanSection } from '#src/plan/sections/writePlanSection.ts';

// One rendered section written into one plan file in place, for any named `##`
// heading. The section's span runs from its heading line to the last line
// before the next `##`, so replacing the whole span and writing exactly one
// blank line back is what lets a repeated sync leave the file byte-for-byte
// alone. A file carrying no such heading gets the section below the named
// anchor's section, or appended when the anchor is missing too.

/** The named heading this suite writes, without its leading `##`. */
const heading = 'Global Constraints';

/** The heading whose section the written one is placed immediately after when the file carries none. */
const anchor = 'Context';

/** A section as a renderer hands it over — heading line included, no trailing newline. */
const composedSection = '## Global Constraints\n\nComposed from the saved decision records. Do not edit by hand.\n\n- No constraints were set.';

/** The stale section a plan file carries before the sync runs. */
const staleSection = '## Global Constraints\n\nhand-typed by the writer.\n\n- ship the migration first.\n- keep the old flag.';

/**
 * A plan file whose only variable is the named section; every other line is
 * fixed, so a diff outside the section is visible. The section sits directly
 * under the anchor's section, which is where an insert has to land.
 */
const planBody = ({ constraints }: { constraints: string }) =>
	`# Some Plan\n\n## ${anchor}\n\nthe reason this plan exists.\n\n${constraints}\n\n## Verification\n\n- \`pnpm test\`\n`;

/** The same plan with no such section at all — `## Verification` follows the anchor's section directly. */
const planWithoutSection = () => `# Some Plan\n\n## ${anchor}\n\nthe reason this plan exists.\n\n## Verification\n\n- \`pnpm test\`\n`;

/** A plan carrying neither the named heading nor the anchor heading, so an insert has nothing to anchor on. */
const planWithoutAnchor = ({ trailingNewline = true }: { trailingNewline?: boolean } = {}) =>
	`# Some Plan\n\n## Verification\n\n- \`pnpm test\`${trailingNewline ? '\n' : ''}`;

/** The same plan with the named section as its last one, so no heading follows the span being replaced. */
const planEndingWithSection = ({ constraints, trailingNewline = true }: { constraints: string; trailingNewline?: boolean }) =>
	`# Some Plan\n\n## ${anchor}\n\nthe reason this plan exists.\n\n${constraints}${trailingNewline ? '\n' : ''}`;

/** A plan file on disk, backdated so that any rewrite moves its modification time. */
const setupPlanFile = ({ content }: { content: string }) => {
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-plan-section-'));
	const path = join(workspaceDir, 'plan.md');

	writeFileSync(path, content, 'utf8');

	const backdated = new Date('2020-01-01T00:00:00.000Z');

	utimesSync(path, backdated, backdated);

	return { path, modifiedAt: statSync(path).mtimeMs, readPlan: () => readFileSync(path, 'utf8') };
};

describe('writePlanSection', () => {
	test('replaces a named section in place and leaves every other line untouched', async () => {
		const plan = setupPlanFile({ content: planBody({ constraints: staleSection }) });

		const written = await writePlanSection({ path: plan.path, heading, section: composedSection, after: anchor });

		// the expected text comes from the same template as the input, so only the
		// named section's span can differ: the title, the anchor's section and the
		// trailing verification section all have to survive byte-for-byte, with
		// exactly one blank line left between the new section and `## Verification`
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: planBody({ constraints: composedSection }),
			written: { path: plan.path, updated: true },
		});
	});

	test('does not write when the rendered section already matches the file', async () => {
		const content = planBody({ constraints: composedSection });
		const plan = setupPlanFile({ content });

		const written = await writePlanSection({ path: plan.path, heading, section: composedSection, after: anchor });

		// the sync runs every repair round and has to be safe to repeat: an
		// unchanged file is not rewritten, so its modification time stays where the
		// backdate put it and no consumer is made to look at it again for nothing
		expect({ text: plan.readPlan(), modifiedAt: statSync(plan.path).mtimeMs, written }).toStrictEqual({
			text: content,
			modifiedAt: plan.modifiedAt,
			written: { path: plan.path, updated: false },
		});
	});

	test('inserts a missing section immediately after the named anchor section', async () => {
		const plan = setupPlanFile({ content: planWithoutSection() });

		const written = await writePlanSection({ path: plan.path, heading, section: composedSection, after: anchor });

		// the result is the same template the replace case produces, so the section
		// landed under the anchor's section — at the top of the file, or appended
		// after `## Verification`, would both show up here
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: planBody({ constraints: composedSection }),
			written: { path: plan.path, updated: true },
		});
	});

	test('appends a missing section when the anchor heading is absent too', async () => {
		const plan = setupPlanFile({ content: planWithoutAnchor() });

		const written = await writePlanSection({ path: plan.path, heading, section: composedSection, after: anchor });

		// with nothing to anchor on the section is appended rather than dropped,
		// separated by exactly one blank line, and the file keeps the single
		// newline it ended with — neither dropped nor doubled
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: `${planWithoutAnchor({ trailingNewline: false })}\n\n${composedSection}\n`,
			written: { path: plan.path, updated: true },
		});
	});

	test('replaces a trailing section without changing how the file ends', async () => {
		const plan = setupPlanFile({ content: planEndingWithSection({ constraints: staleSection }) });

		const written = await writePlanSection({ path: plan.path, heading, section: composedSection, after: anchor });

		// no heading follows the replaced span, so the blank line a following
		// heading would need is not written: the file ends exactly as it did
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: planEndingWithSection({ constraints: composedSection }),
			written: { path: plan.path, updated: true },
		});
	});

	test('appends a missing section when no anchor heading is named at all', async () => {
		const plan = setupPlanFile({ content: planWithoutAnchor({ trailingNewline: false }) });

		const written = await writePlanSection({ path: plan.path, heading, section: composedSection });

		// a caller that names no anchor is the same case as one whose anchor the
		// file does not carry: the section is appended rather than dropped, and a
		// file that ended without a newline still ends without one
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: `${planWithoutAnchor({ trailingNewline: false })}\n\n${composedSection}`,
			written: { path: plan.path, updated: true },
		});
	});

	test('replaces a trailing section of a file that ends without a newline', async () => {
		const plan = setupPlanFile({ content: planEndingWithSection({ constraints: staleSection, trailingNewline: false }) });

		const written = await writePlanSection({ path: plan.path, heading, section: composedSection, after: anchor });

		// no heading follows the span and the file carried no final newline, so
		// neither a separator nor a newline is invented: adding either would make
		// the next sync of an unchanged plan report a change nobody made
		expect({ text: plan.readPlan(), written }).toStrictEqual({
			text: planEndingWithSection({ constraints: composedSection, trailingNewline: false }),
			written: { path: plan.path, updated: true },
		});
	});
});
