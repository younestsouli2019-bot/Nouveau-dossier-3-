# Payments rail configuration — EXAMPLE ONLY. Never commit real values.
#
# Card rail order in src/app/api/checkout/create/route.ts:
#   1. Stripe          (only when STRIPE_SECRET_KEY is set)
#   2. Paddle          (hosted checkout, mapped by course slug)
#   3. Lemon Squeezy   (hosted checkout, mapped by course slug)
# When none are configured the route fails closed with a 503 and a clear
# buyer-facing message — it never invents a payment link.

# Used by GET /api/checkout/rails for readiness reporting.
BUSINESS_JURISDICTION=

# --- Stripe (only if the entity is registered in a supported country) ---
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# --- Merchant of Record: Paddle ---
# JSON map of course slug -> hosted checkout URL.
# Only https URLs on *.paddle.com / *.paddle.io are accepted by the resolver.
CHECKOUT_LINK_MAP_PADDLE={}

# --- Merchant of Record: Lemon Squeezy ---
# JSON map of course slug -> hosted checkout URL.
# Only https URLs on *.lemonsqueezy.com are accepted by the resolver.
CHECKOUT_LINK_MAP_LEMONSQUEEZY={}

# --- Ordering override (optional) ---
# Comma-separated. Default: paddle,lemonsqueezy
CHECKOUT_RAIL_ORDER=
