// Opens a report issue with the fine-grained token (Issues read/write on this repo only).

import type { IssueDraft } from './reports.ts';

export interface OpenedIssue {
  number: number;
  url: string;
}

export class GitHubError extends Error {
  constructor(readonly status: number) {
    super(`GitHub answered ${status}`);
  }
}

const labelName = (label: unknown) => (typeof label === 'string' ? label : (label as { name?: unknown } | null)?.name);

/**
 * Opens the issue. GitHub drops labels on a new issue when the token has no push access
 * (this one has Issues read/write only), and `npm run triage` finds reports by their
 * labels: missing labels are added afterwards, which Issues write allows.
 */
export async function openIssue(
  repo: string,
  token: string,
  draft: IssueDraft,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenedIssue> {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'aiprescreen-api',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: draft.title, body: draft.body, labels: draft.labels }),
  });
  if (!res.ok) throw new GitHubError(res.status);
  const issue = (await res.json()) as { number?: unknown; html_url?: unknown; labels?: unknown };
  if (typeof issue.number !== 'number' || typeof issue.html_url !== 'string') throw new GitHubError(502);
  const have = Array.isArray(issue.labels) ? issue.labels.map(labelName) : [];
  const missing = draft.labels.filter((l) => !have.includes(l));
  if (missing.length > 0) {
    // The issue exists either way: a failure here leaves it unlabelled, not unreported.
    await fetchImpl(`https://api.github.com/repos/${repo}/issues/${issue.number}/labels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ labels: missing }),
    }).catch(() => undefined);
  }
  return { number: issue.number, url: issue.html_url };
}
