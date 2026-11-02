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

export async function openIssue(
  repo: string,
  token: string,
  draft: IssueDraft,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenedIssue> {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'aiprescreen-api',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ title: draft.title, body: draft.body, labels: draft.labels }),
  });
  if (!res.ok) throw new GitHubError(res.status);
  const issue = (await res.json()) as { number?: unknown; html_url?: unknown };
  if (typeof issue.number !== 'number' || typeof issue.html_url !== 'string') throw new GitHubError(502);
  return { number: issue.number, url: issue.html_url };
}
