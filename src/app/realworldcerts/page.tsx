import { Metadata } from 'next';
import { getCatalogData } from '@/app/api/realworldcerts/catalog/data-source';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Certification Catalog — RealWorldCerts',
  description: 'Browse 24 professional certification courses — PMP, LSSGB, AWS Solutions Architect, CISM, CISSP, Scrum, SAFe, TOGAF, Azure, Microsoft 365, SANS GSEC and more. Self-paced, unlimited retakes, 30-day money-back guarantee.',
  openGraph: {
    title: 'Certification Catalog | RealWorldCerts',
    description: 'RealWorldCerts professional certification catalog — PMP, LSSGB, AWS, cybersecurity, agile, cloud, architecture, business analysis courses.',
    type: 'website',
    url: 'https://www.realworldcerts.com/realworldcerts',
    siteName: 'RealWorldCerts',
    images: [{ url: 'https://www.realworldcerts.com/assets/courses/catalog-hero.svg', width: 1200, height: 630, alt: 'RealWorldCerts Catalog' }],
  },
  twitter: { card: 'summary_large_image', title: 'RealWorldCerts Catalog', description: '24 professional certifications.' },
};

const LEVEL_STYLES: Record<string, string> = {
  'Foundation': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Entry': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Fundamental': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Associate': 'bg-sky-100 text-sky-800 border-sky-200',
  'Essentials': 'bg-sky-100 text-sky-800 border-sky-200',
  'Intermediate': 'bg-amber-100 text-amber-800 border-amber-200',
  'Practitioner': 'bg-amber-100 text-amber-800 border-amber-200',
  'Certified': 'bg-violet-100 text-violet-800 border-violet-200',
  'Advanced': 'bg-rose-100 text-rose-800 border-rose-200',
  'Expert': 'bg-red-100 text-red-800 border-red-200',
};

const BADGES = [
  { label: '30 Day Money Back', svg: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="6" y="8" width="36" height="32" rx="4" stroke="#0ea5e9" stroke-width="2"/><path d="M14 24l6 6 14-14" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { label: 'Pass Rate 94.3%', svg: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 34L20 22l8 8 12-16" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { label: '18,400+ Verified Students', svg: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="18" cy="20" r="6" stroke="#6366f1" stroke-width="2"/><circle cx="32" cy="22" r="5" stroke="#6366f1" stroke-width="2"/><path d="M6 40c0-6 6-10 12-10s12 4 12 10" stroke="#6366f1" stroke-width="2" stroke-linecap="round"/></svg>' },
  { label: '6.5M+ Certification Holders', svg: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M6 16h36v20H6z" stroke="#f59e0b" stroke-width="2" rx="3"/><path d="M6 22h36M14 16V12h20v4M30 28l4 4 8-10" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { label: '24/7 Support', svg: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 26c0-9 7-16 16-16s16 7 16 16v8H8z" stroke="#10b981" stroke-width="2" rx="3"/><circle cx="19" cy="30" r="2" fill="#10b981"/><circle cx="29" cy="30" r="2" fill="#10b981"/><path d="M6 38h36" stroke="#10b981" stroke-width="2" stroke-linecap="round"/></svg>' },
  { label: 'Secure Payments', svg: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M10 22V16a14 14 0 0128 0v6" stroke="#a855f7" stroke-width="2"/><rect x="8" y="22" width="32" height="20" rx="3" stroke="#a855f7" stroke-width="2"/></svg>' },
  { label: 'CMI/PayPal/Crypto', svg: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="6" y="10" width="36" height="22" rx="3" stroke="#ef4444" stroke-width="2"/><rect x="10" y="16" width="10" height="7" rx="1" fill="#ef4444" fill-opacity="0.2"/><path d="M10 28h20" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/></svg>' },
  { label: 'PSD2/EU SWIFT', svg: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="16" stroke="#0ea5e9" stroke-width="2"/><path d="M8 24h32M24 8c4 6 4 26 0 32M24 8c-4 6-4 26 0 32" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round"/></svg>' },
];

export default async function RealWorldCertsCatalogPage() {
  const { products, summary } = await getCatalogData();

  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'RealWorldCerts',
    url: 'https://www.realworldcerts.com',
    logo: 'https://www.realworldcerts.com/favicon.svg',
    email: 'support@realworldcerts.com',
    sameAs: ['https://www.realworldcerts.com'],
  };

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'RealWorldCerts Certification Catalog',
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.title,
      url: `https://www.realworldcerts.com/realworldcerts/${p.sku}`,
    })),
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50 text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify([orgJsonLd, itemListJsonLd]) }}
      />
      <section className="px-6 pt-10 pb-6 border-b border-slate-200">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-extrabold tracking-tight">
            Professional Certification Catalog
          </h1>
          <p className="mt-3 text-slate-600 max-w-3xl">
            {summary.total} accredited certifications across {summary.categories.length} categories and {summary.vendors.length} vendors.
            Self-paced study with unlimited practice retakes, verified digital badges, and a 30-day money-back guarantee.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 font-medium">
              Avg. Price ${summary.avgPrice}
            </span>
            <span className="px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium">
              From ${summary.minPrice}
            </span>
            <span className="px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 font-medium">
              Top ${summary.maxPrice}
            </span>
            <span className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-medium">
              {summary.vendors.length} Vendors
            </span>
          </div>
        </div>
      </section>

      <section aria-label="Trust badges" className="max-w-7xl mx-auto px-6 py-6">
        <ul role="list" className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {BADGES.map((b) => (
            <li key={b.label} role="listitem" className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white border border-slate-200 shadow-sm">
              <div className="w-12 h-12 shrink-0 flex items-center justify-center" role="img" aria-label={b.label} dangerouslySetInnerHTML={{ __html: b.svg }} />
              <span className="text-[11px] leading-tight text-center text-slate-700 font-medium">{b.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {products.map((p) => {
            const levelCls = LEVEL_STYLES[p.level] || 'bg-slate-100 text-slate-800 border-slate-200';
            const slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || p.sku.toLowerCase();
            return (
              <article key={p.sku} className="flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition duration-150 p-5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <span className={`px-2 py-1 rounded-full border text-[11px] font-semibold ${levelCls}`}>{p.level}</span>
                  <span className="text-xs text-slate-500">{p.vendor}</span>
                </div>
                <h2 className="text-lg font-bold leading-snug mb-2">
                  <a className="hover:text-indigo-700" href={`/realworldcerts/${p.sku}`}>{p.title}</a>
                </h2>
                <p className="text-xs text-slate-500 mb-4">{p.category} · SKU <span className="font-mono">{p.sku}</span></p>
                <div className="mt-auto space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>{p.hours}h · {p.ceus} CEUs</span>
                    <span className="text-2xl font-extrabold text-slate-900">${p.price}</span>
                  </div>
                  <a
                    className="block text-center w-full px-4 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm"
                    style={{ minHeight: '48px', minWidth: '44px' }}
                    href={`/checkout/start.html?course=${slug}&sku=${p.sku}`}
                  >
                    Buy Now
                  </a>
                  <a
                    className="block text-center w-full px-4 py-2 rounded-lg border border-slate-200 text-slate-700 font-medium text-sm hover:bg-slate-50"
                    href={`/realworldcerts/${p.sku}`}
                  >
                    View Details
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
