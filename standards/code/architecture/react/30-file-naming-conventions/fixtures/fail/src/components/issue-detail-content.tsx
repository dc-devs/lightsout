interface Props {
	title: string;
}

// A component file in kebab-case with no framework mandating it — the name has
// to carry the export's own PascalCase.
export const IssueDetailContent = ({ title }: Props) => <h1>{title}</h1>;
