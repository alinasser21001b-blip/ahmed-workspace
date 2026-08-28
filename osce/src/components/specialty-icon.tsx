import type { SpecialtyId } from '@/domain/models';

export function SpecialtyIcon({ id }: { id: SpecialtyId }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: '0 0 32 32',
    fill: 'none',
    'aria-hidden': true as const,
  };

  switch (id) {
    case 'internal-medicine':
      return (
        <svg {...common}>
          <path d="M16 6v20M10 12h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'pediatrics':
      return (
        <svg {...common}>
          <circle cx="16" cy="11" r="4.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 26c1.4-6 14.6-6 16 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'surgery':
      return (
        <svg {...common}>
          <path d="M7 25l9-9 3 3-9 9H7v-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M18 13l6-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'minor-specialties':
      return (
        <svg {...common}>
          <circle cx="11" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="21" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="16" cy="21" r="3" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case 'obstetrics-gynecology':
      return (
        <svg {...common}>
          <circle cx="16" cy="11" r="5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16v10M12 22h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
  }
}
