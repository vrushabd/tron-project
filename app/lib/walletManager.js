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

                            // Potential Chain IDs used by different wallets
                            const chains = [TRON_CHAIN, 'tron:1'];

                            // Potential Method names
                            const methods = ['tron_signTransaction', 'tron_sign_transaction', 'signTransaction'];

                            // Potential Param structures
                            const getParamVariants = (targetTx) => [
                                [{ address, transaction: targetTx }],
                                { address, transaction: targetTx },
                                [targetTx]
                            ];

                            let lastErr = null;
                            for (const chain of chains) {
                                for (const method of methods) {
                                    // Try both the full object AND the raw hex
                                    const txVariants = [tx, tx.raw_data_hex].filter(Boolean);

                                    for (const txVar of txVariants) {
                                        for (const params of getParamVariants(txVar)) {
                                            try {
                                                console.log(`Trying ${method} on ${chain} with ${typeof txVar === 'string' ? 'hex' : 'obj'}...`);
                                                return await this.provider.request({
                                                    chainId: chain,
                                                    method: method,
                                                    params: params
                                                });
                                            } catch (e) {
                                                lastErr = e;
                                                const msg = (e.message || '').toLowerCase();
                                                if (msg.includes('user rejected') || msg.includes('cancel')) throw e;
                                                // Keep trying other formats
                                            }
                                        }
                                    }
                                }
                            }
                            throw lastErr || new Error('All 36 signing combinations failed. Please use TronLink or the built-in Trust Wallet browser.');
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