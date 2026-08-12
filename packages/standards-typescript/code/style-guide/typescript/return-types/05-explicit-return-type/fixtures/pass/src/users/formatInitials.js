// JavaScript, where a return type annotation is not syntax that exists. The
// rule has nothing to ask of this file — asking anyway produced blocking
// findings no agent or human could ever resolve.
export const formatInitials = ({ name }) =>
	name
		.split(' ')
		.map((part) => part[0])
		.join('');
