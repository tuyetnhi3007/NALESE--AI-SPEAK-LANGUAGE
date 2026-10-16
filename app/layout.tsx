import type { Metadata } from 'next';
import { Be_Vietnam_Pro, Noto_Sans_JP, Noto_Sans_SC } from 'next/font/google';
import './globals.css';

const beVietnamPro = Be_Vietnam_Pro({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin', 'vietnamese'],
  display: 'swap',
  variable: '--font-sans',
});

const notoSansJP = Noto_Sans_JP({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jp',
});

const notoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sc',
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ),
  title: 'NALESE — AI Language Learning Tutor',
  description:
    'A voice-based AI language tutor powered by Gemini & GPT-4o. Learn English, Chinese (Mandarin), and Japanese through real-time voice conversations.',
  keywords: ['language learning', 'AI tutor', 'voice learning', 'Chinese', 'Japanese', 'English'],
  authors: [{ name: 'NALESE' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="theme-color" content="#FCF3EA" />
      </head>
      <body className={`${beVietnamPro.variable} ${notoSansJP.variable} ${notoSansSC.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
