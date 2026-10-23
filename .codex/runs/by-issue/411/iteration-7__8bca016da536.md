# #411 iteration 7 — saved source supervisor identity correction

{
  "source_sha": "8bca016da5367876233f18c38ccac51f9f258458",
  "parent": "7ac8a32f43ccc5698a0f76c36499afb0d391d8fc",
  "branch": "feat/macos-first-runner-autoloop-m2-20261022",
  "prior_review_comment": 6339712462,
  "user_approved_in_originating_chat": true,
  "codex_implementation": "REUSED_COMPLETED_ITER7_CLI_DELTA_NO_REPLAY",
  "validation_fix": "UNIT_TEST_CHILD_UMASK_0022_PARENT_PRIVATE_0077",
  "previous_iteration7_stop_sha256": "406227172da77f55331ae8c43e877bea5958f36b428e15711ff58b5ee5b40319",
  "trust_model": "personal-trusted-user-v1",
  "changed_paths": [
    "AI_INSTALL.md",
    "src/cli.mjs",
    "src/lib/macos-personal-use-service.mjs",
    "src/lib/macos-platform.mjs",
    "src/lib/macos-runner-bootstrap.mjs",
    "tests/cli-macos-firstboot.test.mjs",
    "tests/macos-personal-use-service.test.mjs",
    "tests/macos-runner-bootstrap.test.mjs"
  ],
  "source_hashes": {
    "AI_INSTALL.md": "97bf1f8d32d60c759fadd6140028f55ffeb993d85497d99013f9f346ccd7a0b4",
    "src/cli.mjs": "f8523a48a7b6da416d42f8c9dff9f5843946b1676ddc78b9b30f1a928c7e0fd2",
    "src/lib/macos-personal-use-service.mjs": "76113c671fec66ac7c2946a44ccb46728c3f9bd142c84af029bf16a8c04fc74b",
    "src/lib/macos-platform.mjs": "b4f07ffcfe6d981c902f839e81087a11c544816e2526fc7987a3565224779fda",
    "src/lib/macos-runner-bootstrap.mjs": "78923ad8858129bbd876a614a88a97da9355f1b5f08922e91e3fe97dea51f60c",
    "tests/cli-macos-firstboot.test.mjs": "476f90fd158d4951bf181facf55b90c4481a4ac83170e17e31ae1b8f93129d39",
    "tests/macos-personal-use-service.test.mjs": "dc1a49b5ac66b793bf3dbc917851535d0d6f15d9178bc5b14745676764bfa325",
    "tests/macos-runner-bootstrap.test.mjs": "e866f0c22dde7ac11e5856b837dc3828f12102af9ce56718975c433b3c961120"
  },
  "validation": {
    "archive": {
      "exit_code": 0,
      "timed_out": false,
      "log_sha256": "a2039a175047ba4f1ba2982f614360712f13edf52a44997fa5aaff3a1146b41e",
      "log_file": "archive.log",
      "duration_seconds": 0.953
    },
    "focused": {
      "exit_code": 0,
      "timed_out": false,
      "log_sha256": "995505a53e67c0f8356dc96bf2cefb0c942f3ceb0c634b7558c09806ee4e3171",
      "log_file": "focused.log",
      "duration_seconds": 3.193
    },
    "default": {
      "exit_code": 0,
      "timed_out": false,
      "log_sha256": "4c1a90bc3c935d16ae325cdf2b1299b1c77d5e563333f54eb330f6f02d8d4915",
      "log_file": "default.log",
      "duration_seconds": 90.397
    },
    "serial": {
      "exit_code": 0,
      "timed_out": false,
      "log_sha256": "787db9d86c57638053d6373a1e51f3d62fdab478ad6ff741e5537a8f94102360",
      "log_file": "serial.log",
      "duration_seconds": 148.755
    },
    "review": {
      "exit_code": 0,
      "timed_out": false,
      "log_sha256": "7b91f54ff24653b31ec16f46bc938fce69a11882dd0ad54c5f091f82a3b801d9",
      "log_file": "review.log",
      "duration_seconds": 230.624
    }
  },
  "official_asset": {
    "sha256": "df4cebda25c86a886ed204e49fee63f5c2e7cec5f447b5c98440a826bbdf9df2",
    "bytes": 128562863
  },
  "legacy_unchanged": true,
  "no_live_install_start_or_merge": true,
  "chat_adjudication": "PENDING"
}
