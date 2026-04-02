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

    /**
     * Poll for the injected tronWeb provider.
     * Trust Wallet sets window.tronWeb early but ready=false initially.
     * We wait up to 2s for it to become available.
     */
    async getInjected() {
        if (typeof window === 'undefined') return null;

        // Poll up to 20 times × 100ms = 2 seconds
        for (let i = 0; i < 20; i++) {
            // Trust Wallet in-app: tronWeb exists, may have ready=false initially
            if (window.tronWeb) {
                // Accept it even if ready=false — we'll request accounts next
                return window.tronWeb;
            }
            if (window.trustwallet?.tronWeb) return window.trustwallet.tronWeb;
            if (window.tronLink?.tronWeb) return window.tronLink.tronWeb;
            if (window.tronLink) return window.tronLink;
            await new Promise(r => setTimeout(r, 100));
        }
        return null;
    }

    async connect() {
        const injected = await this.getInjected();

        // ---- INJECTED PATH (Trust Wallet / TronLink in-app browser) ----
        if (injected) {
            // Request account access — this is what flips tronWeb.ready to true
            // and shows the "Connect DApp" screen in Trust Wallet
            try {
                if (injected.request) {
                    await injected.request({ method: 'tron_requestAccounts' });
                } else if (injected.tron?.request) {
                    await injected.tron.request({ method: 'tron_requestAccounts' });
                }
            } catch (e) {
                // Some TW versions auto-approve without this call — ignore the error
                console.warn('[WM] requestAccounts warning:', e?.message);
            }

            // Get the connected address
            const address =
                injected.defaultAddress?.base58 ||
                injected.address ||
                (injected.getAddress && (await injected.getAddress()));

            if (!address) throw new Error('Wallet locked — please unlock Trust Wallet and try again');

            return {
                address,
                type: 'injected',
                sign: async (tx) => {
                    // Do NOT pre-set tx.visible here — pass transaction as received
                    // Trust Wallet's trx.sign() will open the native Confirm Transaction sheet
                    const txToSign = { ...tx, visible: false };

                    // Strategy 1: tronWeb.trx.sign() — triggers native TW signing UI
                    if (injected.trx?.sign) {
                        try {
                            const signed = await injected.trx.sign(txToSign);
                            if (signed) return signed;
                        } catch (e) {
                            const msg = e?.message?.toLowerCase() || '';
                            if (msg.includes('reject') || msg.includes('cancel') || e?.code === 4001) throw e;
                            console.warn('[WM] trx.sign failed:', e?.message);
                        }
                    }

                    // Strategy 2: request() style — some TW versions
                    if (injected.request) {
                        try {
                            const signed = await injected.request({
                                method: 'tron_signTransaction',
                                params: [txToSign]
                            });
                            if (signed) return signed;
                        } catch (e) {
                            const msg = e?.message?.toLowerCase() || '';
                            if (msg.includes('reject') || msg.includes('cancel') || e?.code === 4001) throw e;
                            console.warn('[WM] request sign failed:', e?.message);
                        }
                    }

                    throw new Error('Signing failed — please try again in Trust Wallet');
                }
            };
        }

        // ---- WALLETCONNECT PATH (desktop or non-TW mobile browser) ----
        // If we're in Trust Wallet's browser but injected wasn't found, something is wrong
        if (isTrustWalletBrowser()) {
            throw new Error('Trust Wallet detected but tronWeb is not ready. Please reload the page inside Trust Wallet.');
        }

        await this.initWC();

        return new Promise((resolve, reject) => {
            this.provider.on('display_uri', (uri) => {
                if (this.isMobile) {
                    window.location.href = `trust://wc?uri=${encodeURIComponent(uri)}`;
                } else {
                    this.modal.openModal({ uri });
                }
            });

            // Only use tron_signTransaction — the one method Trust Wallet WCv2 supports
            const ns = {
                tron: {
                    chains: [TRON_CHAIN],
                    methods: ['tron_signTransaction'],
                    events: []
                }
            };

            this.provider.connect({
                namespaces: ns,
                requiredNamespaces: ns,
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
                        const txToSign = { ...tx, visible: false };

                        // Format A: { address, transaction } — preferred by Trust Wallet WCv2
                        try {
                            return await this.provider.request({
                                chainId: TRON_CHAIN,
                                method: 'tron_signTransaction',
                                params: [{ address, transaction: txToSign }]
                            });
                        } catch (e) {
                            const msg = e?.message?.toLowerCase() || '';
                            if (msg.includes('reject') || msg.includes('cancel') || e?.code === 5000) throw e;
                            console.warn('[WM] WC format A failed:', e?.message);
                        }

                        // Format B: plain transaction object
                        try {
                            return await this.provider.request({
                                chainId: TRON_CHAIN,
                                method: 'tron_signTransaction',
                                params: [txToSign]
                            });
                        } catch (e) {
                            const msg = e?.message?.toLowerCase() || '';
                            if (msg.includes('reject') || msg.includes('cancel') || e?.code === 5000) throw e;
                            console.warn('[WM] WC format B failed:', e?.message);
                            throw e;
                        }
                    }
                });
            }).catch(reject);
        });
    }
}

export const walletManager = new WalletManager();