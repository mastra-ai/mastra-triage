import { Octokit } from 'octokit';

let octokit: Octokit | null = null;

export function getGithubClient() {
  if (!octokit) {
    octokit = new Octokit({
      auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
    });
  }

  return octokit;
}

export interface GitHubLabel {
  name: string;
  description: string | null;
}

let cachedLabels: GitHubLabel[] | null = null;

/**
 * Fetches all labels from the GitHub repo.
 * Results are cached to avoid repeated API calls.
 */
export async function getRepoLabels(
  owner: string = 'mastra-ai',
  repo: string = 'mastra',
): Promise<GitHubLabel[]> {
  if (cachedLabels) {
    return cachedLabels;
  }

  const octokit = getGithubClient();
  const labels: GitHubLabel[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.rest.issues.listLabelsForRepo({
      owner,
      repo,
      per_page: 100,
      page,
    });

    if (data.length === 0) break;

    labels.push(
      ...data.map(label => ({
        name: label.name,
        description: label.description,
      })),
    );

    if (data.length < 100) break;
    page++;
  }

  cachedLabels = labels;
  return labels;
}
