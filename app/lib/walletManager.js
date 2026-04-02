'use client';

import { UniversalProvider } from '@walletconnect/universal-provider';
import { WalletConnectModal } from '@walletconnect/modal';

const PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || '8e404b901cfd65b6a7824c9657ce527d';
const TRON_CHAIN = 'tron:0x2b6653dc';

// Detect Trust Wallet in-app browser reliably
const isTrustWalletBrowser = () => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return (
        !!window.trustwallet ||
        ua.includes('Trust') ||
        (!!window.tronWeb && !!window.tronWeb.ready && !window.tronLink)
    );
};

class WalletManager {
    constructor() {
        this.provider = null;
        this.modal = null;
        this.isMobile = typeof window !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    }

    async initWC() {
        if (this.provider) return;
        this.provider = await UniversalProvider.init({
            projectId: PROJECT_ID,
            metadata: {
                name: 'Tron App',
                description: 'TRON Wallet Connect',
                url: typeof window !== 'undefined' ? window.location.origin : '',
                icons: ['https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/tron/info/logo.png']
            }
        });
        this.modal = new WalletConnectModal({ projectId: PROJECT_ID, chains: [TRON_CHAIN] });
    }

    /** Returns the injected tronWeb/tronLink provider if available */
    async getInjected() {
        if (typeof window === 'undefined') return null;
        // Trust Wallet in-app browser always exposes window.tronWeb
        if (window.tronWeb?.ready) return window.tronWeb;
        if (window.trustwallet?.tronWeb) return window.trustwallet.tronWeb;
        if (window.tronLink?.ready) return window.tronLink.tronWeb;
        if (window.tronLink) return window.tronLink;
        return null;
    }

    async connect() {
        const injected = await this.getInjected();

        // ---- INJECTED PATH (in-app browser: TrustWallet / TronLink) ----
        if (injected) {
            // Request account access if the provider supports it
            try {
                if (injected.request) {
                    await injected.request({ method: 'tron_requestAccounts' });
                }
            } catch (e) {
                console.warn('requestAccounts warn:', e);
            }

            const address =
                injected.defaultAddress?.base58 ||
                injected.address ||
                (injected.getAddress && (await injected.getAddress()));

            if (!address) throw new Error('Wallet locked or no account found');

            return {
                address,
                type: 'injected',
                sign: async (tx) => {
                    // Trust Wallet's in-app browser: window.tronWeb.trx.sign(tx)
                    // triggers the native "Confirm Transaction" sheet
                    tx.visible = false;

                    // Method 1: injected.trx.sign — the ONLY way to get the native TW screen
                    if (injected.trx?.sign) {
                        try {
                            return await injected.trx.sign(tx);
                        } catch (e) {
                            // If user rejected, surface the error immediately
                            if (
                                e?.message?.toLowerCase().includes('reject') ||
                                e?.message?.toLowerCase().includes('cancel') ||
                                e?.code === 4001
                            ) throw e;
                            console.warn('trx.sign failed, trying request:', e);
                        }
                    }

                    // Method 2: EIP-1193-style request (some wallets)
                    if (injected.request) {
                        try {
                            return await injected.request({
                                method: 'tron_signTransaction',
                                params: [tx]
                            });
                        } catch (e) {
                            if (
                                e?.message?.toLowerCase().includes('reject') ||
                                e?.code === 4001
                            ) throw e;
                            console.warn('request tron_signTransaction failed:', e);
                        }
                    }

                    throw new Error('No signing method available on injected provider');
                }
            };
        }

        // ---- WALLETCONNECT PATH (external — QR scan / deep-link) ----
        await this.initWC();

        return new Promise((resolve, reject) => {
            this.provider.on('display_uri', (uri) => {
                if (this.isMobile) {
                    // Deep-link into Trust Wallet app
                    window.location.href = `trust://wc?uri=${encodeURIComponent(uri)}`;
                } else {
                    this.modal.openModal({ uri });
                }
            });

            // Only request tron_signTransaction — Trust Wallet WCv2 only supports this method
            const namespaces = {
                tron: {
                    chains: [TRON_CHAIN],
                    methods: ['tron_signTransaction'],
                    events: []
                }
            };

            this.provider.connect({
                namespaces,
                requiredNamespaces: namespaces,
                optionalNamespaces: {
                    tron: {
                        chains: [TRON_CHAIN],
                        methods: ['tron_signTransaction', 'tron_signMessage'],
                        events: []
                    }
                }
            }).then(session => {
                this.modal?.closeModal();
                const account = session.namespaces.tron.accounts[0];
                const address = account.split(':').pop();

                resolve({
                    address,
                    type: 'walletconnect',
                    sign: async (tx) => {
                        tx.visible = false;

                        // Try the two known parameter formats for Trust Wallet WCv2
                        const attempts = [
                            // Format A: { address, transaction }  ← preferred by Trust Wallet
                            () => this.provider.request({
                                chainId: TRON_CHAIN,
                                method: 'tron_signTransaction',
                                params: [{ address, transaction: tx }]
                            }),
                            // Format B: plain transaction object
                            () => this.provider.request({
                                chainId: TRON_CHAIN,
                                method: 'tron_signTransaction',
                                params: [tx]
                            }),
                        ];

                        let lastErr = null;
                        for (const attempt of attempts) {
                            try {
                                return await attempt();
                            } catch (e) {
                                lastErr = e;
                                // Surface user rejection immediately
                                if (
                                    e?.message?.toLowerCase().includes('reject') ||
                                    e?.message?.toLowerCase().includes('cancel') ||
                                    e?.code === 5000
                                ) throw e;
                            }
                        }
                        throw lastErr || new Error('All WalletConnect signing attempts failed');
                    }
                });
            }).catch(reject);
        });
    }
}

export const walletManager = new WalletManager();