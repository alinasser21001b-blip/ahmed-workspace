import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OSCE — Clinical Examination Simulator',
  description: 'Practice examiner-associated clinical OSCE cases and questions.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
