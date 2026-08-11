interface Props {
	status: 'notInstalled' | 'connected';
}

// The same values decide domain behaviour elsewhere in the app, so they are
// domain values wearing the props exemption — they belong in a `const` object.
export const InstallPanel = ({ status }: Props) => <p>{status === 'connected' ? 'Connected' : 'Not installed'}</p>;
