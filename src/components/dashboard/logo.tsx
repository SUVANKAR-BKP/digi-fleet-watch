export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      {/* stacked server racks */}
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="5.5" y="5.5" width="15" height="6" rx="1.75" />
        <rect x="5.5" y="13.5" width="15" height="6" rx="1.75" />
        <rect x="5.5" y="21.5" width="15" height="5.5" rx="1.75" />
      </g>
      {/* rack status LEDs */}
      <circle cx="9" cy="8.5" r="1.05" fill="hsl(var(--ok))" />
      <circle cx="9" cy="16.5" r="1.05" fill="hsl(var(--warn))" />
      <circle cx="9" cy="24.2" r="1.05" fill="hsl(var(--down))" />
      {/* radar ring + probe */}
      <circle
        cx="23.5"
        cy="15.5"
        r="8.5"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.75"
      />
      <circle cx="23.5" cy="15.5" r="3.2" fill="currentColor" opacity="0.9" />
    </svg>
  );
}