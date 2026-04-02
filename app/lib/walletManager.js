'use client';

import { UniversalProvider } from '@walletconnect/universal-provider';
import { WalletConnectModal } from '@walletconnect/modal';

const PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || '8e404b901cfd65b6a7824c9657ce527d';
const TRON_CHAIN = 'tron:0x2b6653dc';

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

    async getInjected() {
        if (typeof window === 'undefined') return null;
        // inside trust wallet in-app, we MUST prioritize window.tronWeb
        if (window.tronWeb?.ready) return window.tronWeb;
        if (window.trustwallet?.tron) return window.trustwallet.tron;
        if (window.tronLink) return window.tronLink;
        return null;
    }

    async connect() {
        const injected = await this.getInjected();
        if (injected) {
            try {
                if (injected.request) await injected.request({ method: 'tron_requestAccounts' });
            } catch (e) { console.warn(e); }
            const address = injected.defaultAddress?.base58 || (injected.getAddress && await injected.getAddress());
            if (!address) throw new Error('Wallet locked');
            return {
                address,
                type: 'injected',
                sign: async (tx) => {
                    tx.visible = false;
                    try {
                        // Priority 1: Classic TronWeb sign
                        if (injected.trx?.sign) return await injected.trx.sign(tx);
                        // Priority 2: Modern request
                        if (injected.request) {
                            return await injected.request({ method: 'tron_signTransaction', params: [tx] });
                        }
                    } catch (e) {
                        console.warn('In-app sign fail:', e);
                        throw e;
                    }
                    throw new Error('Signing method not found on injected provider');
                }
            };
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

            const namespaces = {
                tron: {
                    chains: [TRON_CHAIN],
                    methods: ['tron_signTransaction', 'tron_sign_transaction', 'tron_signMessage'],
                    events: []
                }
            };

            this.provider.connect({
                namespaces,
                requiredNamespaces: namespaces,
                optionalNamespaces: namespaces,
                sessionProperties: { tron_method_version: 'v1' }
            }).then(session => {
                this.modal?.closeModal();
                const account = session.namespaces.tron.accounts[0];
                const address = account.split(':').pop();

                resolve({
                    address,
                    type: 'walletconnect',
                    sign: async (tx) => {
                        tx.visible = false;
                        // Sane signing fallback matrix
                        const formats = [
                            { m: 'tron_signTransaction', p: [{ address, transaction: tx }] },
                            { m: 'tron_signTransaction', p: [tx] },
                            { m: 'tron_sign_transaction', p: [{ address, transaction: tx }] },
                            { m: 'tron_sign_transaction', p: [tx] }
                        ];

                        let lastErr = null;
                        for (const f of formats) {
                            try {
                                return await this.provider.request({ chainId: TRON_CHAIN, method: f.m, params: f.p });
                            } catch (e) {
                                lastErr = e;
                                if (e.message?.toLowerCase().includes('reject')) throw e;
                            }
                        }
                        throw lastErr || new Error('All signing methods failed');
                    }
                });
            }).catch(reject);
        });
    }
}

export const walletManager = new WalletManager();