import { describe, expect, test } from '@jest/globals';
import { renderPullRequestBody } from '#src/ship/renderPullRequestBody.ts';

describe('renderPullRequestBody', () => {
	test('substitutes every brace-wrapped token the caller supplied', () => {
		const body = renderPullRequestBody({ template: 'Closes LO-{number} from {branch}', tokens: { number: '60', branch: 'lo-60-ship' } });

		expect(body).toBe('Closes LO-60 from lo-60-ship');
	});

	test('leaves a token nothing supplied exactly as written, so a config mistake is visible in the pull request', () => {
		const body = renderPullRequestBody({ template: 'Closes LO-{number}', tokens: { ticket: 'lo-60' } });

		expect(body).toBe('Closes LO-{number}');
	});

	test('a template with no tokens at all comes back unchanged', () => {
		const body = renderPullRequestBody({ template: 'Ready for review.', tokens: { ticket: 'lo-60' } });

		expect(body).toBe('Ready for review.');
	});

	test('a substituted value carrying braces is never re-scanned, because the pass over the template is a single one', () => {
		const body = renderPullRequestBody({ template: '{ticket}', tokens: { ticket: '{number}', number: '60' } });

		expect(body).toBe('{number}');
	});
});
