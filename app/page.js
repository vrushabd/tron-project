import dynamic from 'next/dynamic';

// Disable SSR for SendForm — it uses browser-only APIs (window, navigator, tronWeb)
const SendForm = dynamic(() => import('./SendForm'), { ssr: false });

export default function Page() {
  return <SendForm />;
}
