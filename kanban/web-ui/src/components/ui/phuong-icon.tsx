export function PhuongIcon({
	size = 20,
	className,
}: {
	size?: number;
	className?: string;
}): React.ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="8.25" />
			<path d="M12 7.5v9" />
			<path d="M9.25 10.25c.9-1.1 2.1-1.65 2.75-1.65.95 0 1.7.55 1.7 1.45 0 1.9-3.7 1.55-3.7 3.85" />
			<path d="M10.5 16.5h3" />
		</svg>
	);
}
