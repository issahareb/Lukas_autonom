import { githubRequest, ownRepoRef, resolveGithubOwner } from "./github";

/** Read-only startup check of the same repository/ref used by github_read_path. */
export async function inspectTelefonCodeAccess(): Promise<{ readable: boolean; reason?: string }> {
  if (!process.env.GITHUB_TOKEN?.trim()) return { readable: false, reason: "github_not_configured" };
  try {
    const { owner, repo } = await resolveGithubOwner("Lukas_autonom");
    const ref = ownRepoRef(repo);
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/artifacts/api-server/src/lib/telefon.ts`;
    const result = await githubRequest(path + (ref ? "?ref=" + encodeURIComponent(ref) : "")) as Record<string, unknown> | null;
    const readable = result?.type === "file" && result.encoding === "base64" && typeof result.content === "string" && result.content.length > 0;
    return readable ? { readable: true } : { readable: false, reason: "code_not_readable" };
  } catch {
    // Neither provider errors nor file contents belong in phone diagnostics.
    return { readable: false, reason: "github_read_failed" };
  }
}
