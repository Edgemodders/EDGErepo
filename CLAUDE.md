# EDGErepo: notes for Claude sessions

Scripts shared by the Edgemodders tools (README.md). The plan: REDnode's `docs/edgerepo.md`. REDnode's `CLAUDE.md` and `docs/dev-setup.md` (`../REDnode`) set the shared conventions: commit straight to `main`, the per-repo git identity, plain short sentences, and never commit game files.

- **Moving a tag reaches every tool's next release.** Agree it with the owner first. Run `node tools/nexus/check.mjs`, wait for the Check workflow on `main`, add a line to `CHANGELOG.md`, then move the tag (README.md, "The tag").
- Never print the Nexus key or put it on a command line. It goes only into the `apikey` header.
- The tools have no npm dependencies, since a release workflow runs them from a bare clone, before `npm ci`. Keep it that way.
- Before changing how the tool behaves on a live page, compare read-only `check --version 99.0.0` output from each tool's repo folder.

## Dashboard (EDGEweb)

The platform dashboard at https://edgemodders.ai/dashboard.html draws one file in the EDGEweb repo, `docs/assets/dashboard/status.js` (plain JSON after the equals sign, one object per tool under `tools`). The owner and a managing session read it to see every tool's state, so EDGErepo's entry is kept current by the session that works on EDGErepo.

- **When:** in the same piece of work as any change to EDGErepo's status: a phase built or done, a hand test added, run, passed or failed, a release, something EDGErepo starts or stops waiting on, something only the owner can do.
- **How:** in the sibling checkout `../EDGEweb`, `git pull`, edit only EDGErepo's object, set its `checkedBy` to this session and the date, bump the `?v=` on the `status.js` script tag in `docs/dashboard.html`, commit and push to `main` (as `CyberbuildsAI`). Leave `issues`, `lastTag`, `lastTagDate`, `lastCommit` and `commitsSinceTag` alone: EDGEweb's `tools/dashboard/refresh.py` writes those.
- **Words:** phases are `done`, `built, tests pending`, `in progress` or `planned`; tests are `passed`, `not run`, `partly run` or `failed`. The fields are described in EDGEweb's `CLAUDE.md`, under Dashboard.
- **Honest:** never mark a test passed or a phase done that this repo's own docs do not. A test with a step still to run is `partly run`.
