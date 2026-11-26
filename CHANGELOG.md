# EDGErepo changelog

What each move of a shared tag brought, newest first. Tools take a change at their next release run.

## On main, not on a tag yet

- **Nexus's field limits are checked first** (EDGErepo #1; README, "Nexus's field limits"): `check` and `release` stop before any upload when a file's description is over 255 characters with `{version}` filled in, or its name or version breaks Nexus's limits. A Nexus error shows its whole reason. Waits for the owner's word to move `v1`. Measured with a 7-character version on 2026-11-25, it would stop EDGEwave's second file (`voice`, 304 characters) and EDGEbuilder-cosmic (261); EDGEwave's main file is at 255 exactly.

## v1 (2026-11-18)

- **Nexus changelogs must be a short summary** (README, "Nexus changelogs"): `release` stops before any upload when its `--notes` have a line over 120 characters, more than 13 lines, markdown, or a line that does not start with `New:`, `Changed:`, `Fixed:`, `Removed:`, `Other:`, `Needs:` or `Full changelog:`. `check --notes` and a new offline `notes --notes` command check them early. This breaks every tool whose notes script still prints its changelog section's lines, and it went on `v1` on purpose, at the owner's choice: each tool writes a summary before its next release.

## v1 (2026-11-06)

The Nexus tool, from REDnode's copy, with these changes:

- A page can have other files beside the main one (`"files"` in `nexus.json`, `--file`), from EDGEwave's copy.
- `pull --ids-only` keeps the repo's description, from EDGEwave's copy. Some tools' docs already named it, but their copies ignored it.
- A run from a folder with no `nexus.json` says so.
- A failed run ends with exit code 1. It used to end with a crash code on Windows.
- The previous release's description is found however the repo's folder path is written, such as a short `RUNNER~1` name.
