import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page">
      <h1>OSCE</h1>
      <p>This station does not exist.</p>
      <Link href="/">Return</Link>
    </main>
  );
}
