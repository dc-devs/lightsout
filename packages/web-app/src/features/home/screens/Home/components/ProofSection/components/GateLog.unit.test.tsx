import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { GateLog } from '#src/features/home/screens/Home/components/ProofSection/components/GateLog.tsx';

/** How long each frame of the log holds, matching the card's own pace. */
const stepMs = 450;

const setupGateLog = ({ prefersReduced = false }: { prefersReduced?: boolean } = {}) => {
	jest.useFakeTimers();

	if (prefersReduced) {
		Object.assign(globalThis, { matchMedia: () => ({ matches: true }) });
	}

	render(<GateLog />);

	return {
		advance: ({ frames }: { frames: number }) => act(() => jest.advanceTimersByTime(frames * stepMs)),
		readShownRows: () => screen.getAllByRole('listitem', { hidden: true }).filter((row) => row.getAttribute('aria-hidden') !== 'true'),
		readGateStates: () => [...document.querySelectorAll('[data-state]')].map((chip) => `${chip.textContent?.split(' ')[0]}:${chip.getAttribute('data-state')}`),
	};
};

afterEach(() => {
	jest.useRealTimers();
	Reflect.deleteProperty(globalThis, 'matchMedia');
});

describe('GateLog', () => {
	test('names the ticket the run is working', () => {
		setupGateLog();

		expect([screen.getByText('LO-155'), screen.getByText('Implement module dependency graph')]).toHaveLength(2);
	});

	test('opens on the first step alone, its gates still running', () => {
		const { readShownRows, readGateStates } = setupGateLog();

		expect({ rows: readShownRows().length, firstGates: readGateStates().slice(0, 3), status: screen.getByText('Running').textContent }).toStrictEqual({
			rows: 1,
			firstGates: ['lint:running', 'types:running', 'tests:running'],
			status: 'Running',
		});
	});

	test('brings the gates back one at a time', () => {
		const { advance, readGateStates } = setupGateLog();

		advance({ frames: 1 });

		expect(readGateStates().slice(0, 3)).toStrictEqual(['lint:passed', 'types:running', 'tests:running']);
	});

	test('shows a gate overruling the agent: the claim, the failing gate, and the step sent back round', () => {
		setupGateLog({ prefersReduced: true });

		const [first, retry] = screen.getAllByRole('listitem').map((row) => row.textContent);

		expect({ first, retry }).toStrictEqual({
			first: 'implement“Done.”lint passedtypes passedtests failedSent back · 2 tests failed',
			retry: 'implementretry“Fixed.”lint passedtypes passedtests passed',
		});
	});

	test('ends passed, with every row shown, for a reader who asked for less motion', () => {
		const { readShownRows } = setupGateLog({ prefersReduced: true });

		expect({ rows: readShownRows().length, status: screen.getByText('Passed').textContent }).toStrictEqual({ rows: 4, status: 'Passed' });
	});

	test('sums the run up under the log', () => {
		setupGateLog();

		expect(screen.getByText('1 failure caught · 67 gate runs · 18m 25s · $6.61')).toBeInTheDocument();
	});
});
