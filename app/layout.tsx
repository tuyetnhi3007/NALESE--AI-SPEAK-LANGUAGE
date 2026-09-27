import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ),
  title: 'NALESE — AI Language Learning Tutor',
  description:
    'A voice-based AI language tutor powered by GPT-4o. Learn English, Chinese (Mandarin), and Japanese through real-time voice conversations, vocabulary exercises, and immersive topic roleplays.',
  keywords: ['language learning', 'AI tutor', 'voice learning', 'Chinese', 'Japanese', 'English', 'GPT-4o'],
  authors: [{ name: 'NALESE' }],
  icons: {
    icon: [
      { url: '/favicon.ico?v=2', sizes: 'any' },
      { url: '/icon.png?v=2', type: 'image/png', sizes: '512x512' },
    ],
    shortcut: '/favicon.ico?v=2',
    apple: [
      { url: '/apple-icon.png?v=2', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'NALESE — AI Language Learning Tutor',
    description: 'Real-time voice AI tutor for English, Chinese, and Japanese learners.',
    type: 'website',
    images: [{ url: '/icon.png?v=2', width: 512, height: 512, alt: 'NALESE Logo' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="theme-color" content="#08080f" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="icon" href="/favicon.ico?v=2" sizes="any" />
        <link rel="icon" href="/icon.png?v=2" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-icon.png?v=2" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
