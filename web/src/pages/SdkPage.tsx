import { Link } from 'react-router-dom';

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-[#0d1117] px-4 py-3 text-sm text-[#e6edf3]">
      <code>{children}</code>
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function SdkPage() {
  return (
    <div className="h-screen overflow-y-auto bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-10">
        {/* Header */}
        <div>
          <Link
            to="/login"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Back to sign in
          </Link>
          <div className="flex items-center gap-3">
            <img src="/icons/white/logo-128.png" alt="Ship" className="h-8 w-8" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Ship SDK</h1>
              <p className="text-sm text-muted">TypeScript SDK for the Ship platform API</p>
            </div>
          </div>
        </div>

        {/* Quick start */}
        <Section title="Quick start">
          <p className="text-sm text-muted leading-relaxed">
            The Ship SDK lets you read and write documents, issues, and sprints from your own scripts and integrations.
            The <code className="rounded bg-border/50 px-1 py-0.5 text-xs font-mono text-foreground">ship</code> CLI
            is included and authenticates via a device-flow OAuth handshake — no passwords or API keys to manage.
          </p>
          <CodeBlock>{`npm install @ship-dhairya/sdk`}</CodeBlock>
        </Section>

        {/* Authentication */}
        <Section title="Authentication">
          <p className="text-sm text-muted leading-relaxed">
            Run <code className="rounded bg-border/50 px-1 py-0.5 text-xs font-mono text-foreground">ship login</code> once.
            The CLI will print a short code and a URL. Open the URL, approve the device in your browser, and the CLI stores
            the access token automatically.
          </p>
          <CodeBlock>{`ship login

# → Open: https://ship.example.gov/device
# → Enter code: ABCD-1234
# ✓ Logged in`}</CodeBlock>
          <p className="text-sm text-muted">
            No <code className="rounded bg-border/50 px-1 py-0.5 text-xs font-mono text-foreground">SHIP_OAUTH_CLIENT_ID</code> env
            var required — the CLI discovers the client ID from the API automatically.
          </p>
        </Section>

        {/* CLI usage */}
        <Section title="CLI usage">
          <CodeBlock>{`# List your documents
ship docs ls

# Paginate with a cursor
ship docs ls <cursor>`}</CodeBlock>
        </Section>

        {/* SDK usage */}
        <Section title="SDK usage (TypeScript)">
          <CodeBlock>{`import { ShipClient } from '@ship-dhairya/sdk';

const client = new ShipClient({ baseUrl: 'https://ship.example.gov' });

// List documents
const { data, nextCursor } = await client.documents.list();
console.log(data.map(d => d.title));`}</CodeBlock>
        </Section>

        {/* Requirements */}
        <Section title="Requirements">
          <ul className="space-y-1 text-sm text-muted">
            {['Node.js 20 or newer', 'pnpm', 'Access to the Ship API'].map((req) => (
              <li key={req} className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-muted flex-shrink-0" />
                {req}
              </li>
            ))}
          </ul>
        </Section>

        {/* Minimal flow */}
        <Section title="Minimal end-to-end flow">
          <CodeBlock>{`npm install @ship-dhairya/sdk
ship login
ship docs ls`}</CodeBlock>
        </Section>

        {/* Footer */}
        <div className="border-t border-border pt-6 text-xs text-muted">
          <p>
            Questions?{' '}
            <Link to="/login" className="text-accent hover:underline">
              Sign in to Ship
            </Link>{' '}
            and visit the Developer portal under Settings.
          </p>
        </div>
      </div>
    </div>
  );
}
