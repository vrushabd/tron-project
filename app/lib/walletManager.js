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

            this.provider.connect({ namespaces })
                .then(session => {
                    this.modal?.closeModal();

                    const account = session.namespaces.tron.accounts[0];
                    const address = account.split(':').pop();

                    resolve({
                        address,
                        type: 'walletconnect',
                        sign: async (tx) => {
                            // ✅ FIX 1: Trust Wallet requires params as an OBJECT
                            //    { address, transaction: tx }  ← correct
                            //    [tx]                          ← WRONG, causes "unknown method"
                            tx.visible = false;

                            const result = await this.provider.request({
                                method: 'tron_signTransaction',
                                params: {
                                    address,          // signer address
                                    transaction: tx   // the unsigned tx object
                                }
                            });

                            // ✅ FIX 2: Trust Wallet returns the signed tx directly
                            //    or nested under .transaction — handle both cases
                            if (!result) throw new Error('No result from wallet signing');

                            if (typeof result === 'string') {
                                try { return JSON.parse(result); } catch { return result; }
                            }

                            // Some wallets wrap it, some don't
                            return result.transaction ?? result;
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