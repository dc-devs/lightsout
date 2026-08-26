// The composition remedy: this class holds the shared RunState and forwards
// to it. Its twin holds the same collaborator — shared shape by design.
export class RefactorRun {
	private readonly runState: RunState;

	constructor({ runState }: { runState: RunState }) {
		this.runState = runState;
	}

	update({ patch, reason, actor, timestamp }: { patch: object; reason: string; actor: string; timestamp: number }): Promise<void> {
		return this.runState.update({ patch, reason, actor, timestamp });
	}

	setStep({ step, index, total, label }: { step: string; index: number; total: number; label: string }): Promise<void> {
		return this.runState.setStep({ step, index, total, label });
	}
}
