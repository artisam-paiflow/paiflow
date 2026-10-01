# Local pass

The checks from the [validation package](../../../deliverables/d4.md#final-ci-and-typecheck-pass), run
locally on the same code as the CI run. Each file is the command's output, with the
checkout path replaced by `<repo>`.

| File                                   | Command                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| [`environment.txt`](environment.txt)   | Commit, tree, date, and Node, pnpm, Rust and OS versions        |
| [`typecheck.txt`](typecheck.txt)       | `pnpm typecheck`                                                |
| [`test.txt`](test.txt)                 | `pnpm test`                                                     |
| [`cargo-test.txt`](cargo-test.txt)     | `cargo test --workspace`                                        |
| [`cargo-clippy.txt`](cargo-clippy.txt) | `cargo clippy --all-targets -- -D warnings`, from a clean build |
