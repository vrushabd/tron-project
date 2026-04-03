'use client';

import { WalletProvider } from '@tronweb3/tronwallet-adapter-react-hooks';
import { WalletModalProvider } from '@tronweb3/tronwallet-adapter-react-ui';
import { TronLinkAdapter, TrustAdapter } from '@tronweb3/tronwallet-adapters';
import { useMemo } from 'react';

export default function WalletProviders({ children }) {
    const adapters = useMemo(() => [new TronLinkAdapter(), new TrustAdapter()], []);

    return (
        <WalletProvider adapters={adapters} autoConnect={false}>
            <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
    );
}
