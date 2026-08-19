interface RunRecorder {
	record: (params: { step: string }) => void;
}

const createRunRecorder = (): RunRecorder => {
	const steps: string[] = [];

	return { record: ({ step }) => steps.push(step) };
};

// The shared part is held as a value and delegated to — visible at the seam.
export class RefactorRun implements RunRecorder {
	private readonly recorder = createRunRecorder();

	record({ step }: { step: string }): void {
		this.recorder.record({ step });
	}

	decline({ step }: { step: string }): void {
		this.recorder.record({ step: `declined:${step}` });
	}
}
