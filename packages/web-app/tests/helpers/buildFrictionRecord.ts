import type { FrictionRecord } from '@lightsout/engine';
import { FrictionArea } from '@lightsout/engine/contracts';

interface Params {
	area?: FrictionArea;
	/** Left out entirely by default, which is what an agent that named no kind writes — the log reads that as friction. */
	kind?: FrictionRecord['kind'];
	detail?: string;
	at?: string;
	runId?: string;
	step?: string;
}

/** One line of `.lightsout/friction.jsonl`, as an agent's report lands in it, with only what a test cares about overridden. */
export const buildFrictionRecord = ({
	area = FrictionArea.Plan,
	kind,
	detail = 'the plan named a file that is not on disk',
	at = '2026-01-01T00:00:00.000Z',
	runId = 'abcdef0123456789',
	step = 'implement',
}: Params = {}): FrictionRecord => ({ area, kind, detail, at, runId, step });
