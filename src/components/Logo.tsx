// DOTRA brand mark — five-dot quincunx with a green centre dot.
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0a0a0a" />
      <g fill="#fafaf9">
        <circle cx="20" cy="20" r="6.4" />
        <circle cx="44" cy="20" r="6.4" />
        <circle cx="20" cy="44" r="6.4" />
        <circle cx="44" cy="44" r="6.4" />
      </g>
      <circle cx="32" cy="32" r="8.6" fill="#16a34a" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="font-display font-bold tracking-tight text-[22px] leading-none text-ink">
        DOTRA
      </span>
    </span>
  );
}
