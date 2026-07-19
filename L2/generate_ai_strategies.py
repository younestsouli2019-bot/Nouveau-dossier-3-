#!/usr/bin/env python3
"""
AI-Driven Discovery & Niche Business Strategies 2027
Professional PDF Report - ReportLab + Playwright Cover + pypdf Merge
"""

import os, sys, subprocess
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm, cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, PageBreak, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ── Font Registration ──
pdfmetrics.registerFont(TTFont('LiberationSerif', '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LiberationSerif-Bold', '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf'))
pdfmetrics.registerFont(TTFont('LiberationSerif-Italic', '/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf'))
pdfmetrics.registerFont(TTFont('LiberationSans', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LiberationSans-Bold', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))
registerFontFamily('LiberationSerif', normal='LiberationSerif', bold='LiberationSerif-Bold', italic='LiberationSerif-Italic')
registerFontFamily('LiberationSans', normal='LiberationSans', bold='LiberationSans-Bold')
registerFontFamily('DejaVuSans', normal='DejaVuSans', bold='DejaVuSans')

# ── Cascade Palette ──
PAGE_BG       = colors.HexColor('#f2f3f4')
SECTION_BG    = colors.HexColor('#ebeced')
CARD_BG       = colors.HexColor('#e5e9eb')
TABLE_STRIPE  = colors.HexColor('#eceeef')
HEADER_FILL   = colors.HexColor('#395664')
COVER_BLOCK   = colors.HexColor('#3b535f')
BORDER        = colors.HexColor('#bcc5c9')
ICON          = colors.HexColor('#3f6c82')
ACCENT        = colors.HexColor('#d1623d')
ACCENT_2      = colors.HexColor('#5dbe44')
TEXT_PRIMARY   = colors.HexColor('#171919')
TEXT_MUTED     = colors.HexColor('#777e81')

# ── Page Setup ──
PAGE_W, PAGE_H = A4
LEFT_M = 60
RIGHT_M = 60
TOP_M = 50
BOTTOM_M = 50
CONTENT_W = PAGE_W - LEFT_M - RIGHT_M

# ── Styles ──
sH1 = ParagraphStyle(name='H1', fontName='LiberationSerif-Bold', fontSize=20, leading=26, textColor=HEADER_FILL, spaceAfter=6, spaceBefore=16)
sH2 = ParagraphStyle(name='H2', fontName='LiberationSerif-Bold', fontSize=15, leading=21, textColor=COVER_BLOCK, spaceAfter=5, spaceBefore=12)
sH3 = ParagraphStyle(name='H3', fontName='LiberationSerif-Bold', fontSize=12, leading=17, textColor=ICON, spaceAfter=4, spaceBefore=8)
sBody = ParagraphStyle(name='Body', fontName='LiberationSerif', fontSize=10.5, leading=17, textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=6)
sBullet = ParagraphStyle(name='Bullet', fontName='LiberationSerif', fontSize=10.5, leading=17, textColor=TEXT_PRIMARY, alignment=TA_LEFT, leftIndent=18, spaceAfter=3, bulletIndent=6)
sCaption = ParagraphStyle(name='Caption', fontName='LiberationSerif', fontSize=9, leading=13, textColor=TEXT_MUTED, alignment=TA_CENTER, spaceAfter=6)
sTH = ParagraphStyle(name='TH', fontName='LiberationSerif-Bold', fontSize=10, leading=14, textColor=colors.white, alignment=TA_CENTER)
sTC = ParagraphStyle(name='TC', fontName='LiberationSerif', fontSize=9.5, leading=14, textColor=TEXT_PRIMARY, alignment=TA_CENTER)
sTCL = ParagraphStyle(name='TCL', fontName='LiberationSerif', fontSize=9.5, leading=14, textColor=TEXT_PRIMARY, alignment=TA_LEFT)

# ── Output paths ──
OUTPUT_DIR = '/home/z/my-project/download'
os.makedirs(OUTPUT_DIR, exist_ok=True)
BODY_PDF = os.path.join(OUTPUT_DIR, 'ai_strategies_2027_body.pdf')
COVER_PDF = os.path.join(OUTPUT_DIR, 'cover_ai_strategies.pdf')
FINAL_PDF = os.path.join(OUTPUT_DIR, 'AI_Driven_Discovery_Niche_Business_Strategies_2027.pdf')


def make_accent_line():
    return HRFlowable(width="30%", thickness=2, color=ACCENT, spaceAfter=10, spaceBefore=4)


def build_story():
    story = []

    # ═══════════════════════════════════════════════════════
    # SECTION 1: The Paradigm Shift
    # ═══════════════════════════════════════════════════════
    story.append(Paragraph('The Paradigm Shift: From Traditional Research to AI-Driven Discovery', sH1))
    story.append(make_accent_line())

    story.append(Paragraph(
        'The research landscape is undergoing a fundamental transformation. The methodologies that '
        'dominated market intelligence for decades are being rapidly superseded by AI-native approaches '
        'that are faster, more precise, and exponentially more scalable. Where once businesses relied on '
        'static focus groups and retrospective data scraping, the new paradigm deploys synthetic personas, '
        'predictive intent clustering, and continuous agentic market analysis. This is not an incremental '
        'improvement; it is a complete rethinking of how organizations discover, interpret, and act on '
        'market signals. The implications for competitive advantage are profound and irreversible.',
        sBody
    ))
    story.append(Spacer(1, 12))

    # Comparison table
    comparison_data = [
        [Paragraph('<b>Traditional Research (Pre-2026)</b>', sTH),
         Paragraph('<b>AI-Driven Discovery (2027)</b>', sTH)],
        [Paragraph('Static focus groups and surveys', sTCL),
         Paragraph('Synthetic personas and simulations', sTCL)],
        [Paragraph('Retrospective data scraping', sTCL),
         Paragraph('Predictive intent clustering', sTCL)],
        [Paragraph('Keyword intent volume tracking', sTCL),
         Paragraph('Vector-based semantic mapping', sTCL)],
        [Paragraph('Manual competitor auditing', sTCL),
         Paragraph('Continuous agentic market analysis', sTCL)],
    ]
    col_w = [CONTENT_W * 0.5, CONTENT_W * 0.5]
    t1 = Table(comparison_data, colWidths=col_w, repeatRows=1)
    t1.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TABLE_STRIPE]),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(t1)
    story.append(Paragraph('Table 1: Research Methodology Evolution', sCaption))
    story.append(Spacer(1, 18))

    # ═══════════════════════════════════════════════════════
    # SECTION 2: Three Strategic Pillars for AI Visibility
    # ═══════════════════════════════════════════════════════
    story.append(Paragraph('Three Strategic Pillars for AI Visibility', sH1))
    story.append(make_accent_line())

    story.append(Paragraph(
        'As AI engines increasingly mediate between businesses and their potential customers, '
        'organizations must adapt their digital strategies to ensure visibility, attribution, and trust '
        'within AI-generated outputs. The following three pillars form the foundation of a defensible '
        'position in the AI-mediated discovery landscape. Each pillar addresses a distinct dimension of '
        'the challenge: commercial relevance, brand authority, and structural extractability.',
        sBody
    ))
    story.append(Spacer(1, 8))

    story.append(Paragraph('1. Target Commercial Intent', sH2))
    story.append(Paragraph(
        'The first pillar focuses on capturing high-intent traffic that AI engines struggle to abstract '
        'without proper attribution. Rather than competing for broad informational queries where AI can '
        'easily synthesize answers from multiple sources, organizations should concentrate their content '
        'strategy on middle and bottom-of-the-funnel material. This includes detailed product comparisons, '
        'in-depth technical evaluations, and nuanced buying guides that require domain-specific expertise. '
        'AI engines, despite their sophistication, find it difficult to abstract this type of content '
        'without citing authoritative sources, which means well-crafted commercial intent content earns '
        'both human readership and AI citation. The key insight is that specificity is your moat: the more '
        'granular and context-rich your commercial content, the more likely AI systems will reference your '
        'brand as the canonical source rather than attempting to paraphrase or generalize.',
        sBody
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph('2. Build True Brand Equity', sH2))
    story.append(Paragraph(
        'Large language models are fundamentally citation engines. They trust established entities with '
        'consistent, widespread digital footprints. Building brand equity in the AI era means cultivating '
        'the signals that LLMs use to determine authority: unlinked brand mentions across high-trust '
        'domains, organic community discussions on platforms like Reddit and specialized forums, and '
        'sustained digital PR that generates authoritative references. Unlike traditional SEO, which '
        'focused on link equity and keyword rankings, AI-era brand equity is built through presence and '
        'reputation across the broader information ecosystem. The more an entity is mentioned, discussed, '
        'and referenced in contexts that LLMs ingest during training and retrieval, the more likely those '
        'models are to surface your brand in their outputs. This is not a short-term tactic; it is a '
        'long-term compounding strategy that becomes increasingly difficult for competitors to displace.',
        sBody
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph('3. Structure for Extraction', sH2))
    story.append(Paragraph(
        'The third pillar addresses the mechanical reality of how AI engines process and attribute '
        'content. Structuring your content for extraction means using clear schema markup, concise '
        'bulleted summaries, and definitive declarative statements that AI engines can easily parse, '
        'attribute, and serve as verified source snippets. This is not about dumbing down content; it is '
        'about creating a dual-audience document architecture that serves both human readers and AI '
        'crawlers. Each piece of content should include machine-readable signals (structured data, '
        'clear headings, factual assertions) alongside the narrative depth that human readers expect. '
        'The organizations that master this dual-layer approach will find their content consistently '
        'surfacing in AI-generated answers, complete with attribution, while competitors who ignore '
        'structural extraction will see their content paraphrased without credit.',
        sBody
    ))
    story.append(Spacer(1, 18))

    # ═══════════════════════════════════════════════════════
    # SECTION 3: Four High-Margin Niche Business Models
    # ═══════════════════════════════════════════════════════
    story.append(Paragraph('Four High-Margin Niche Business Models', sH1))
    story.append(make_accent_line())

    story.append(Paragraph(
        'The convergence of AI capabilities and unmet niche market demands has created a fertile landscape '
        'for micro-SaaS businesses with extraordinary profit margins. The following four models represent '
        'the most compelling opportunities for solo founders or small teams to build defensible, '
        'high-margin businesses in 2027 and beyond. Each model leverages the asymmetric economics of AI '
        'where the cost of computation is negligible compared to the value of specialized automation.',
        sBody
    ))
    story.append(Spacer(1, 8))

    # Model 1
    story.append(Paragraph('1. AI "Persona" and Workflow Renting (Micro-SaaS)', sH2))
    story.append(Paragraph(
        'Instead of building a broad AI tool that competes with well-funded incumbents, the strategy is '
        'to develop and "rent out" pre-trained, fine-tuned AI agents designed for highly specific, '
        'high-friction corporate tasks. These are not general-purpose chatbots; they are specialized '
        'workers that understand the exact vocabulary, compliance requirements, and workflow patterns of '
        'a particular industry niche. The key insight is that businesses will happily pay between $150 '
        'and $500 monthly for an automated agent that replaces a $3,000-per-month human salary, and the '
        'margins on these subscriptions sit between 80% and 95% because API costs are minimal.',
        sBody
    ))
    story.append(Paragraph('<b>Example Niches:</b>', sBody))
    story.append(Paragraph(
        'An AI Intake Coordinator built specifically for boutique dental clinics that '
        'handles patient onboarding, insurance verification, and appointment scheduling with full HIPAA '
        'compliance awareness. Or an AI Compliance Screener tailored for independent freight forwarders '
        'that continuously monitors regulatory changes, flags documentation gaps, and generates audit-ready '
        'compliance reports. These agents become indispensable because they embed deep domain knowledge '
        'that generic AI tools cannot replicate, creating natural switching costs and extremely low churn.',
        sBullet, bulletText='\xe2\x80\xa2'
    ))
    story.append(Spacer(1, 8))

    # Model 2
    story.append(Paragraph('2. Proprietary "Clean Data" Pipelines', sH2))
    story.append(Paragraph(
        'As AI companies scramble for unique, high-quality data to train their models, private, '
        'well-structured niche data feeds have become highly valuable. The strategy is to curate, '
        'structure, and continually update highly specialized industry datasets, then sell API access on '
        'a monthly subscription basis. The critical differentiator is data freshness and reliability: '
        'corporate LLMs and enterprise operations require fresh, accurate data to function properly, and '
        'once your database is integrated into their daily automated workflow, your software becomes '
        'effectively un-killable. The result is near-zero customer churn, because removing your data '
        'feed would break their entire operational pipeline.',
        sBody
    ))
    story.append(Paragraph('<b>Example Niches:</b>', sBody))
    story.append(Paragraph(
        'Real-time ingredient pricing trackers for vegan food manufacturers that '
        'aggregate supplier data, commodity exchanges, and shipping costs into a single normalized API. '
        'Or regional zoning change logs for boutique real estate developers that monitor municipal '
        'planning departments, compile permit applications, and flag upcoming zoning modifications before '
        'they become public knowledge. The value proposition is not just the data itself, but the '
        'continuous curation, normalization, and delivery that saves enterprises from maintaining '
        'expensive in-house data engineering teams.',
        sBullet, bulletText='\xe2\x80\xa2'
    ))
    story.append(Spacer(1, 8))

    # Model 3
    story.append(Paragraph('3. Digital and Physical Hybrid "Problem-Solving" Boxes', sH2))
    story.append(Paragraph(
        'Traditional subscription boxes for generic treats or snacks suffer from high customer turnover '
        'because the perceived value diminishes quickly. The modern evolution pairs a cheap physical '
        'anchor with high-margin digital education, solving the churn problem while preserving '
        'profitability. The physical component triggers high perceived value and creates a tangible '
        'connection with the customer, while the digital components deliver the actual recurring value '
        'and maintain profit margins between 60% and 70%. This hybrid model leverages the psychological '
        'power of physical ownership to drive digital engagement and retention.',
        sBody
    ))
    story.append(Paragraph('<b>Example Niches:</b>', sBody))
    story.append(Paragraph(
        'An Airtable-based Inventory Management subscription paired with a physical '
        'barcode scanner for independent vintage clothing sellers. The scanner costs $15 to source but '
        'justifies a $79/month subscription that includes the software workspace, video training library, '
        'and community access. Or a specialized caliper tool shipped monthly alongside a digital fitness '
        'coaching platform for boutique gym owners. The physical object creates an unboxing moment and '
        'perceived premium value, while the digital ecosystem generates the actual margin and keeps '
        'subscribers engaged long after the physical item arrives.',
        sBullet, bulletText='\xe2\x80\xa2'
    ))
    story.append(Spacer(1, 8))

    # Model 4
    story.append(Paragraph('4. Fractional Infrastructure Auditing', sH2))
    story.append(Paragraph(
        'Companies frequently sign up for digital tools, cloud storage, and SaaS products that they '
        'completely forget about, leading to significant wasted capital. The strategy is to offer an '
        'automated, ongoing monitoring service that actively scans a company\'s operational architecture '
        'to flag waste, security leaks, or optimization flaws. This is positioned as an ongoing '
        'cost-saving or risk-management tool, and the economic logic is compelling: if a $99 monthly '
        'subscription consistently saves a business owner $600 in wasted software fees, they will never '
        'cancel it. The service sells itself through demonstrated ROI rather than speculative value.',
        sBody
    ))
    story.append(Paragraph('<b>Example Niches:</b>', sBody))
    story.append(Paragraph(
        'Continuous Cloud and SaaS Spend Optimization for growing creative agencies '
        'that automatically identifies unused licenses, detects billing anomalies, and recommends '
        'consolidation opportunities across dozens of subscription services. Or AI Security Prompt '
        'Leaking Audits for mid-sized law firms that continuously test AI tool integrations for data '
        'exposure vulnerabilities, prompt injection risks, and compliance violations. Both niches share '
        'a common economic structure: the cost of the subscription is a fraction of the identified '
        'savings, making cancellation economically irrational for the customer.',
        sBullet, bulletText='\xe2\x80\xa2'
    ))
    story.append(Spacer(1, 18))

    # ═══════════════════════════════════════════════════════
    # SECTION 4: Strategy Implementation Comparison
    # ═══════════════════════════════════════════════════════
    story.append(Paragraph('Strategy Implementation Comparison', sH1))
    story.append(make_accent_line())

    story.append(Paragraph(
        'The following comparison table provides a concise overview of the four niche business models '
        'across key operational dimensions. Each model presents a distinct risk-reward profile, and the '
        'optimal choice depends on the founder\'s existing skills, available capital, and tolerance for '
        'operational complexity. Notably, three of the four models require less than $500 in startup '
        'capital, making them accessible to bootstrapped founders. The AI Workflow Worker and Clean Data '
        'Pipeline models offer the highest margins (85-95% and 90% respectively) but require stronger '
        'technical skills, while the Hybrid Box model offers lower margins but benefits from the '
        'psychological stickiness of physical products.',
        sBody
    ))
    story.append(Spacer(1, 12))

    strat_data = [
        [Paragraph('<b>Niche Model</b>', sTH), Paragraph('<b>Startup Cost</b>', sTH),
         Paragraph('<b>Skill Requirement</b>', sTH), Paragraph('<b>Profit Margin</b>', sTH)],
        [Paragraph('AI Workflow Worker', sTCL), Paragraph('Low ($100-$300)', sTC),
         Paragraph('Prompt engineering and API connecting', sTC), Paragraph('85% - 95%', sTC)],
        [Paragraph('Clean Data Pipelines', sTCL), Paragraph('Medium ($500)', sTC),
         Paragraph('Web scraping and database organization', sTC), Paragraph('90%', sTC)],
        [Paragraph('Hybrid Boxes', sTCL), Paragraph('High ($1,000+)', sTC),
         Paragraph('Niche expertise and supply shipping', sTC), Paragraph('50% - 70%', sTC)],
        [Paragraph('Infrastructure Auditing', sTCL), Paragraph('Low ($200)', sTC),
         Paragraph('System architecture knowledge', sTC), Paragraph('80%', sTC)],
    ]
    strat_col_w = [CONTENT_W * 0.22, CONTENT_W * 0.18, CONTENT_W * 0.35, CONTENT_W * 0.25]
    t2 = Table(strat_data, colWidths=strat_col_w, repeatRows=1)
    t2.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TABLE_STRIPE]),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t2)
    story.append(Paragraph('Table 2: Niche Business Model Implementation Comparison', sCaption))
    story.append(Spacer(1, 18))

    # ═══════════════════════════════════════════════════════
    # SECTION 5: Ethical Automation & Infrastructure Protection
    # ═══════════════════════════════════════════════════════
    story.append(Paragraph('Ethical Automation and Infrastructure Protection', sH1))
    story.append(make_accent_line())

    story.append(Paragraph(
        'To maintain high margins without risking intellectual property or legal liability, micro-SaaS '
        'tools must respect web boundaries and operationalize ethical automation practices. The promise '
        'of AI-driven business models is compelling, but it carries a responsibility to operate within '
        'the norms, regulations, and technical boundaries that govern internet infrastructure. Failure '
        'to do so exposes businesses to legal action, reputational damage, and the kind of operational '
        'disruption that can destroy recurring revenue overnight. The following three principles form '
        'the ethical backbone of sustainable micro-SaaS operations.',
        sBody
    ))
    story.append(Spacer(1, 8))

    story.append(Paragraph('Robotics Protocols', sH2))
    story.append(Paragraph(
        'Always respect robots.txt directives, specifically User-agent blocks and Crawl-delay settings, '
        'to prevent unauthorized data scraping. The robots.txt file is not merely a suggestion; it is the '
        'foundational protocol that web publishers use to communicate their consent boundaries with '
        'automated agents. Ignoring these directives is not only unethical but increasingly illegal under '
        'computer fraud legislation in multiple jurisdictions. Pragmatically, violating robots.txt '
        'invites IP blocks, legal cease-and-desist orders, and reputational damage that can permanently '
        'disqualify your service from accessing critical data sources. A sustainable micro-SaaS must '
        'implement robots.txt parsing as a core feature, checking directives before every scraping '
        'operation and maintaining a compliance log that can be audited.',
        sBody
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Server Load Management', sH2))
    story.append(Paragraph(
        'Implement aggressive rate limiting and concurrent request caps to prevent automated discovery '
        'agents from degrading host server performance. Even when scraping is authorized, the volume and '
        'velocity of requests from AI agents can overwhelm smaller hosts, causing service degradation or '
        'outages that affect the publisher\'s real users. Responsible micro-SaaS tools should implement '
        'exponential backoff on errors, enforce minimum intervals between requests to the same domain, '
        'and cap concurrent connections to any single host. These measures are not just courtesy; they '
        'are essential for maintaining the long-term health of the data ecosystem that your business '
        'depends on. A tool that damages its data sources is a tool that destroys its own supply chain.',
        sBody
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Human Oversight (HITL)', sH2))
    story.append(Paragraph(
        'Integrate Human-in-the-Loop workflows for AI-generated outputs to catch systematic biases, '
        'hallucinations, and data inaccuracies before delivery. The economic temptation to fully '
        'automate output generation is strong, but the risk profile is asymmetric: a single high-profile '
        'hallucination in a compliance report, financial analysis, or legal screening can result in '
        'catastrophic liability for both the micro-SaaS provider and their customer. HITL workflows do '
        'not need to review every output; they need to sample strategically, flag anomalies, and provide '
        'a feedback loop that continuously improves the automated system. The most effective '
        'implementations use confidence scoring to route low-certainty outputs to human reviewers while '
        'allowing high-certainty outputs to flow automatically, balancing speed with safety.',
        sBody
    ))
    story.append(Spacer(1, 18))

    # ═══════════════════════════════════════════════════════
    # SECTION 6: Secure Pipelines & Compliant Monetization
    # ═══════════════════════════════════════════════════════
    story.append(Paragraph('Secure Pipelines and Compliant Monetization', sH1))
    story.append(make_accent_line())

    story.append(Paragraph(
        'High-margin recurring revenue relies on a foundation of data privacy and transparent user '
        'agreements. In an era where data breaches destroy customer trust overnight and regulatory '
        'penalties can exceed annual revenue, security and compliance are not cost centers; they are '
        'competitive advantages. Micro-SaaS tools that bake privacy and compliance into their architecture '
        'from day one avoid the expensive, disruptive retrofitting that plagues companies who treat these '
        'considerations as afterthoughts. The following framework outlines the essential components of '
        'a secure and compliant monetization strategy.',
        sBody
    ))
    story.append(Spacer(1, 8))

    story.append(Paragraph('Zero-Knowledge Architecture', sH2))
    story.append(Paragraph(
        'Secure data pipelines by encrypting user inputs end-to-end, ensuring proprietary business data '
        'is not leaked into public LLM training sets. Zero-knowledge architecture means that the service '
        'provider cannot read the customer\'s data even if compelled to do so. This is achieved through '
        'client-side encryption before data enters the pipeline, with decryption keys held exclusively by '
        'the customer. In the context of AI micro-SaaS, this means that any data sent to LLM APIs must '
        'be processed in a way that prevents the API provider from retaining or training on the input. '
        'Implementing zero-knowledge architecture not only protects customers from data exposure but also '
        'insulates the micro-SaaS provider from data breach liability, creating a legal and operational '
        'win-win that becomes a powerful selling point in enterprise sales conversations.',
        sBody
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Granular Privacy Compliance', sH2))
    story.append(Paragraph(
        'Structure databases to support automatic data deletion and user-retrieval rights under GDPR, '
        'CCPA, and evolving global privacy frameworks. Privacy compliance is not a checkbox exercise; it '
        'requires architectural decisions that permeate every layer of the data pipeline. Databases must '
        'support per-record TTL (time-to-live) policies, automated deletion cascades that remove '
        'derivatives and backups when a user exercises their right to erasure, and efficient retrieval '
        'mechanisms for data portability requests. The micro-SaaS tools that will dominate their niches '
        'are those that can demonstrate compliance without friction, turning regulatory requirements into '
        'competitive moats rather than operational burdens. Specifically, this means designing schemas '
        'where personal data is isolated, tagged with consent metadata, and deletable without cascading '
        'integrity failures across the application.',
        sBody
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Value-Driven Micro-SaaS', sH2))
    story.append(Paragraph(
        'Focus on single-utility, high-margin software solutions that solve highly specific niche problems, '
        'keeping overhead low and retention high. The value-driven approach to micro-SaaS monetization '
        'rejects the platform temptation: instead of building a suite of features that attempts to serve '
        'multiple use cases, the strategy is to do one thing exceptionally well and charge a fair price '
        'for it. This philosophy aligns naturally with privacy compliance because simpler systems have '
        'smaller attack surfaces, fewer data touchpoints, and more auditable code paths. A single-utility '
        'tool that solves a $3,000/month problem for $200/month with 90% margins and airtight privacy is '
        'an extraordinarily defensible business. The narrow scope makes compliance tractable, the high '
        'margin makes customer acquisition affordable, and the demonstrated value makes churn negligible.',
        sBody
    ))
    story.append(Spacer(1, 18))

    # ═══════════════════════════════════════════════════════
    # SECTION 7: Key Takeaways
    # ═══════════════════════════════════════════════════════
    story.append(Paragraph('Key Takeaways and Strategic Recommendations', sH1))
    story.append(make_accent_line())

    story.append(Paragraph(
        'The transition from traditional research methodologies to AI-driven discovery is not a distant '
        'future scenario; it is actively reshaping competitive dynamics across every industry vertical. '
        'Organizations that fail to adapt their content strategies, brand positioning, and data '
        'architectures for AI-mediated discovery will find themselves increasingly invisible to both '
        'AI engines and the customers who rely on them. The three strategic pillars outlined in this '
        'report, targeting commercial intent, building true brand equity, and structuring for extraction, '
        'provide a comprehensive framework for maintaining visibility and authority in the new landscape.',
        sBody
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        'For entrepreneurs and small teams, the four niche business models presented here demonstrate '
        'that extraordinary profit margins are achievable without massive capital investment, provided '
        'that the business is built around a deep understanding of a specific niche and the asymmetric '
        'economics of AI automation. The AI Workflow Worker model offers the most accessible entry point '
        'for technically skilled founders, while the Clean Data Pipeline model provides the most '
        'defensible long-term position due to its near-zero churn characteristics. The Hybrid Box model, '
        'while requiring more operational complexity, uniquely combines physical product psychology with '
        'digital margin economics. Fractional Infrastructure Auditing offers the most straightforward '
        'value proposition: your subscription pays for itself many times over, making retention virtually '
        'automatic.',
        sBody
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        'Critically, sustainable success in this space requires an unwavering commitment to ethical '
        'automation and infrastructure protection. Respecting robotics protocols, managing server load '
        'responsibly, and integrating human oversight are not constraints on growth; they are the '
        'prerequisites for longevity. Similarly, secure pipelines and compliant monetization through '
        'zero-knowledge architecture, granular privacy controls, and value-driven single-utility design '
        'transform regulatory obligations into competitive advantages. The businesses that will thrive '
        'in 2027 and beyond are those that combine the precision of niche automation with the discipline '
        'of ethical operation, leveraging AI not as a general-purpose tool but as a responsible, '
        'domain-specific instrument for solving problems that large platforms overlook.',
        sBody
    ))

    return story


def generate_cover():
    """Generate cover PDF via Playwright."""
    cover_html = os.path.join(OUTPUT_DIR, 'cover_ai_strategies.html')
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>AI-Driven Discovery & Niche Business Strategies 2027</title>
<style>
  @page { size: 794px 1123px; margin: 0; }
  html, body { margin: 0; padding: 0; width: 794px; height: 1123px; background: #f2f3f4; }
  .cover { position: relative; width: 794px; height: 1123px; background: #f2f3f4; overflow: hidden; }
  .accent-bar { position: absolute; top: 0; left: 0; width: 100%; height: 8px; background: #d1623d; }
  .side-bar { position: absolute; top: 130px; left: 60px; width: 4px; height: 260px; background: #395664; opacity: 0.35; }
  .geo-1 { position: absolute; bottom: 180px; right: 60px; width: 320px; height: 320px; border: 2px solid #bcc5c9; opacity: 0.25; }
  .geo-2 { position: absolute; bottom: 200px; right: 80px; width: 280px; height: 280px; border: 1px solid #d1623d; opacity: 0.12; }
  .line-h { position: absolute; bottom: 160px; left: 60px; right: 60px; height: 1px; background: #395664; opacity: 0.2; }
  .accent-line { position: absolute; top: 430px; left: 60px; width: 180px; height: 2px; background: #d1623d; }
  .kicker { position: absolute; top: 150px; left: 80px; font-family: 'Liberation Serif', Georgia, serif; font-size: 14pt; letter-spacing: 4pt; color: #777e81; opacity: 0.6; text-transform: uppercase; }
  .hero { position: absolute; top: 190px; left: 80px; right: 80px; font-family: 'Liberation Serif', Georgia, serif; font-size: 44pt; font-weight: bold; color: #171919; line-height: 1.15; max-width: 634px; }
  .hero .accent { color: #d1623d; }
  .meta { position: absolute; top: 450px; left: 80px; right: 80px; font-family: 'Liberation Serif', Georgia, serif; font-size: 16pt; color: #3b535f; line-height: 1.5; }
  .summary { position: absolute; top: 540px; left: 80px; right: 80px; max-width: 540px; font-family: 'Liberation Serif', Georgia, serif; font-size: 13pt; color: #777e81; line-height: 1.7; opacity: 0.85; }
  .footer-l { position: absolute; bottom: 60px; left: 80px; font-family: 'Liberation Serif', Georgia, serif; font-size: 10pt; color: #777e81; opacity: 0.5; letter-spacing: 1pt; }
  .footer-r { position: absolute; bottom: 60px; right: 80px; font-family: 'Liberation Serif', Georgia, serif; font-size: 10pt; color: #777e81; opacity: 0.5; letter-spacing: 1pt; }
  .watermark { position: absolute; bottom: 80px; right: 80px; font-family: 'Liberation Serif', Georgia, serif; font-size: 120pt; font-weight: bold; color: #395664; opacity: 0.04; line-height: 1; }
</style>
</head>
<body>
<div class="cover">
  <div class="accent-bar"></div>
  <div class="side-bar"></div>
  <div class="geo-1"></div>
  <div class="geo-2"></div>
  <div class="line-h"></div>
  <div class="accent-line"></div>
  <div class="kicker">Strategic Intelligence Report</div>
  <div class="hero">AI-Driven <span class="accent">Discovery</span> &amp; Niche Business Strategies</div>
  <div class="meta">2027 Market Analysis &mdash; Four High-Margin Models for the AI Economy</div>
  <div class="summary">A comprehensive analysis of the paradigm shift from traditional research to AI-driven discovery, three strategic pillars for AI visibility, four actionable niche business models with margins from 50% to 95%, ethical automation principles, and secure pipeline architectures for compliant monetization.</div>
  <div class="footer-l">CONFIDENTIAL</div>
  <div class="footer-r">JUNE 2027</div>
  <div class="watermark">2027</div>
</div>
</body>
</html>"""
    
    with open(cover_html, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    # Render via Playwright
    js_code = f"""
const {{ chromium }} = require('playwright');
(async () => {{
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('file://{cover_html}');
    await page.pdf({{
        path: '{COVER_PDF}',
        width: '794px',
        height: '1123px',
        printBackground: true,
        margin: {{ top: 0, right: 0, bottom: 0, left: 0 }}
    }});
    await browser.close();
    console.log('Cover PDF generated');
}})().catch(e => {{ console.error(e); process.exit(1); }});
"""
    
    result = subprocess.run(
        ['node', '-e', js_code],
        env={**os.environ, 'NODE_PATH': '/home/z/.npm-global/lib/node_modules'},
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        print(f"Cover generation error: {result.stderr}")
        raise RuntimeError(f"Cover PDF failed: {result.stderr}")
    print(f"Cover PDF generated: {COVER_PDF}")


def merge_pdfs():
    """Merge cover + body into final PDF."""
    from pypdf import PdfReader, PdfWriter
    
    writer = PdfWriter()
    
    # Add cover
    cover_reader = PdfReader(COVER_PDF)
    for page in cover_reader.pages:
        writer.add_page(page)
    
    # Add body
    body_reader = PdfReader(BODY_PDF)
    for page in body_reader.pages:
        writer.add_page(page)
    
    # Add metadata
    writer.add_metadata({
        '/Title': 'AI-Driven Discovery & Niche Business Strategies 2027',
        '/Author': 'Z.ai',
        '/Subject': 'AI Market Strategy Report',
        '/Creator': 'Z.ai Report Generator',
    })
    
    with open(FINAL_PDF, 'wb') as f:
        writer.write(f)
    
    print(f"Final PDF generated: {FINAL_PDF}")
    print(f"  Pages: {len(cover_reader.pages) + len(body_reader.pages)}")


def main():
    # Step 1: Generate body PDF
    doc = SimpleDocTemplate(
        BODY_PDF, pagesize=A4,
        leftMargin=LEFT_M, rightMargin=RIGHT_M,
        topMargin=TOP_M, bottomMargin=BOTTOM_M,
        title='AI-Driven Discovery & Niche Business Strategies 2027',
        author='Z.ai',
    )
    story = build_story()
    doc.build(story)
    print(f"Body PDF generated: {BODY_PDF}")
    
    # Step 2: Generate cover PDF
    generate_cover()
    
    # Step 3: Merge
    merge_pdfs()
    
    # Cleanup temp files
    for tmp in [BODY_PDF, COVER_PDF, os.path.join(OUTPUT_DIR, 'cover_ai_strategies.html')]:
        try:
            os.remove(tmp)
        except:
            pass
    
    # Report file size
    size_kb = os.path.getsize(FINAL_PDF) / 1024
    print(f"\nFinal output: {FINAL_PDF}")
    print(f"File size: {size_kb:.1f} KB")


if __name__ == '__main__':
    main()
