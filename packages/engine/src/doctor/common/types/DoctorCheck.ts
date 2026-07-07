export interface DoctorCheck {
	id: string;
	/** `note` = worth seeing, not worth fixing — a legitimate state that would also be the symptom of a mistake (e.g. intentional gate skips vs a typo'd script name). */
	status: 'pass' | 'note' | 'warn' | 'fail';
	detail: string;
	/** The exact change that clears a warn/fail — the doctor never applies it. */
	fix?: string;
}
