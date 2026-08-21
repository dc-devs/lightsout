/** What every kind of run owns, held by each run rather than inherited. */
export class SessionState {
	private readonly id: string;
	private readonly notes: string[] = [];

	constructor({ id }: { id: string }) {
		this.id = id;
	}

	note({ message }: { message: string }): void {
		this.notes.push(`${this.id}: ${message}`);
	}
}
