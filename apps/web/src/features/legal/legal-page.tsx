import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { formatDate } from '@/lib/format';

import { LEGAL_DOCUMENTS, LEGAL_SLUGS, isLegalSlug } from './legal-content';

/**
 * The Terms and the Privacy Policy, readable before sign-in (they are
 * accepted by signing in, so they have to be readable first) and after it.
 * A reading page, not an app screen: one column of comfortable measure, the
 * wordmark the sign-in page carries, and a way back.
 */
export function LegalPage({ slug }: { slug: string }) {
  const document = isLegalSlug(slug) ? LEGAL_DOCUMENTS[slug] : null;
  const others = LEGAL_SLUGS.filter((other) => other !== slug).map((other) => LEGAL_DOCUMENTS[other]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between gap-4">
        <p className="text-2xl font-semibold tracking-[-0.02em]">Vyuha</p>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" />}>
          <ArrowLeftIcon data-icon="inline-start" />
          Sign in
        </Button>
      </div>

      {document === null ? (
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Nothing at this address</h1>
          <p className="text-muted-foreground text-sm">
            The documents that live here are the {others.map((other) => other.title).join(' and the ')}.
          </p>
        </div>
      ) : (
        <article className="flex flex-col gap-8">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{document.title}</h1>
            <p className="text-muted-foreground text-sm">{document.lead}</p>
            <p className="text-muted-foreground text-xs tabular-nums">Last updated {formatDate(document.updatedOn)}</p>
          </header>
          {document.sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-sm/relaxed">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </article>
      )}

      <Separator />

      <nav aria-label="Other documents" className="flex flex-wrap items-center gap-2">
        {others.map((other) => (
          <Button key={other.slug} variant="outline" size="sm" nativeButton={false} render={<Link to={`/legal/${other.slug}`} />}>
            {other.title}
          </Button>
        ))}
      </nav>
    </main>
  );
}
