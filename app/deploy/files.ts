import { headersFile, netlifyToml, redirectsFile, vercelJson } from './hosting';

/** Generated hosting files, by path relative to the repository root. */
export function hostingFiles(): Record<string, string> {
  return {
    'vercel.json': vercelJson(),
    'netlify.toml': netlifyToml(),
    'app/public/_headers': headersFile(),
    'app/public/_redirects': redirectsFile(),
  };
}
