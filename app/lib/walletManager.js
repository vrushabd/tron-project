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
                requiredNamespaces: namespaces,
                optionalNamespaces: namespaces,
                sessionProperties: {
                    tron_method_version: 'v1' // Some wallets require this to activate the bridge
                }
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

                            // List of potential method names and formats to try
                            const formats = [
                                { method: 'tron_signTransaction', params: { address, transaction: tx } },
                                { method: 'tron_signTransaction', params: [tx] },
                                { method: 'tron_sign_transaction', params: { address, transaction: tx } },
                                { method: 'tron_sign_transaction', params: [tx] }
                            ];

                            let lastErr = null;
                            for (const format of formats) {
                                try {
                                    console.log(`Trying ${format.method} with ${Array.isArray(format.params) ? 'array' : 'object'} format...`);
                                    return await this.provider.request({
                                        chainId: TRON_CHAIN,
                                        method: format.method,
                                        params: format.params
                                    });
                                } catch (e) {
                                    lastErr = e;
                                    const msg = e.message || '';
                                    if (msg.includes('User rejected')) throw e; // Don't retry if user cancelled
                                    console.warn(`${format.method} failed:`, msg);
                                }
                            }
                            throw lastErr || new Error('All signing methods failed with "Unknown Method"');
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