// Paywall hook. OFF by default (free). To charge later:
//   1. set PAYWALL_ENABLED=1 (in .env or the environment)
//   2. implement isPaid() below (e.g. verify a Stripe Checkout session id / receipt sent by the client)
// Every chargeable action goes through gate(action). Today the only one is 'open_case';
// a future 'appeal' route would just add gate('appeal').
const ENABLED = /^(1|true|yes)$/i.test(process.env.PAYWALL_ENABLED || '');
const PRICES = { open_case: process.env.PRICE_OPEN_CASE || '0', appeal: process.env.PRICE_APPEAL || '0' };

async function isPaid(req, action) {
  // TODO(payments): look up req.get('x-payment-id') with your payment provider.
  return false;
}

function gate(action) {
  return async (req, res, next) => {
    if (!ENABLED) return next();
    if (await isPaid(req, action)) return next();
    res.status(402).json({ error: 'Payment required to continue.', action, price: PRICES[action], paywall: true });
  };
}
module.exports = { gate, ENABLED, PRICES };
