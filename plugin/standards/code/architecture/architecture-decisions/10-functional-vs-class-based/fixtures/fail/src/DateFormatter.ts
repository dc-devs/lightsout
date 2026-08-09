// A module wearing a costume: no state, no injected dependencies, no interface
// to implement — every call site pays a `DateFormatter.` prefix for nothing.
export class DateFormatter {
	static formatDate({ date }: { date: Date }): string {
		return date.toISOString().slice(0, 10);
	}

	static formatTime({ date }: { date: Date }): string {
		return date.toISOString().slice(11, 19);
	}
}
