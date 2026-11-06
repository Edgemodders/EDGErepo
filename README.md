# EDGErepo

Scripts shared by the Edgemodders tools, kept in one place so a fix reaches every tool.

Today it holds the Nexus Mods release tool, `tools/nexus/`. The plan and what may join it later: [REDnode's docs/edgerepo.md](https://github.com/Edgemodders/REDnode/blob/main/docs/edgerepo.md).

## The Nexus tool

It keeps a tool's Nexus Mods page in step with its repo: the upload, the changelog and the description. Each tool keeps its own `nexus/nexus.json` and `nexus/description.bbcode`. Always run the tool from that tool's repo folder.

| Where | How |
|---|---|
| On a PC | Check this repo out beside the tool's, then `node ../EDGErepo/tools/nexus/nexus.mjs status` from the tool's folder |
| In a release workflow | Clone the shared tag, then run it from the clone (below) |

The commands and the settings in `nexus.json` are at the top of [nexus.mjs](tools/nexus/nexus.mjs).

```yaml
- name: The Nexus tool
  run: git -c advice.detachedHead=false clone --quiet --depth 1 --branch v1 https://github.com/Edgemodders/EDGErepo "$RUNNER_TEMP/EDGErepo"

- name: Nexus Mods can take this release
  env:
    NEXUS_KEY: ${{ secrets.NEXUS_KEY }}
  run: node "$RUNNER_TEMP/EDGErepo/tools/nexus/nexus.mjs" check --version "${VERSION}"
```

That is for a `bash` step. In PowerShell the path is `"$env:RUNNER_TEMP/EDGErepo/tools/nexus/nexus.mjs"`. The clone goes outside the workspace so that no package or zip picks it up. It needs no credentials, since this repo is public.

## The tag

Workflows use the tag `v1`, and every release run takes what `v1` names at that moment. To reach every tool with a change:

1. Push it to `main` and wait for the **Check** workflow to pass.
2. Add a line to [CHANGELOG.md](CHANGELOG.md).
3. Move the tag: `git tag -f v1` and `git push -f origin v1`.

A change that would break a tool's workflow or `nexus.json` gets a new tag, `v2`, and each tool moves to it in its own commit.

**Who can change this:** the script runs in each tool's release with the organization's `NEXUS_KEY` secret, so anyone who can move `v1` can run code with that key. Only people with write access to this repo can move the tag. The key reaches the script only through the steps that name it, and the script sends it only in the `apikey` header to Nexus.

## Checks

`node tools/nexus/check.mjs` runs the tool from a scratch repo against a stand-in for Nexus's API. It uses no real key and reaches nothing on Nexus. The **Check** workflow runs it on every push.

## License

MIT. See [LICENSE](LICENSE).
