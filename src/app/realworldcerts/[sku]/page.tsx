import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BESTSELLERS, findProductBySku, getCatalogData } from '@/app/api/realworldcerts/catalog/data-source';

export const dynamic = 'force-dynamic';

export async function generateStaticParams() {
  return BESTSELLERS.map((p) => ({ sku: p.sku }));
}

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const p = findProductBySku(sku);
  if (!p) return { title: 'Not found' };
  const title = `${p.title} | RealWorldCerts`;
  const description = `${p.title} by ${p.vendor} — ${p.hours} hours self-paced study, ${p.ceus} CEUs, unlimited practice retakes, 30-day money-back guarantee. Price $${p.price} USD.`;
  return {
    title,
    description,
    openGraph: {
      type: 'website',
      title,
      description,
      url: `https://www.realworldcerts.com/realworldcerts/${p.sku}`,
      siteName: 'RealWorldCerts',
      images: [{ url: `https://www.realworldcerts.com/assets/courses/${p.sku.toLowerCase()}.svg`, width: 1200, height: 630, alt: p.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`https://www.realworldcerts.com/assets/courses/${p.sku.toLowerCase()}.svg`],
    },
  };
}

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

const FAQ = [
  { q: 'Does this include the exam voucher?', a: 'Standard bundles include the study kit plus unlimited practice tests. The optional Exam Voucher tier includes your official voucher for your vendor exam appointment at the nearest test center or online proctor.' },
  { q: 'How long do I have to complete the course?', a: 'Study is 100% self-paced. On average learners spend 6–12 weeks for most certifications; you retain lifetime access to the lessons and practice questions.' },
  { q: 'Is there a money-back guarantee?', a: 'Yes. If you complete 100% of the lessons and pass 3 practice tests at 80%+ and still fail the official exam within 12 months, we refund your full purchase under the 30-day and the Pass Guarantee terms.' },
  { q: 'Are practice tests included?', a: 'Yes — thousands of realistic practice questions, flashcards, and scenario-based exam simulators are included with every course. Unlimited retakes until you pass.' },
  { q: 'What payment methods are supported?', a: 'CMI local card, PayPal, international bank wire (SWIFT/SEPA), Moroccan MAD manual transfer, and USDC crypto on Arbitrum. All transactions are PSD2/SCA compliant.' },
  { q: 'When will I receive access?', a: 'E-courses and digital badges are delivered instantly after payment. Printed materials ship within 48 hours. Exam vouchers are emailed within 1 business day once eligibility is confirmed.' },
  { q: 'Is my data safe?', a: 'We follow GDPR, PSD2 and PCI-DSS. Your card never touches our servers — payments are tokenized by CMI, PayPal or SWIFT rails. You can request data erasure by writing to privacy@realworldcerts.com.' },
  { q: 'Can I upgrade later?', a: 'Yes. Any difference you paid will be credited pro-rated against the upgraded tier (e.g., Standard → Premium with Exam Voucher or Bundle package).' },
];

const INCLUDES = [
  `${BESTSELLERS[0].hours}h video lessons`,
  `${BESTSELLERS[0].ceus} CEUs / PDUs accredited`,
  'Unlimited practice tests',
  'Flashcards + exam simulator',
  'Digital certificate + badge',
  '12-month instructor support',
];

export default async function SkuDetailPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const p = findProductBySku(sku);
  if (!p) return notFound();
  const slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || p.sku.toLowerCase();
  const levelCls = LEVEL_STYLES[p.level] || 'bg-slate-100 text-slate-800 border-slate-200';
  const related = getCatalogData().products.filter((x) => x.category === p.category && x.sku !== p.sku).slice(0, 3);

  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    sku: p.sku,
    description: `${p.title} — ${p.hours} hours of accredited study, ${p.ceus} CEUs, vendor ${p.vendor}.`,
    brand: { '@type': 'Brand', name: p.vendor },
    category: p.category,
    audience: { '@type': 'Audience', audienceType: `${p.level} professionals` },
    offers: {
      '@type': 'Offer',
      priceCurrency: p.currency,
      price: p.price,
      availability: 'https://schema.org/InStock',
      url: `https://www.realworldcerts.com/realworldcerts/${p.sku}`,
      seller: { '@type': 'Organization', name: 'RealWorldCerts', email: 'sales@realworldcerts.com' },
      areaServed: 'Worldwide',
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: ['MA', 'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'LU', 'AE', 'CA'],
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 30,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      },
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '94.3',
      reviewCount: '18400',
      bestRating: '100',
      worstRating: '0',
    },
  };

  const courseJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'EducationalOccupationalProgram',
    name: p.title,
    description: `${p.title} — study track for ${p.level} professionals in ${p.category}.`,
    provider: { '@type': 'Organization', name: 'RealWorldCerts', url: 'https://www.realworldcerts.com' },
    educationalCredentialAwarded: `${p.vendor} ${p.sku}`,
    numberOfHours: p.hours,
    programType: `${p.level} Certification`,
    offers: { '@type': 'Offer', price: p.price, priceCurrency: p.currency },
    timeToComplete: `P${Math.round(p.hours / 8)}W`,
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify([productJsonLd, courseJsonLd, faqJsonLd]) }}
      />
      <section className="px-6 pt-8 pb-6 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-6xl mx-auto">
          <nav className="text-xs text-slate-500 mb-3">
            <a className="hover:text-indigo-600" href="/realworldcerts">Catalog</a>
            <span className="mx-2">/</span>
            <span>{p.category}</span>
            <span className="mx-2">/</span>
            <span className="text-slate-700 font-medium">{p.sku}</span>
          </nav>
          <div className="flex flex-wrap items-start gap-3 mb-3">
            <span className={`px-3 py-1 rounded-full border text-xs font-semibold ${levelCls}`}>{p.level}</span>
            <span className="px-3 py-1 rounded-full border border-slate-200 bg-white text-xs text-slate-600">{p.vendor}</span>
            <span className="px-3 py-1 rounded-full border border-slate-200 bg-white text-xs text-slate-600">{p.category}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">{p.title}</h1>
          <div className="mt-3 flex items-center gap-4 text-sm text-slate-600">
            <span>⏱ {p.hours}h self-paced</span>
            <span>🎓 {p.ceus} CEUs / PDUs</span>
            <span>⭐ <strong className="text-amber-600">94.3%</strong> pass rate · 18,400+ reviews</span>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-8 grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <div className="prose prose-slate max-w-none">
            <h2 className="text-xl font-bold mb-2">What you'll learn</h2>
            <p className="text-slate-700 leading-relaxed">
              Master the <strong>{p.vendor} {p.sku}</strong> objectives with video lessons, scenario drills,
              practice quizzes, exam-mock simulators and flashcards. You will earn <strong>{p.ceus} CEUs / PDUs</strong>,
              receive a digital badge, and be eligible to schedule the official exam at any worldwide test center or online proctor.
            </p>
            <ul className="mt-3 grid sm:grid-cols-2 gap-2 list-none p-0">
              {INCLUDES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="text-emerald-600 mt-0.5">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold mb-3">Frequently asked questions</h2>
            <div className="space-y-2">
              {FAQ.map((f) => (
                <details key={f.q} className="rounded-lg border border-slate-200 px-4 py-2 bg-slate-50">
                  <summary style={{ minHeight: '48px' }} className="cursor-pointer font-semibold text-slate-800 py-1.5">
                    {f.q}
                  </summary>
                  <p className="text-sm text-slate-700 pb-2 leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide">Price</div>
                <div className="text-4xl font-extrabold text-slate-900">${p.price}</div>
                <div className="text-xs text-slate-500">{p.currency} · lifetime access</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-emerald-600 font-semibold uppercase">In stock</div>
                <div className="text-[11px] text-slate-500">Instant delivery</div>
              </div>
            </div>
            <a
              className="block text-center w-full px-4 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base shadow-sm"
              style={{ minHeight: '56px', minWidth: '44px' }}
              href={`/checkout/start.html?course=${slug}&sku=${p.sku}`}
            >
              Enroll Now — ${p.price}
            </a>
            <a
              className="block text-center w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50"
              style={{ minHeight: '52px' }}
              href="/realworldcerts"
            >
              ← Back to catalog
            </a>
            <ul className="text-xs text-slate-500 space-y-1 border-t border-slate-100 pt-3">
              <li>🔒 Checkout: CMI · PayPal · Wire · USDC</li>
              <li>🛡 30-day money-back · Pass Guarantee</li>
              <li>📧 Receipt + invoice to your email</li>
              <li>🌍 Worldwide delivery · 24/7 support</li>
            </ul>
          </div>
        </aside>
      </section>

      {related.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-8 border-t border-slate-200">
          <h2 className="text-xl font-bold mb-4">Related in {p.category}</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {related.map((r) => (
              <a key={r.sku} href={`/realworldcerts/${r.sku}`} className="rounded-xl border border-slate-200 p-4 hover:shadow-md transition">
                <div className="text-xs text-slate-500 mb-1">{r.vendor} · <span className="font-mono">{r.sku}</span></div>
                <div className="font-semibold mb-2">{r.title}</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">{r.hours}h</span>
                  <span className="font-bold text-indigo-700">${r.price}</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
