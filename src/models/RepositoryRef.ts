export type Provider = "github" | "gitlab";

/**
 * Identifies the repository a webhook event belongs to, independent of
 * which provider it came from. `providerRepositoryId` is the provider's
 * own stable numeric/string ID for the repo (not derivable from the URL
 * alone, and more reliable than name/owner if a repo is later renamed).
 */
export interface RepositoryRef {
    provider:             Provider;
    providerRepositoryId: string;
    fullName:             string; // e.g. "owner/repo" or "group/subgroup/repo"
    owner:                string;
    url:                  string;
}
