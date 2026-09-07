import type { Driver } from '#src/drivers/index.ts';

/** The heading the test-change reviewer's brief emits for its change bundle, and nothing else does. */
const bundleHeading = '# Changed test-side files';

/** One bundle entry's heading: the path it names and whether it was added, modified or removed. */
const entryHeading = /^## (\S+) \((added|modified|removed)\)$/gm;

/** A blanket approval of every file the bundle names, or undefined when the prompt is some other role's. */
const approveTestChanges = ({ prompt }: { prompt: string }) => {
	if (!prompt.includes(bundleHeading)) {
		return undefined;
	}

	const verdicts = [...prompt.matchAll(entryHeading)].map(([, path]) => ({
		path,
		decision: 'approve',
		reason: 'the plan asks for this change',
		acceptanceTests: [],
	}));

	return JSON.stringify({ verdicts });
};

interface Params {
	/** The stub's own `invoke` — asked only about prompts that are not a review. */
	invoke: Driver['invoke'];
}

/**
 * Wraps a driver stub's `invoke` so a test-change review is approved before the
 * stub itself is asked anything.
 *
 * Every pipeline fixture whose agents write or edit a test file now has that
 * change judged before the gates run, and a stub that answered the reviewer
 * with a work report would fail the checkpoint on the contract rather than on
 * the behaviour the fixture is about. A suite whose subject IS the review
 * answers it itself; every other one reaches for this.
 */
export const withTestChangeReview = ({ invoke }: Params): Driver['invoke'] => {
	return async (invocation) => {
		const review = approveTestChanges({ prompt: invocation.prompt });

		return review === undefined ? invoke(invocation) : { text: review, exitCode: 0 };
	};
};
