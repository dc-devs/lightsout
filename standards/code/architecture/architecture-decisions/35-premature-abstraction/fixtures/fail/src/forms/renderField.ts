interface Params {
	kind: 'email' | 'phone' | 'address' | 'date';
	label: string;
	value: string;
	required?: boolean;
	hint?: string;
}

// Four shapes and five options, built for one caller. The right abstraction
// shows up after two or three concrete uses; guessed early, it is a shape every
// later use has to be bent to fit.
export const renderField = ({ kind, label, value, required = false, hint }: Params): string => {
	const mark = required ? '*' : '';
	const suffix = hint === undefined ? '' : ` (${hint})`;

	return `<label data-kind="${kind}">${label}${mark}: ${value}${suffix}</label>`;
};
