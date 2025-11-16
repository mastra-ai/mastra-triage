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
