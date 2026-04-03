'use client';

import { UniversalProvider } from '@walletconnect/universal-provider';
import { WalletConnectModal } from '@walletconnect/modal';

// Only use env var — no hardcoded wrong fallback
const PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
const TRON_CHAIN = 'tron:0x2b6653dc';

// Detect Trust Wallet in-app browser (no tronLink, only tronWeb)
const isTrustWalletBrowser = () => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return (
        !!window.trustwallet ||
        ua.includes('Trust') ||
        (!!window.tronWeb && !window.tronLink) ||
        (!!window.tronWeb && window.tronWeb.isTrust)
    );
};

class WalletManager {
    constructor() {
        this.provider = null;
        this.modal = null;
        this.isMobile =
            typeof window !== 'undefined' &&
            /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    }

    async initWC() {
        if (this.provider) return;
        if (!PROJECT_ID) {
            throw new Error('WalletConnect Project ID is missing. Please set NEXT_PUBLIC_WC_PROJECT_ID.');
        }
        try {
            this.provider = await UniversalProvider.init({
                projectId: PROJECT_ID,
                metadata: {
                    name: 'Tron App',
                    description: 'TRON Wallet Connection',
                    url: typeof window !== 'undefined' ? window.location.origin : '',
                    icons: ['https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/tron/info/logo.png']
                }
            });
            this.modal = new WalletConnectModal({ projectId: PROJECT_ID, chains: [TRON_CHAIN] });
        } catch (e) {
            console.warn('[WM] initWC failed, clearing session:', e.message);
            localStorage.removeItem('walletconnect');
            localStorage.removeItem('WCMC_RECENT_WALLET');
            // Try one more time after clearing
            this.provider = await UniversalProvider.init({
                projectId: PROJECT_ID,
                metadata: {
                    name: 'Tron App',
                    description: 'TRON Wallet Connection',
                    url: typeof window !== 'undefined' ? window.location.origin : '',
                    icons: ['https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/tron/info/logo.png']
                }
            });
            this.modal = new WalletConnectModal({ projectId: PROJECT_ID, chains: [TRON_CHAIN] });
        }
    }

    async getInjected() {
        if (typeof window === 'undefined') return null;

        for (let i = 0; i < 20; i++) {
            // Trust Wallet: prefer window.tronWeb directly
            if (isTrustWalletBrowser() && window.tronWeb) {
                return { provider: window.tronWeb, type: 'trustwallet' };
            }
            if (window.tronLink) return { provider: window.tronLink, type: 'tronlink' };
            if (window.tronWeb) return { provider: window.tronWeb, type: 'injected' };
            await new Promise((r) => setTimeout(r, 100));
        }
        return null;
    }

    async connect() {
        const injected = await this.getInjected();

        // ---- INJECTED PATH ----
        if (injected) {
            const { provider, type } = injected;
            try {
                // Trust Wallet and some other mobile browsers throw "Unknown method" for tron_requestAccounts.
                // We attempt it but catch and ignore any "method not found" or "unknown method" errors.
                if (provider.request || provider.tron?.request) {
                    const req = provider.request || provider.tron.request;
                    await req({ method: 'tron_requestAccounts' });
                }
            } catch (e) {
                console.warn('[WM] requestAccounts failed, continuing anyway:', e?.message);
                // If it's a "method not found" error, we just continue as the address might already be available
                if (e?.message?.toLowerCase().includes('method') || e?.message?.toLowerCase().includes('not found')) {
                    // Ignore
                } else if (e?.message?.includes('reject') || e?.code === 4001) {
                    throw e; // Pass through user rejections
                }
            }

            if (type === 'trustwallet') await new Promise((r) => setTimeout(r, 400));

            const tronWeb = provider.tronWeb || (provider.defaultAddress ? provider : null);
            const address = tronWeb?.defaultAddress?.base58 || provider?.defaultAddress?.base58 || provider?.address;

            if (!address) {
                throw new Error('Wallet locked — please unlock your wallet and try again');
            }

            return {
                address,
                type: 'injected',
                sign: async (tx) => {
                    const txToSign = { ...tx };
                    const tw = tronWeb || provider;

                    if (tw?.trx?.sign) {
                        try {
                            const signed = await tw.trx.sign(txToSign);
                            if (signed?.signature) return signed;
                        } catch (e) {
                            if (e?.message?.includes('reject') || e?.code === 4001) throw e;
                        }
                    }

                    if (provider.request) {
                        try {
                            const signed = await provider.request({
                                method: 'tron_signTransaction',
                                params: [txToSign]
                            });
                            if (signed?.signature) return signed;
                        } catch (e) {
                            if (e?.message?.includes('reject') || e?.code === 4001) throw e;
                        }
                    }
                    throw new Error('Signing failed — please confirm the request in your wallet');
                }
            };
        }

        // ---- WALLETCONNECT PATH ----
        await this.initWC();

        // Nuclear Reset: Disconnect and clear existing sessions to prevent "stale session" errors
        try {
            if (this.provider.session) {
                console.log('[WM] Disconnecting existing session...');
                await this.provider.disconnect();
            }
        } catch (e) { }
        localStorage.removeItem('walletconnect');
        localStorage.removeItem('WCMC_RECENT_WALLET');

        return new Promise((resolve, reject) => {
            this.provider.on('display_uri', (uri) => {
                if (this.isMobile && !isTrustWalletBrowser()) {
                    window.location.href = `trust://wc?uri=${encodeURIComponent(uri)}`;
                } else {
                    this.modal.openModal({ uri });
                }
            });

            // Only include methods that wallets actually support via WalletConnect.
            // tron_requestAccounts is an injected-wallet-only method and must NOT 
            // be in requiredNamespaces — it causes "Unknown method(s) requested".
            const requiredNs = {
                tron: {
                    methods: ['tron_signTransaction'],
                    chains: [TRON_CHAIN],
                    events: []
                }
            };

            const optionalNs = {
                tron: {
                    methods: [
                        'tron_signTransaction',
                        'tron_signMessage'
                    ],
                    chains: [TRON_CHAIN],
                    events: ['accountsChanged', 'chainChanged']
                }
            };

            this.provider
                .connect({
                    requiredNamespaces: requiredNs,
                    optionalNamespaces: optionalNs
                })
                .then((session) => {
                    this.modal?.closeModal();
                    const account = session.namespaces.tron.accounts[0];
                    const address = account.split(':').pop();

                    resolve({
                        address,
                        type: 'walletconnect',
                        sign: async (tx) => {
                            try {
                                return await this.provider.request({
                                    chainId: TRON_CHAIN,
                                    method: 'tron_signTransaction',
                                    params: [{ address, transaction: tx }]
                                });
                            } catch (e) {
                                if (e?.message?.includes('reject') || e?.code === 5000) throw e;
                                throw e;
                            }
                        }
                    });
                })
                .catch((e) => {
                    console.error('[WM] Connect failed:', e);
                    localStorage.removeItem('walletconnect');
                    reject(new Error(`Connection failed: ${e.message || 'Check your internet or try another wallet'}`));
                });
        });
    }
}

export const walletManager = new WalletManager();