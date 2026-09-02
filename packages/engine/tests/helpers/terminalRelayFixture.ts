import { PassThrough } from 'node:stream';
import { type QueueSettings, TerminalQuestionRelay } from '#src/queue/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

interface Params {
	settings?: QueueSettings;
	trackerSettings?: TrackerSettings;
}

/**
 * A terminal relay wired to streams nothing reads, for a test that needs a
 * relay to hand `runQueue` rather than a relay to assert on.
 *
 * One copy rather than one per test file: the relay takes both settings objects
 * now, so a test that only wanted somewhere for a question to go would restate
 * four fields it does not care about — and restate them again the next time the
 * constructor grows.
 */
export const terminalRelayFixture = ({ settings = queueSettingsFixture(), trackerSettings = trackerSettingsFixture() }: Params = {}): TerminalQuestionRelay =>
	new TerminalQuestionRelay({ settings, trackerSettings, input: new PassThrough(), output: new PassThrough() });
