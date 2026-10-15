# P2.1 macOS Control-event contract

P2.1 provides a read-only, testable Node adapter for a real `CODEX-RUN` issue event from the private Control repository. It verifies the exact Control repository, issue author, strict title, JSON project/iteration, enabled local project registry entry, and the project’s active exact `review_route`. An optional `target_repo` must match the registry. The adapter never discovers or accepts a Chat URL from the issue body.

The normalized execution context separates Control provenance (repository, issue number, author, and canonical event digest) from the registry-authorized source repository. The normalized event’s repository is registry-derived solely for P1 compatibility; raw Control provenance remains private output. Output uses atomic 0600 files and 0700 parent directories, and the CLI prints only a summary.

P2.1 does not invoke a runner, browser, Chrome/CDP, Codex, or a target repository, and does not modify route registries. P2.2 must add the Mac runner wrapper integration, securely pass the trusted Control repository and users from runner configuration, invoke P1 failure handling, and preserve the same provenance/authorization boundary. Full E2E and target activation are outside this package.
