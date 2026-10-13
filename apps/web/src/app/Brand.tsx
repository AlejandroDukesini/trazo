/** Marca de Trazo: un trazado que sube y termina en un punto de llegada. */
export function BrandMark({ className = 'brand__mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <rect width="48" height="48" rx="14" fill="#11151b" />
      <path d="M11.5 34.5c4.5-.4 7-3.6 9.3-8.2 2.6-5.1 5.6-10.3 13.7-11.6" fill="none" stroke="#2fe0c2" strokeWidth="4.6" strokeLinecap="round" />
      <circle cx="11.5" cy="34.5" r="3.2" fill="#11151b" stroke="#2fe0c2" strokeWidth="2.4" />
      <circle cx="35.5" cy="14.5" r="4.6" fill="#2fe0c2" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <BrandMark />
      Trazo
    </span>
  );
}
