# Publishing a release

The manual `Publish to PyPI` workflow builds a tagged revision, validates its
version, checks the distributions, and runs the tests against the installed
wheel before publishing. Only the publish job can request a short-lived PyPI
credential. It uses the `pypi` GitHub environment and no stored API token.

## One-time PyPI setup

In the `loco-agent` project's Publishing settings, add a GitHub trusted publisher:

- Owner: `ArielSmoliar`
- Repository: `loco-agent`
- Workflow: `publish.yml`
- Environment: `pypi`

Create the matching GitHub environment and restrict it to the `main` branch.
See [PyPI's trusted publisher setup](https://docs.pypi.org/trusted-publishers/adding-a-publisher/).

## Release steps

1. Update `pyproject.toml`, `loco.__version__`, and the changelog in a release PR.
2. Merge after CI passes, then tag that commit, for example `v0.4.1`.
3. Run `Publish to PyPI` from `main`, with that exact tag as its input.
   The tag must match the package version and belong to the history of `main`.
4. Confirm both distributions appear on PyPI. Install that version from PyPI
   in a fresh environment and verify its version and regression tests.
5. Download the run's `release-distributions` artifact and attach those same
   wheel and source files to the GitHub release, with the upgrade notes.

Do not replace a published version or suppress upload conflicts. If a release
is partially uploaded, inspect PyPI and the run logs before deciding how to
recover. Fixes to an already published package need a new version.
