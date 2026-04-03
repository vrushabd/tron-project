import './globals.css';
import WalletProviders from './WalletProviders';

export const metadata = {
  title: 'Tron USDT Claim',
  description: 'Tron USDT Claim',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="trustwallet-network" content="tron" />
      </head>
      <body>
        <WalletProviders>{children}</WalletProviders>
      </body>
    </html>
  );
}
