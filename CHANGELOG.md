# EDGErepo changelog

What each move of a shared tag brought, newest first. Tools take a change at their next release run.

## v1 (2026-11-06)

The Nexus tool, from REDnode's copy, with these changes:

- A page can have other files beside the main one (`"files"` in `nexus.json`, `--file`), from EDGEwave's copy.
- `pull --ids-only` keeps the repo's description, from EDGEwave's copy. Some tools' docs already named it, but their copies ignored it.
- A run from a folder with no `nexus.json` says so.
- A failed run ends with exit code 1. It used to end with a crash code on Windows.
