{ pkgs }:

let
  # Node links shared Brotli in this archive. Apply the decoder fix to the
  # package fixed point so Node and Corepack's Node interpreter use the same
  # patched library, including its matching headers.
  patched = pkgs.appendOverlays [
    (_final: previous: {
      brotli = previous.brotli.overrideAttrs (old: {
        patches = (old.patches or [ ]) ++ [
          (previous.fetchurl {
            url = "https://github.com/google/brotli/commit/0ed4268a4401abcb4472096340477cf4af7d1a2b.patch";
            hash = "sha256-gzyh1x7thb3jwhxjpu4xATh3Qbiqi5qCJRNAlKZ3thk=";
          })
        ];
      });
    })
  ];
in
patched.buildEnv {
  name = "paiflow-node-runtime";
  paths = [
    patched.nodejs_22
    patched.corepack_22
    patched.openssl
  ];
}
