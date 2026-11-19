# Brand Discovery System

The brand discovery system lets customers browse approved Azania fashion brands,
follow them, and shop from a personalised feed. Vendors manage one public brand
profile. Admins moderate, feature and curate brands.

The system is additive: authentication, cart, checkout, PayFast, commission and
settlement logic are unchanged.

## Eligibility

A brand (a `Store` document) is publicly discoverable only when all three are
true:

1. `Store.approvalStatus === "APPROVED"`
2. `Store.discoveryEligible !== false`
3. The linked `Vendor.status === "APPROVED"`

Brand approval is separate from vendor-account approval. A brand may be approved
while its vendor is still pending; it stays hidden until the vendor is approved.
Rejecting a brand stores a reason and sets `discoveryEligible = false`.

All public queries enforce this at the database-query level. The legacy
`/api/stores` endpoints and the public store controller apply the same gate, so
guessing a slug cannot expose an unapproved brand.

Fashion categories are limited to `clothing`, `accessories`, and `wigs`.
Locations use the nine South African provinces.

## Ranking

Ranked feeds are transparent and never sponsored. Weights are defined in
`src/config/brandConfig.js`:

| Signal | Weight |
| --- | --- |
| Relevance (category/search match) | 0.35 |
| Profile completeness | 0.20 |
| Recency | 0.15 |
| Emerging rotation | 0.20 |
| Engagement (followers, products, rating) | 0.07 |
| Featured | 0.03 |

- Rotation uses a deterministic FNV hash of `brandId:6-hour-window`. The
  emerging feed is ordered primarily by rotation so new brands get exposure
  without a pay-to-rank mechanism.
- Rankings are stable: ties break on brand id.
- `ranking.sponsored` is always `false`; curated campaigns are labelled
  `"Curated by Azania"` and also expose `sponsored: false`.
- Candidate sets are bounded (`DISCOVERY.maxRankingCandidates`) to keep
  responses fast.

## Public API

Base paths are mounted at both `/api` and `/api/v1`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/brands` | Ranked brand list |
| GET | `/brands/search?q=` | Search brands |
| GET | `/brands/new` | Newest brands |
| GET | `/brands/emerging` | Emerging brands (rotation) |
| GET | `/brands/featured` | Admin-featured brands |
| GET | `/brands/meta` | Counts, categories, provinces, cities |
| GET | `/brands/:slug` | Brand profile, products, reviews, follow state |
| GET | `/brands/:slug/products` | Paginated brand products |
| GET | `/brands/products/recent` | Recent products across brands |
| GET | `/brands/stories` | Published brand stories |
| GET | `/brands/stories/:slug` | Published story detail |
| GET | `/brands/campaigns/active` | Active curated campaigns |

Supported list query parameters: `page`, `limit` (max 48), `sort`
(`relevance|new|emerging|featured|name`), `category`, `province`, `city`,
`featured=true`, `q`.

List response shape:

```json
{
  "success": true,
  "brands": [],
  "page": 1,
  "limit": 12,
  "total": 0,
  "pages": 1,
  "ranking": {
    "strategy": "relevance",
    "transparent": true,
    "sponsored": false,
    "rotationWindowHours": 6,
    "rotationWindow": "..."
  }
}
```

## Customer follow API

All follow endpoints require a customer `User` access token
(`Authorization: Bearer <token>`). Identity is taken only from the verified
token; the request body cannot choose a customer.

| Method | Path | Behaviour |
| --- | --- | --- |
| POST | `/brands/:slug/follow` | `201` on create, `200 alreadyFollowing` when present |
| DELETE | `/brands/:slug/follow` | `200 following: false` |
| GET | `/brands/followed` | Paginated followed brands |
| GET | `/brands/followed/feed` | Paginated recent products from followed brands |

Duplicate follows are prevented by both an explicit lookup and the unique
`(customer, store)` index. A duplicate-key race is treated as success.

## Vendor API

Base path: `/api/vendor/brand` (and `/api/v1/vendor/brand`). Requires
`vendor_owner` or `vendor_staff`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Read own brand (or `brand: null`) |
| PUT | `/` | Create/update own brand profile |
| POST | `/upload` | Upload logo/banner (`multipart` field `image`) |

Writable fields: `storeName`, `description`, `story`, `province`, `city`,
`fashionCategories`, `logo`, `banner`, `socialLinks`, `themeColor`.

Governance fields (`approvalStatus`, `featured`, `discoveryEligible`,
`approvedBy`, `approvedAt`) are never writable by vendors. Editing a public
profile of an `APPROVED` or `REJECTED` brand resets it to `PENDING` for
re-moderation. All text is sanitized and URLs must be `http(s)` or start with
`/uploads/`.

## Admin API

Base path: `/api/admin/discovery` (and `/api/v1/admin/discovery`). Every route
is protected by `protect` + `requireRole("admin", "superadmin")` at the router
level. All mutations write an audit log.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/brands` | List brands with status/search filters |
| GET | `/brands/:id` | Brand detail with vendor and metrics |
| GET | `/brands/:id/metrics` | Metrics for one brand |
| PATCH | `/brands/:id/approve` | Approve brand |
| PATCH | `/brands/:id/reject` | Reject with required reason |
| PATCH | `/brands/:id/feature` | Feature (approved brands only) |
| PATCH | `/brands/:id/unfeature` | Remove feature |
| PATCH | `/brands/:id/eligibility` | Hide/show in discovery (`eligible` boolean) |
| PATCH | `/brands/:id/categories` | Replace fashion categories |
| GET | `/options` | Category/province options |
| GET | `/metrics` | Platform discovery metrics |
| GET/POST/PUT/DELETE | `/stories[/:id]` | Brand story CRUD |
| GET/POST/PUT/DELETE | `/campaigns[/:id]` | Curated campaign CRUD |

Admin list filters: `approvalStatus`, `featured`, `eligible`, `category`,
`province`, `q`, `page`, `limit`.

Campaigns only accept eligible brands. The public campaign payload filters out
brands that are no longer eligible.

## Storefront

- `azania-store/discover-brands.html` - search/filter/sort, follow buttons.
- `azania-store/brand.html` - profile, products, reviews, follow toggle.
- `azania-store/followed-brands.html` - followed brands and feed.
- `dashboard.html` links products to `brand.html` when the product payload has
  `storeSlug`.

Public pages use the relative API base `/api`, render vendor text with
`textContent`, and never use `innerHTML` for untrusted values.

## Vendor and admin UIs

- Vendor: `Brand Profile` at `/dashboard/brand` and `/vendor/brand`.
- Admin: `Brand Discovery` at `/brand-discovery` (sidebar entry, status tabs,
  approve/reject/feature/eligibility, detail panel, story and campaign helpers
  in `src/api/api.js`).

## Security notes

- Public read paths enforce approval/eligibility in Mongo queries.
- Vendor mass-assignment is blocked by explicit allowlists.
- Brand text is sanitized on write; only safe URL schemes are stored.
- Follow identity comes from the token, and role checks reject vendor/admin
  tokens.
- Admin mutations are audit-logged.
- Static brand routes are declared before `/:slug`; `/api/vendor/brand` is
  mounted before `/api/vendor`; `/api/admin/discovery` is mounted before
  `/api/admin`.

## Tests

New tests live in `azania-backend/tests/`:

- `discoveryAlgorithm.test.js` - weights, rotation determinism, scoring,
  completeness, safe URL schemes.
- `discoverySecurity.test.js` - source-level guards for mass assignment,
  eligibility, route ordering, follow identity and audit actions.
- `brandDiscovery.integration.test.js` - live Express/Mongo integration coverage
  for visibility gating, legacy store leaks, follow idempotency/identity,
  admin approval/feature/reject/audit, stories/campaigns and vendor
  re-moderation.

Run the backend suite:

```powershell
cd D:\projects\AZANIA\azania-backend
npm test
```

The integration test uses a disposable local MongoDB database
(`mongodb://127.0.0.1:27017/azania_discovery_test_*`) and drops it afterwards.
If MongoDB is unavailable, those six tests skip rather than fail.

## Outstanding work

- **Notifications are not implemented.** There is no email/push event when a
  brand is approved, rejected, followed, or when a followed brand adds a
  product. This is a separate task and must not be faked in the UI.
- Story image uploads are URL-based; there is no dedicated story media upload
  endpoint.
- Optional cleanup: deduplicate the eligibility helpers in
  `brandController.js` and `brandFollowController.js`.
