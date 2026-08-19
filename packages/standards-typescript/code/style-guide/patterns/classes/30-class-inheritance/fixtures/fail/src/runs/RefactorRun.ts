class RunState {
	protected steps: string[] = [];

	record({ step }: { step: string }): void {
		this.steps.push(step);
	}
}

export class RefactorRun extends RunState {
	decline({ step }: { step: string }): void {
		this.record({ step: `declined:${step}` });
	}
}
