import fetch from 'node-fetch';

type BorderlessAccountResponse = Array<{
    profileId: number;
    balances: Array<{
        amount: {
            value: number,
            currency: string
        }
    }>;
}>

type ProfileResponse = Array<{ id: number, type: string }>;

type RateResponse = Array<{ rate: number }>;

function fetchWithToken(token: string, url: string): Promise<any> {
    return fetch(url,
        {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        })
        .then(response => response.json());
}

function getPersonalProfileId(token: string): Promise<number> {

    return fetchWithToken(token, "https://api.transferwise.com/v1/profiles")
        .then((list: ProfileResponse) => {
            const profile = list.find(x => x.type === "personal");
            if (profile == null) {
                throw Error("Cannot get personal Transferwise profile ID");
            }
            return profile.id;
        });
}

export async function getBalances(token: string): Promise<Map<string, number>> {
    const profileId = await getPersonalProfileId(token);
    const resp: BorderlessAccountResponse = await fetchWithToken(token, `https://api.transferwise.com/v1/borderless-accounts?profileId=${profileId}`);
    const account = resp.find(x => x.profileId === profileId);
    if (account == null) {
        throw Error("Cannot match profileId in account response");
    }

    const dict = new Map();
    account.balances.map(b => [b.amount.currency, b.amount.value * 1000])
        .forEach(([ currency, value ]) => {
            let old = dict.has(currency) ? dict.get(currency) : 0;
            dict.set(currency, old + value);
        });
    return dict;
}

export function getRate(token: string, source: string, target: string, date?: string): Promise<number> {
    if (source === target) {
        return Promise.resolve(1);
    }

    let url = `https://api.transferwise.com/v1/rates?source=${source}&target=${target}`;
    if (/^\d\d\d\d-\d\d-\d\d$/.test(date || "")) {
        url += `&${date}T12:00`;
    }
    return fetchWithToken(token, url)
        .then((resp: RateResponse) => resp[0].rate);
}
