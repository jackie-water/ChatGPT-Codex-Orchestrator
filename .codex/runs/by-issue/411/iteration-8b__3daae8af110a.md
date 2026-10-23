# #411 iteration 8b — legacy registration static test compatibility after verified async fix

{
  "source_sha": "3daae8af110a74688a46f5315c8ff7ea909f0721",
  "source_parent": "8bca016da5367876233f18c38ccac51f9f258458",
  "source_branch": "feat/macos-first-runner-autoloop-m2-20261022",
  "previous_checkpoint": "ed0e475f67acfd03527a5858cda4497fe668454f",
  "predecessor_review_issue_comment": 6354255350,
  "execution_channel": "one-time Chat-approved local Mac Codex; NOT formally routed CODEX-RUN",
  "changed_paths": [
    "src/cli.mjs",
    "src/lib/macos-trusted-recovery-evidence.mjs",
    "tests/cli-macos-firstboot.test.mjs",
    "tests/macos-trusted-recovery-evidence.test.mjs"
  ],
  "source_hashes": {
    "src/cli.mjs": "a23b3cf81b6ddab328335c9ed5cfd4bf5a5c2384bb5d85e2fb5850401cfb5d4e",
    "src/lib/macos-trusted-recovery-evidence.mjs": "853683048ebba4c5218dc01037d039786f6d5a4136535e4225fbaf986cea5c0d",
    "tests/cli-macos-firstboot.test.mjs": "be7abe6a3993f0b05ece2631a016ba4b27246ed8fdccf63693c84163d3417e6b",
    "tests/macos-trusted-recovery-evidence.test.mjs": "abc44b0a6cbc7d7248e97ba75d1bf404477c6044203561e44e46264508529e46"
  },
  "wrapper": {
    "codex": {
      "exit_code": 0,
      "timed_out": false,
      "log_file": "codex.log",
      "log_sha256": "d6ac2b7087427196d3e800dc33b008959f52784b7aefc9875677e5740a650e20",
      "seconds": 36.483
    },
    "focused": {
      "exit_code": 0,
      "timed_out": false,
      "log_file": "focused.log",
      "log_sha256": "ab7a3a557b48066f63139370b5af9cc90ca8dce07f5ace6908a827fc5f38bfa2",
      "seconds": 2.366
    },
    "default": {
      "exit_code": 0,
      "timed_out": false,
      "log_file": "default.log",
      "log_sha256": "a16909f943215cf206ee9dd3bc973fc6f04e36be544f0c4c65c6b5265268c763",
      "seconds": 90.49
    },
    "serial": {
      "exit_code": 0,
      "timed_out": false,
      "log_file": "serial.log",
      "log_sha256": "68860db01c37d64a25fd3b17e197e53c1fa3449e03794e118f5d64f54f50d00f",
      "seconds": 145.889
    },
    "review": {
      "exit_code": 0,
      "timed_out": false,
      "log_file": "review.log",
      "log_sha256": "509b7956344bc0e6d52a48839c181ac769e36c7ad6838e12e9976c40cc098b03",
      "seconds": 189.294
    }
  },
  "prior_state_sha256": "f43a163883dfff5c25a83da5f1ee240c261e5c62e3e8b54060636fb1eba6ca21",
  "historical_control_unchanged": true,
  "runner_install_start_merge": false,
  "review_disposition": "PENDING_CHAT_ADJUDICATION"
}
