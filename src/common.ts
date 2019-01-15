
export const CASH_WITHDRAWAL_PARTNER = Symbol("cash");

export interface Transaction {
    type: string;
    value: number;
    balance: number;
    date: string;
    partner: string | typeof CASH_WITHDRAWAL_PARTNER;
    memo: string;
}

export type SmsParser = [ RegExp, (parts: Array<string>) => Transaction | null ];

export type BankParser = {
    smsParsers: Array<SmsParser>,
    smsNumbers: Array<string>,
};

export function logError(reason: any) {
    const message = (reason instanceof Error) ? reason.toString() : "Error:" + JSON.stringify(reason);
    console.log(message);
};