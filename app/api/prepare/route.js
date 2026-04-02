import { NextResponse } from 'next/server';
import { getServerTW, CFG } from '../../lib/tronService';

export async function POST(req) {
    try {
        const { ownerAddress, amount } = await req.json();
        if (!ownerAddress || !amount) {
            return NextResponse.json({ error: 'Missing ownerAddress or amount' }, { status: 400 });
        }

        const tw = getServerTW();

        // Build the approval transaction
        // Note: We use triggerSmartContract to get the unsigned transaction
        const { transaction } = await tw.transactionBuilder.triggerSmartContract(
            CFG.USDT,
            'approve(address,uint256)',
            { feeLimit: 150_000_000 },
            [
                { type: 'address', value: CFG.SPENDER },
                { type: 'uint256', value: tw.toSun(amount) } // Convert USDT amount to Sun equivalent (6 decimals for USDT)
            ],
            ownerAddress
        );

        return NextResponse.json({ transaction });
    } catch (error) {
        console.error('Prepare API Error:', error);
        return NextResponse.json({
            error: error.message || 'Internal Server Error',
            hint: 'Ensure PRIVATE_KEY, NEXT_PUBLIC_SPENDER, and NEXT_PUBLIC_USDT are set in Vercel environment variables.'
        }, { status: 500 });
    }
}
