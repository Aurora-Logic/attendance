import type { ReactNode } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { formatDate } from '@/lib/format';

import { LEGAL_DOCUMENTS, LEGAL_SLUGS, isLegalSlug, type LegalDocument } from './legal-content';

/**
 * The Terms and the Privacy Policy: readable before sign-in, because
 * signing in is how they are accepted, and after it.
 *
 * A reading page composed from explicit parts rather than one component
 * with switches: the frame (wordmark, a way back), the header (what this
 * is, when it last changed), the contents rail, the body at a 65-character
 * measure with comfortable leading, and the foot (the other document). The
 * page rises once on first paint, as the sign-in frame does, and nothing
 * here is a colour the theme does not own, so it reads in both modes.
 */
export function LegalPage({ slug }: { slug: string }) {
  const document = isLegalSlug(slug) ? LEGAL_DOCUMENTS[slug] : null;
  const others = LEGAL_SLUGS.filter((other) => other !== slug).map((other) => LEGAL_DOCUMENTS[other]);

  return (
    <LegalFrame>
      {document === null ? (
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Nothing at this address</h1>
          <p className="text-muted-foreground text-sm/relaxed">
            The documents that live here are the {others.map((other) => other.title).join(' and the ')}.
          </p>
        </div>
      ) : (
        <article className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-12">
          <LegalHeader document={document} />
          <LegalContents document={document} />
          <LegalBody document={document} />
        </article>
      )}
      <LegalFoot others={others} />
    </LegalFrame>
  );
}

function LegalFrame({ children }: { children: ReactNode }) {
  return (
    <main className="ease-out-strong mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 transition-[opacity,translate] duration-300 starting:translate-y-2 starting:opacity-0 md:py-12">
      <div className="flex items-center justify-between gap-4">
        <p className="text-2xl font-semibold tracking-[-0.02em]">Vyuha</p>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" />}>
          <ArrowLeftIcon data-icon="inline-start" />
          Sign in
        </Button>
      </div>
      {children}
    </main>
  );
}

function LegalHeader({ document }: { document: LegalDocument }) {
  return (
    <header className="flex flex-col gap-2 lg:col-span-2">
      <p className="text-muted-foreground text-xs font-medium">Legal</p>
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{document.title}</h1>
      <p className="text-muted-foreground max-w-[65ch] text-sm/relaxed text-pretty">{document.lead}</p>
      <p className="text-muted-foreground text-xs tabular-nums">Last updated {formatDate(document.updatedOn)}</p>
    </header>
  );
}

/** Numbered, and a rail on a wide screen; a plain list above the text on a narrow one. */
function LegalContents({ document }: { document: LegalDocument }) {
  return (
    <nav aria-label="Contents" className="lg:sticky lg:top-6 lg:self-start">
      <p className="text-muted-foreground mb-2 text-xs font-medium lg:hidden">Contents</p>
      <ol className="text-muted-foreground flex flex-col gap-1 text-xs/relaxed">
        {document.sections.map((section, index) => (
          <li key={section.heading}>
            <a href={`#${anchorOf(section.heading)}`} className="hover:text-foreground inline-flex gap-2 transition-colors">
              <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
              <span>{section.heading}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function LegalBody({ document }: { document: LegalDocument }) {
  return (
    <div className="flex max-w-[65ch] flex-col gap-8">
      {document.sections.map((section, index) => (
        <section key={section.heading} id={anchorOf(section.heading)} className="flex scroll-mt-24 flex-col gap-2">
          <h2 className="flex items-baseline gap-3 text-base font-semibold tracking-tight">
            <span className="text-muted-foreground text-xs font-medium tabular-nums">{String(index + 1).padStart(2, '0')}</span>
            {section.heading}
          </h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-sm/relaxed text-pretty">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

function LegalFoot({ others }: { others: readonly LegalDocument[] }) {
  return (
    <>
      <Separator />
      <nav aria-label="Other documents" className="flex flex-wrap items-center gap-2">
        {others.map((other) => (
          <Button key={other.slug} variant="outline" size="sm" nativeButton={false} render={<Link to={`/legal/${other.slug}`} />}>
            {other.title}
          </Button>
        ))}
      </nav>
    </>
  );
}

function anchorOf(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}
