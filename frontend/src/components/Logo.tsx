export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--sapphire)" />
      <path d="M9 10h8.5a4.5 4.5 0 0 1 0 9H13v4H9z" fill="none" stroke="white" strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="22.5" cy="22.5" r="3" fill="var(--copper)" />
    </svg>
  );
}
