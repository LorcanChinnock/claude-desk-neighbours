# Contributing

## Checks

Every pull request runs two required checks:

- `validate` validates the marketplace and every plugin with `claude plugin validate . --strict`, then runs each
  plugin's tests with `claude plugin test`.
- `conventional` checks that the PR title is a conventional commit. PRs are squash-merged with the title as the
  commit message, and release-please reads it to pick the next version: `feat` bumps the minor version, `fix` the
  patch, and a `!` the major.

Claude also reviews each push to a pull request, except drafts and the release PR. Mention `@claude` in a comment to
ask it something.

## Releases

release-please keeps a release PR open that bumps every plugin's version and the changelog. Merge it to tag the
release. Installed copies update when the version in a plugin's `plugin.json` changes, so a change isn't on anyone's
machine until its release PR is merged.

### Release secrets

release-please opens the release pull request as a GitHub App rather than with the workflow's own token, because
GitHub holds the workflows on a pull request from `github-actions[bot]` until someone approves them, so its required
checks never start. Install a private GitHub App on this repository with no webhook and these repository
permissions: Contents, Pull requests and Issues set to read and write. Then store its client ID as a repository
variable and a private key as a repository secret:

```bash
gh variable set RELEASE_APP_CLIENT_ID                          # paste the app's client ID
gh secret set RELEASE_APP_PRIVATE_KEY < release-app.private-key.pem
```

The Claude workflows need a Claude Code OAuth token:

```bash
claude setup-token                                             # prints the token
gh secret set CLAUDE_CODE_OAUTH_TOKEN                          # paste it
```
