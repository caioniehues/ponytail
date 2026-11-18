#!/bin/sh
# npm run check:rust (fork #8, ADR 0002): builds the ponytail binary, replays the hook cases recorded from the JS
# (rust/cases/record.js) against it, then runs the gate. Local only: npm run check and CI leave the Rust alone.
set -e
cd "$(dirname "$0")/.."
cargo build --release --quiet --manifest-path rust/app/Cargo.toml
# rust/run-case.sh lists the files a case leaves, which replay does not compare on its own: the cases expect it.
rust-anything app replay . --build "sh rust/run-case.sh rust/app/target/release/ponytail"
# The gate: each unit crate, and fmt, clippy and tests on the front door, which gate does not take.
for crate in rust/*/; do
  if [ "$crate" != rust/app/ ] && [ -f "$crate/Cargo.toml" ]; then rust-anything gate "$crate"; fi
done
if grep -rnE '\b(todo|unimplemented)!' rust/app/src; then
  echo "check:rust: the front door has unimplemented code (above)" >&2
  exit 1
fi
cargo fmt --check --manifest-path rust/app/Cargo.toml
cargo clippy --release --quiet --manifest-path rust/app/Cargo.toml -- -D warnings
cargo test --release --quiet --manifest-path rust/app/Cargo.toml
