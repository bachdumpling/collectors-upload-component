import { Suspense, lazy, useSyncExternalStore } from 'react';
import UploadZone from '@/components/UploadZone';

// The bench pulls in three.js; keep it out of the chunk the upload zone ships in.
const Test = lazy(() => import('@/pages/Test'));

/** Two pages, no router. Not worth a dependency for a bench page. */
const subscribe = (fn: () => void) => {
  window.addEventListener('popstate', fn);
  return () => window.removeEventListener('popstate', fn);
};

export default function App() {
  const path = useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => '/'
  );

  if (path.startsWith('/test'))
    return (
      <Suspense fallback={null}>
        <Test />
      </Suspense>
    );

  return (
    <>
      <main className="flex min-h-dvh flex-col items-center justify-center px-5 pb-28 pt-16">
        <UploadZone />
      </main>

      {/* The middle column takes its content width and the outer two split what is
          left equally -- so the label still centres on the viewport, but it is never
          squeezed into a third of it and forced to wrap. */}
      <footer className="fixed inset-x-0 bottom-0 grid grid-cols-[1fr_auto_1fr] items-center px-6 pb-7 text-[12px] font-medium tracking-[-0.01em] sm:px-10 sm:text-[15px]">
        <span className="justify-self-start">Collectors</span>
        <span className="justify-self-center whitespace-nowrap">Design Engineer Challenge</span>
        <a
          href="https://www.bachle.info"
          target="_blank"
          rel="noreferrer"
          className="justify-self-end rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          Bach Le
        </a>
      </footer>
    </>
  );
}
