import { Suspense } from 'react';
import { ConfigureScreen } from '@/components/configure-screen';

export default function Page() {
  return (
    <Suspense>
      <ConfigureScreen />
    </Suspense>
  );
}
