import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Explorer } from "@/components/Explorer";
import { Demo, FeaturePage } from "@/components/FeaturePage";

export const metadata: Metadata = { title: "API keys & JWT" };

export default function ApiKeysPage() {
  return (
    <FeaturePage
      title="API keys & JWT"
      tagline="Who is calling, and what are they allowed to do?"
      docs="https://www.rfc-editor.org/rfc/rfc6750.html"
      whatItIs={<p>
        An <strong>API key</strong> is a long random secret a program sends with every request (
        <code>Authorization: Bearer lab_…</code>). The API stores only its <strong>SHA-256 hash</strong>, so a leaked database
        doesn&apos;t leak working keys, and shows the key itself exactly once. Each key carries <strong>scopes</strong>: what
        it may do. A key can be exchanged for a <strong>JWT</strong>: a signed token that says who the caller is and what they
        may do until it expires 15 minutes later. The API verifies the signature instead of looking anything up, which is fast
        and stateless, but means a token can&apos;t be revoked early. <strong>401</strong> means &quot;who are you?&quot;
        (missing or bad credentials); <strong>403</strong> means &quot;I know who you are, and no&quot; (missing scope).
      </p>}
      whenToUse={[
        "Server-to-server calls and scripts: API keys",
        "Many services checking the same caller without a shared database: JWTs",
        "Giving a client only the access it needs: scopes",
      ]}
    >
      <Demo title="From no credentials to a scoped token">
        <Explorer
          presets={[
            { label: "No credentials", method: "GET", path: "/api/me", note: "401, with WWW-Authenticate: Bearer telling the client how to authenticate." },
            { label: "Create key", method: "POST", path: "/api/keys", body: '{ "name": "My script", "scopes": ["stats:read"] }', note: "The key is in the response once, never again. It expires after 24 hours on this public lab." },
            { label: "Who am I", method: "GET", path: "/api/me", headers: { Authorization: "Bearer {key}" }, note: "The key identifies the caller and its scopes." },
            { label: "Allowed", method: "GET", path: "/api/stats", headers: { Authorization: "Bearer {key}" }, note: "The key has stats:read, so: 200." },
            { label: "Missing scope", method: "GET", path: "/api/export/tasks", headers: { Authorization: "Bearer {key}" }, note: "It doesn't have tasks:export: 403 with error=\"insufficient_scope\"." },
            { label: "Get a token", method: "POST", path: "/api/token", headers: { Authorization: "Bearer {key}" }, note: "Trade the key for a 15-minute JWT. Look inside: it's readable by anyone, but can't be changed without the secret." },
            { label: "Use the token", method: "GET", path: "/api/me", headers: { Authorization: "Bearer {token}" }, note: "method: jwt. No key, and no database lookup to check it." },
            { label: "Revoke the key", method: "DELETE", path: "/api/keys/{keyId}", headers: { Authorization: "Bearer {key}" }, note: "A key can revoke itself. After this, the key gets 401 at once, but the token keeps working until it expires." },
            { label: "Wrong key", method: "GET", path: "/api/me", headers: { Authorization: "Bearer lab_not-a-real-key" }, note: "401 with error=\"invalid_token\". Even public endpoints refuse a bad credential." },
          ]}
        />
      </Demo>

      <p className="text-sm text-muted">
        Keys here use SHA-256 because they&apos;re 256 random bits: unguessable, so a fast hash is enough. Passwords are the
        opposite (short, human-chosen), which is why they need a deliberately slow hash such as Argon2 or bcrypt. Tokens are
        HS256-signed with a secret only the API knows (<code>JWT_SECRET</code>), and checked for issuer, audience and expiry.
      </p>

      <CodePeek file="api/auth.ts" />
      <CodePeek file="api/routes/auth.ts" />
    </FeaturePage>
  );
}
