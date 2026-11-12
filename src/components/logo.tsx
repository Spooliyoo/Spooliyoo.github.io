/** Spooliyoo app mark: dark rounded tile with a spool seen side-on (white flanges, blue top layer). */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden focusable="false">
      <rect width="200" height="200" rx="44" fill="#0E1116" />
      <g transform="translate(24 24) scale(0.95)">
        <rect x="10" y="10" width="18" height="140" rx="9" fill="#FFFFFF" />
        <rect x="132" y="10" width="18" height="140" rx="9" fill="#FFFFFF" />
        <rect x="38" y="23" width="64" height="14" rx="7" fill="#1F6BFF" />
        <rect x="38" y="47" width="84" height="14" rx="7" fill="#FFFFFF" />
        <rect x="38" y="71" width="84" height="14" rx="7" fill="#FFFFFF" />
        <rect x="38" y="95" width="84" height="14" rx="7" fill="#FFFFFF" />
        <rect x="38" y="119" width="84" height="14" rx="7" fill="#FFFFFF" />
      </g>
    </svg>
  );
}
