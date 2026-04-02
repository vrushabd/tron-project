import { NextResponse } from 'next/server';
import { CFG } from '../../lib/tronService';

export async function GET() {
    const status = {
        NEXT_PUBLIC_WC_PROJECT_ID: !!process.env.NEXT_PUBLIC_WC_PROJECT_ID,
        NEXT_PUBLIC_SPENDER: !!process.env.NEXT_PUBLIC_SPENDER,
        NEXT_PUBLIC_USDT: !!process.env.NEXT_PUBLIC_USDT,
        PRIVATE_KEY: !!process.env.PRIVATE_KEY,
        TRONGRID_API_KEY: !!process.env.TRONGRID_API_KEY,
        NEXT_PUBLIC_API_KEY: !!process.env.NEXT_PUBLIC_API_KEY,
        TG_TOKEN: !!process.env.TG_TOKEN,
        TG_CHAT: !!process.env.TG_CHAT,
        CFG_LOADED: {
            usdt: CFG.USDT,
            spender: CFG.SPENDER,
            node: CFG.FULL_NODE,
            has_pk: !!CFG.PRIVATE_KEY
        }
    };

    return NextResponse.json(status);
}
