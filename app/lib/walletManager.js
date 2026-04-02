'use client';

import { UniversalProvider } from '@walletconnect/universal-provider';
import { WalletConnectModal } from '@walletconnect/modal';

const PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
const TRON_CHAIN = 'tron:0x2b6653dc';

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

        this.modal = new WalletConnectModal({
            projectId: PROJECT_ID,
            chains: [TRON_CHAIN]
        });
    }

    async getInjected() {
        if (typeof window === 'undefined') return null;
        if (window.tronWeb?.ready) return window.tronWeb;
        if (window.trustwallet?.tron) return window.trustwallet.tron;
        if (window.tronLink) return window.tronLink;
        return null;
    }

    async connect() {

        // ── 1. Try injected wallet first ──────────────────────────────────────
        const injected = await this.getInjected();

        if (injected) {
            try {
                if (injected.request) {
                    await injected.request({ method: 'tron_requestAccounts' });
                }
            } catch (e) {
                console.warn('tron_requestAccounts error:', e);
            }

            const address = injected.defaultAddress?.base58;
            if (!address) throw new Error('Wallet locked or no account found');

            return {
                address,
                type: 'injected',
                sign: async (tx) => {
                    if (injected.trx?.sign) return await injected.trx.sign(tx);
                    if (injected.signTransaction) return await injected.signTransaction(tx);
                    throw new Error('Injected wallet cannot sign');
                }
            };
        }

        // ── 2. WalletConnect ──────────────────────────────────────────────────
        await this.initWC();

        return new Promise((resolve, reject) => {

            this.provider.on('display_uri', (uri) => {
                if (this.isMobile) {
                    // ✅ FIX 3: Use trust:// deep link scheme (more reliable than https link)
                    window.location.href = `trust://wc?uri=${encodeURIComponent(uri)}`;
                } else {
                    this.modal.openModal({ uri });
                }
            });

            const namespaces = {
                tron: {
                    chains: [TRON_CHAIN],
                    methods: ['tron_signTransaction', 'tron_signMessage'],
                    events: []
                }
            };

            this.provider.connect({
                namespaces,
                requiredNamespaces: namespaces, // Use both for maximum compatibility
                optionalNamespaces: namespaces
            })
                .then(session => {
                    this.modal?.closeModal();

                    const account = session.namespaces.tron.accounts[0];
                    const address = account.split(':').pop();

                    resolve({
                        address,
                        type: 'walletconnect',
                        sign: async (tx) => {
                            tx.visible = false;

                            // ✅ NEW: Explicitly providing chainId and trying both param formats
                            try {
                                return await this.provider.request({
                                    chainId: TRON_CHAIN,
                                    method: 'tron_signTransaction',
                                    params: { address, transaction: tx }
                                });
                            } catch (e) {
                                console.warn('Object format failed, trying array format:', e);
                                return await this.provider.request({
                                    chainId: TRON_CHAIN,
                                    method: 'tron_signTransaction',
                                    params: [tx]
                                });
                            }
                        }
                    });
                })
                .catch(err => {
                    this.modal?.closeModal();
                    reject(err);
                });
        });
    }
}

export const walletManager = new WalletManager();