import { Env } from "../types/env";
import { JSONSchema } from "../types/yahoo";

export const scheduledRebuildChart: ExportedHandlerScheduledHandler<Env> =
  async (_, env: Env, ctx) => {
	try {
	    const yfRes = await fetch(
	        'https://query1.finance.yahoo.com/v8/finance/chart/HFCL.NS?interval=1d',
	        {
	          headers: {
	            'User-Agent':
	              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
	            Accept: 'application/json',
	          },
	          cf: { cacheTtl: 300 },
	        },
	    );
		if (!yfRes.ok) {
			console.error('Yahoo status', yfRes.status);
			throw new Error('Yahoo fetch error');
		}

		const yf: JSONSchema = await yfRes.json();

	   	const previousClose = yf.chart.result[0].meta.chartPreviousClose || 0
		const marketPrice   = yf.chart.result[0].meta.regularMarketPrice || 0
		const difference    = +(marketPrice - previousClose).toFixed(2)
		const percentage    = +((difference / previousClose) * 100).toFixed(2)

		function withSign(num: number) {
		    if (num > 0) return `+${num}`
		    return String(num)
		}

	   	const payload = {
			fieldData: {
				difference: withSign(difference),
				percentage: `${withSign(percentage)}%`,
				'current-price': marketPrice.toFixed(2),
			},
		};

	    const cmsRes = await fetch(`${env.WEBFLOW_CMS_API}/collections/${env.INVESTORS_COLLECTION_ID}/items/${env.INVESTORS_COLLECTION_ITEM_ID}/live`, {
	        method: 'PATCH',
	        headers: {
		        Authorization: `Bearer ${env.WEBFLOW_API_TOKEN}`,
		        'Accept-Version': '2.0.0',
		        'Content-Type': 'application/json',
	        },
	        body: JSON.stringify(payload),
	    });

	    const body = await cmsRes.text();

	   	if (!cmsRes.ok) throw new Error(`CMS patch failed ${body}`);
		return true
	} catch (e) {
	    console.error('scheduledRebuildChart failed', e);
	    throw e;
	}
};
