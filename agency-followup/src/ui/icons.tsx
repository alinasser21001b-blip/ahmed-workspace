// Small stroke icons (24px grid). Status icons always appear next to a text label.
import type { SVGProps } from "react";

const base = (d: React.ReactNode) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        {d}
      </svg>
    );
  };

export const IToday = base(<><path d="M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z" /><path d="M12 8v4l2.5 2.5" /></>);
export const ITasks = base(<><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5" /></>);
export const ICalendar = base(<><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
export const IBell = base(<><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>);
export const IUser = base(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>);
export const IShield = base(<><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6Z" /><path d="m9 12 2 2 4-4" /></>);
export const IPlus = base(<path d="M12 5v14M5 12h14" />);
export const ISearch = base(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>);
export const IClose = base(<path d="M6 6l12 12M18 6 6 18" />);
export const IBack = base(<path d="m9 6 6 6-6 6" />);
export const IAlert = base(<><path d="M12 4 2.8 19.5h18.4Z" /><path d="M12 10v4.5M12 17.2v.3" /></>);
export const IInfo = base(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.3" /></>);
export const ICheck = base(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IClock = base(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IPause = base(<><circle cx="12" cy="12" r="8.5" /><path d="M10 9v6M14 9v6" /></>);
export const ILink = base(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const ICamera = base(<><path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" /><circle cx="12" cy="13" r="3.5" /></>);
export const IFlag = base(<><path d="M6 21V4M6 4h11l-2 4 2 4H6" /></>);
export const IInbox = base(<><path d="M4 13h4l1.5 2.5h5L16 13h4" /><path d="M5.5 6h13L20 13v6H4v-6Z" /></>);
export const IRefresh = base(<><path d="M19 8a7.5 7.5 0 0 0-13.4 1.5M5 16a7.5 7.5 0 0 0 13.4-1.5" /><path d="M19 4v4h-4M5 20v-4h4" /></>);
export const IUp = base(<path d="m6 15 6-6 6 6" />);

// Status icons: shape differs per state, so the state never depends on colour alone.
export const SNew = base(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></>);
export const SAck = base(<><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>);
export const SProgress = base(<><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></>);
export const SReview = base(<><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.5" /></>);
export const SChanges = base(<><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>);
export const SDone = base(<><circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none" /><path d="m8 12.3 2.8 2.8L16.2 9.6" stroke="#fff" strokeWidth={2.2} /></>);
export const SCancelled = base(<><circle cx="12" cy="12" r="8" /><path d="M6.5 17.5 17.5 6.5" /></>);
