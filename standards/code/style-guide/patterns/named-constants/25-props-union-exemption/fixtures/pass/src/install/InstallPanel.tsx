interface Props {
	tone: 'quiet' | 'loud';
}

// The values exist only as this component's prop vocabulary — written once as a
// JSX attribute and narrowed nowhere else.
export const InstallPanel = ({ tone }: Props) => <p className={tone}>Install</p>;
