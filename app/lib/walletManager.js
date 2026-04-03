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
        (!!window.tronWeb && !window.tronLink)
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
            throw new Error(
                'WalletConnect Project ID is not configured. Check NEXT_PUBLIC_WC_PROJECT_ID env var.'
            );
        }
        this.provider = await UniversalProvider.init({
            projectId: PROJECT_ID,
            metadata: {
                name: 'Tron App',
                description: 'TRON Wallet Connect',
                url: typeof window !== 'undefined' ? window.location.origin : '',
                icons: [
                    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/tron/info/logo.png'
                ]
            }
        });
        this.modal = new WalletConnectModal({ projectId: PROJECT_ID, chains: [TRON_CHAIN] });
    }

    /**
     * Detect injected wallet provider.
     * Returns { provider, type } or null.
     * Types: 'trustwallet' | 'tronlink' | 'injected'
     */
    async getInjected() {
        if (typeof window === 'undefined') return null;

        for (let i = 0; i < 20; i++) {
            // Trust Wallet in-app: has tronWeb directly, no tronLink
            if (isTrustWalletBrowser() && window.tronWeb) {
                return { provider: window.tronWeb, type: 'trustwallet' };
            }
            // TronLink extension: prefer tronLink (has .request())
            if (window.tronLink) {
                return { provider: window.tronLink, type: 'tronlink' };
            }
            // Other injected provider
            if (window.tronWeb) {
                return { provider: window.tronWeb, type: 'injected' };
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        return null;
    }

    async connect() {
        const injected = await this.getInjected();

        // ---- INJECTED PATH ----
        if (injected) {
            const { provider, type } = injected;

            // Only call tron_requestAccounts for TronLink (which has .request())
            // Trust Wallet injected tronWeb does NOT support this method
            if (type === 'tronlink' && provider.request) {
                try {
                    await provider.request({ method: 'tron_requestAccounts' });
                } catch (e) {
                    // May throw if already connected — safe to ignore
                    console.warn('[WM] tron_requestAccounts:', e?.message);
                }
            }

            // Trust Wallet: give tronWeb a moment to become ready
            if (type === 'trustwallet') {
                await new Promise((r) => setTimeout(r, 300));
            }

            // Resolve the actual TronWeb instance for address + signing
            // TronLink wraps tronWeb inside; Trust Wallet IS tronWeb
            const tronWeb =
                provider.tronWeb ||
                (provider.defaultAddress ? provider : null);

            const address =
                tronWeb?.defaultAddress?.base58 ||
                provider?.defaultAddress?.base58 ||
                provider?.address;

            if (!address) {
                throw new Error(
                    'Wallet locked — please unlock your wallet and try again'
                );
            }

            return {
                address,
                type: 'injected',
                sign: async (tx) => {
                    // Do not modify visible — server already sets it correctly
                    const txToSign = { ...tx };
                    const tw = tronWeb || provider;

                    // Strategy 1: tronWeb.trx.sign() — triggers native wallet signing UI
                    if (tw?.trx?.sign) {
                        try {
                            const signed = await tw.trx.sign(txToSign);
                            if (signed?.signature) return signed;
                        } catch (e) {
                            const msg = e?.message?.toLowerCase() || '';
                            if (
                                msg.includes('reject') ||
                                msg.includes('cancel') ||
                                e?.code === 4001
                            )
                                throw e;
                            console.warn('[WM] trx.sign failed:', e?.message);
                        }
                    }

                    // Strategy 2: EIP-1193 style request (TronLink extension)
                    if (provider.request) {
                        try {
                            const signed = await provider.request({
                                method: 'tron_signTransaction',
                                params: [txToSign]
                            });
                            if (signed?.signature) return signed;
                        } catch (e) {
                            const msg = e?.message?.toLowerCase() || '';
                            if (
                                msg.includes('reject') ||
                                msg.includes('cancel') ||
                                e?.code === 4001
                            )
                                throw e;
                            console.warn('[WM] request sign failed:', e?.message);
                        }
                    }

                    throw new Error('Signing failed — please try again in your wallet');
                }
            };
        }

        // ---- WALLETCONNECT PATH (fallback — QR scan / deep-link) ----
        await this.initWC();

        return new Promise((resolve, reject) => {
            this.provider.on('display_uri', (uri) => {
                // Don't deep-link if already inside Trust Wallet browser —
                // they'd have taken the injected path above
                if (this.isMobile && !isTrustWalletBrowser()) {
                    window.location.href = `trust://wc?uri=${encodeURIComponent(uri)}`;
                } else {
                    this.modal.openModal({ uri });
                }
            });

            // FIX: Remove 'namespaces:' — illegal in provider.connect().
            // It caused "Unknown method(s) requested" WC2 relay error.
            // Only send requiredNamespaces. Keep minimal to maximise wallet compatibility.
            this.provider
                .connect({
                    requiredNamespaces: {
                        tron: {
                            chains: [TRON_CHAIN],
                            methods: ['tron_signTransaction'],
                            events: []
                        }
                    }
                })
                .then((session) => {
                    this.modal?.closeModal();
                    const account = session.namespaces.tron.accounts[0];
                    const address = account.split(':').pop();

                    resolve({
                        address,
                        type: 'walletconnect',
                        sign: async (tx) => {
                            // Format: { address, transaction } — Trust Wallet WCv2 standard
                            try {
                                return await this.provider.request({
                                    chainId: TRON_CHAIN,
                                    method: 'tron_signTransaction',
                                    params: [{ address, transaction: tx }]
                                });
                            } catch (e) {
                                const msg = e?.message?.toLowerCase() || '';
                                if (
                                    msg.includes('reject') ||
                                    msg.includes('cancel') ||
                                    e?.code === 5000
                                )
                                    throw e;
                                console.warn('[WM] WC sign failed:', e?.message);
                                throw e;
                            }
                        }
                    });
                })
                .catch(reject);
        });
    }
}

export const walletManager = new WalletManager();