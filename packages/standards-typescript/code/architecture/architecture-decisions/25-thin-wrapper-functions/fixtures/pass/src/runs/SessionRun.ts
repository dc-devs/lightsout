import { SessionState } from '../common/services/SessionState';

/**
 * A run that HOLDS its shared state rather than extending it — the remedy the
 * composition-over-inheritance rule requires. The one-line methods below are the
 * seam that rule asks for: they keep this class's surface the only way in, so a
 * caller cannot reach past `recordStep`, which adds this run's timer.
 */
export class SessionRun {
	private readonly state: SessionState;
	private readonly startedAt = Date.now();

	constructor({ id }: { id: string }) {
		this.state = new SessionState({ id });
	}

	// forwards unchanged — delegation, not a thin wrapper
	note({ message }: { message: string }): void {
		this.state.note({ message });
	}

	// the sibling that adds something, and the reason `state` stays private
	recordStep({ name }: { name: string }): void {
		this.state.note({ message: `${name} at ${Date.now() - this.startedAt}ms` });
	}
}
