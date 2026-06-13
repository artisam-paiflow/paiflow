#!/usr/bin/env bash

# Exit immediately if a command fails, an unset variable is referenced, or a pipe fails
set -euo pipefail

# 1. Dynamically detect the correct target directory
if [ -d "target/wasm32v1-none/release" ]; then
    SRC_DIR="target/wasm32v1-none/release"
elif [ -d "contracts/target/wasm32v1-none/release" ]; then
    SRC_DIR="contracts/target/wasm32v1-none/release"
else
    echo "❌ Error: Could not find WASM release directory."
    echo "Please ensure you have run your workspace build step first."
    exit 1
fi

OPT_DIR="target/optimized"
mkdir -p "$OPT_DIR"

# 2. Check for dependencies
for cmd in wasm-opt stellar jq curl awk; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "❌ Error: Required command '$cmd' is not installed."
        exit 1
    fi
done

# 3. Optimize all WASM artifacts found in the target directory
echo "🚀 Step 1: Optimizing WASM files with wasm-opt..."
wasm_files=("$SRC_DIR"/*.wasm)

if [ ! -e "${wasm_files[0]}" ]; then
    echo "❌ Error: No .wasm files found in $SRC_DIR"
    exit 1
fi

for wasm_file in "${wasm_files[@]}"; do
    base_name=$(basename "$wasm_file" .wasm)
    echo "  📦 Optimizing $base_name..."
    wasm-opt -Oz "$wasm_file" -o "$OPT_DIR/optimized_${base_name}.wasm"
done

echo "✅ Optimization complete. Outputs stored in $OPT_DIR"

# 4. Handle credential input securely
if [ -z "${FREIGHTER_SEED:-}" ]; then
    echo -n "🔑 Enter FREIGHTER_SEED (input will be hidden): "
    read -s FREIGHTER_SEED
    echo ""
fi

if [ -z "$FREIGHTER_SEED" ]; then
    echo "❌ Error: FREIGHTER_SEED cannot be empty."
    exit 1
fi

# Use env var for RPC endpoint instead of hardcoded URL
if [ -z "${STELLAR_SOROBAN_RPC_URL_MAINNET:-}" ]; then
    echo "❌ Error: STELLAR_SOROBAN_RPC_URL_MAINNET env var is required."
    echo "Example: export STELLAR_SOROBAN_RPC_URL_MAINNET='https://mainnet.sorobanrpc.com'"
    exit 1
fi

# 5. Loop through optimized binaries and estimate upload costs
echo -e "\n📊 Step 2: Estimating Mainnet Upload Costs via RPC..."
echo "----------------------------------------------------------------------"

for opt_wasm in "$OPT_DIR"/*.wasm; do
    [ -e "$opt_wasm" ] || continue
    wasm_name=$(basename "$opt_wasm" .wasm)

    # Build the base64 XDR safely without broadcasting
    XDR=$(stellar contract upload --wasm "$opt_wasm" --source "$FREIGHTER_SEED" --hd-path 0 --network mainnet --build-only 2>/dev/null || true)

    if [ -z "$XDR" ]; then
        echo "❌ $wasm_name : Failed to generate transaction XDR. (Check your seed phrase layout)"
        continue
    fi

    # Structure payload using safe variable mapping in jq
    body=$(jq -n -c --arg xdr "$XDR" '{jsonrpc: "2.0", id: 1, method: "simulateTransaction", params: {transaction: $xdr}}')

    # Query simulation node
    resp=$(curl -s -X POST "$STELLAR_SOROBAN_RPC_URL_MAINNET" \
        -H "Content-Type: application/json" \
        -d "$body")

    # Safely extract values or defaults if errors occur
    fee_stroops=$(echo "$resp" | jq -r '.result.minResourceFee // empty')

    if [ -z "$fee_stroops" ] || [ "$fee_stroops" = "null" ]; then
        error_msg=$(echo "$resp" | jq -r '.error.message // "Simulation rejected by node"')
        echo "❌ $wasm_name : Simulation failed ($error_msg)"
        continue
    fi

    # Convert Stroops to XLM using awk to keep clean floating-point zero formatting
    fee_xlm=$(awk "BEGIN {printf \"%.7f\", $fee_stroops / 10000000}")

    echo "💵 $wasm_name : $fee_stroops stroops = $fee_xlm XLM"
done

echo "----------------------------------------------------------------------"
