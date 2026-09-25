import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import { summarizeWorkOrderName } from '#src/workOrder/common/utils/summarizeWorkOrderName.ts';

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** A tracker title of the sentence length Linear really holds — far longer than a folder label. */
const ticketTitle = "A ticket's branch name has no single author";

/**
 * What the mechanical cut makes of that title. Written out rather than computed
 * from the slugger, so the fallback is pinned as its own contract instead of
 * agreeing with whatever the slugger happens to do.
 */
const mechanicalSlug = 'a-ticket-s-branch-name-has-no-single';

interface SetupParams {
	/** Final messages the stub harness answers with, in order; the last is reused once they run out. */
	texts?: string[];
	/** A spawn that rejects, as a harness that is down or killed at its ceiling does. */
	error?: Error;
	/** The harness the config names, for the row that passes no driver of its own. */
	harness?: string;
}

/**
 * A config plus a stub harness that records every invocation it is handed, and
 * a progress collector. The driver seam is the whole reason this is testable:
 * a real summarise spends an agent call on the user's own subscription.
 */
const setupSummarizer = ({ texts = [], error, harness }: SetupParams = {}) => {
	const invocations: DriverInvocation[] = [];
	const progress: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			if (error) {
				throw error;
			}

			return { text: texts[Math.min(invocations.length - 1, texts.length - 1)] ?? '', exitCode: 0 };
		},
	};

	const config: LightsoutConfig = { gates, ...(harness === undefined ? {} : { harness }) };

	const onProgress = (message: string) => {
		progress.push(message);
	};

	return { config, driver, invocations, progress, onProgress };
};

describe('summarizeWorkOrderName', () => {
	test('summarizeWorkOrderName: a contract-satisfying answer supplies the words the label carries', async () => {
		const { config, driver, onProgress } = setupSummarizer({ texts: [JSON.stringify({ words: 'give-the-name-one' })] });

		const words = await summarizeWorkOrderName({ cwd: '/repo', ticketRef: 'LO-158', title: ticketTitle, config, driver, onProgress });

		// the model's words, not the mechanical cut of the title: a summary is the
		// whole reason the harness was spawned at all
		expect(words).toBe('give-the-name-one');
	});

	test('summarizeWorkOrderName: a driver that throws yields the mechanical slug of the title rather than stopping the caller', async () => {
		const { config, driver, progress, onProgress } = setupSummarizer({ error: new Error('harness timed out after 120000ms') });

		const words = await summarizeWorkOrderName({ cwd: '/repo', ticketRef: 'LO-158', title: ticketTitle, config, driver, onProgress });

		// a harness that is down must never stop a work order being created — the
		// name is a label, and a mechanically cut one beats no work order at all
		expect(words).toBe(mechanicalSlug);
		// and the caller is told the name was cut rather than summarised: exactly
		// one line names the words that were used, which the opening
		// 'summarising ...' line cannot satisfy
		expect(progress.filter((message) => message.includes(mechanicalSlug))).toHaveLength(1);
		expect(progress.at(-1)).toContain('harness timed out after 120000ms');
	});

	test('a config naming a harness this machine has no driver for falls back rather than throwing', async () => {
		const { config, progress, onProgress } = setupSummarizer({ harness: 'not-installed' });

		const words = await summarizeWorkOrderName({ cwd: '/repo', ticketRef: 'LO-158', title: ticketTitle, config, onProgress });

		// With no driver passed, the config names the harness — and a name no
		// registry holds is one more failure the label absorbs, because this
		// function answers a string and never an error arm.
		expect(words).toBe(mechanicalSlug);
		expect(progress.at(-1)).toContain('not-installed');
	});

	test('summarizeWorkOrderName: an answer the contract refuses on every rung falls back to the mechanical slug', async () => {
		const { config, driver, invocations, onProgress } = setupSummarizer({ texts: ['Sure — I think a good name would be "Give The Name One Author".'] });

		const words = await summarizeWorkOrderName({ cwd: '/repo', ticketRef: 'LO-158', title: ticketTitle, config, driver, onProgress });

		expect(words).toBe(mechanicalSlug);
		// the role rung and its one cheap re-emit both ran before the fallback, so
		// a chatty harness costs a retry rather than an immediate cut
		expect(invocations.length).toBe(2);
	});
});
