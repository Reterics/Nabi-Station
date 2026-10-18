const paths = {
  city: 'M3 21V9h6v12M9 21V3h6v18M15 21V12h6v9M6 12h0M6 16h0M12 7h0M12 11h0M12 15h0M18 16h0M2 21h20',
  assets: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  focus: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8',
  pause: 'M8 5v14M16 5v14',
  play: 'm8 5 11 7-11 7V5Z',
  terminal: 'm4 6 6 6-6 6m9 0h7',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
} as const;

export function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
