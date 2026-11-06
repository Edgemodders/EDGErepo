# EDGErepo: notes for Claude sessions

Scripts shared by the Edgemodders tools (README.md). The plan: REDnode's `docs/edgerepo.md`. REDnode's `CLAUDE.md` and `docs/dev-setup.md` (`../REDnode`) set the shared conventions: commit straight to `main`, the per-repo git identity, plain short sentences, and never commit game files.

- **Moving a tag reaches every tool's next release.** Agree it with the owner first. Run `node tools/nexus/check.mjs`, wait for the Check workflow on `main`, add a line to `CHANGELOG.md`, then move the tag (README.md, "The tag").
- Never print the Nexus key or put it on a command line. It goes only into the `apikey` header.
- The tools have no npm dependencies, since a release workflow runs them from a bare clone, before `npm ci`. Keep it that way.
- Before changing how the tool behaves on a live page, compare read-only `check --version 99.0.0` output from each tool's repo folder.
