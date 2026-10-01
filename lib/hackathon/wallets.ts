import { Keypair } from "@stellar/stellar-sdk";

export const DISCLAIMER =
  "These are testnet wallets created by the organisers, who hold copies of their keys. Never send real (mainnet) funds to them or import them into a wallet you use for real money. Anyone with the key can take what's in them.";
export class ProvisionError extends Error {}

const SCALE = 10_000_000n;
const MAX = 9_223_372_036_854_775_807n;

export function stroops(amount: string): bigint {
  if (!/^\d+(\.\d{1,7})?$/.test(amount))
    throw new ProvisionError("Amount must be a nonnegative decimal with at most 7 places");
  const [whole, fraction = ""] = amount.split(".");
  const value = BigInt(whole!) * SCALE + BigInt(fraction.padEnd(7, "0"));
  if (value > MAX) throw new ProvisionError("Amount exceeds Stellar's limit");
  return value;
}
export function decimal(amount: bigint): string {
  if (amount < 0n || amount > MAX) throw new ProvisionError("Amount outside Stellar's limits");
  return `${amount / SCALE}.${String(amount % SCALE).padStart(7, "0")}`;
}
export type Wallet = { number: number; publicKey: string; secretKey: string };
export type Balance = { exists: boolean; xlm: string; usdc: string; trustline: boolean };

export function remainingWork(balance: Balance, target: string) {
  const missing = stroops(target) - stroops(balance.usdc);
  return {
    friendbot: !balance.exists,
    trustline: !balance.trustline,
    payment: decimal(missing > 0n ? missing : 0n),
  };
}
export function planShortfall(balances: Balance[], target: string, organiserUsdc: string) {
  const total = balances.reduce((sum, b) => sum + stroops(remainingWork(b, target).payment), 0n);
  const shortfall = total - stroops(organiserUsdc);
  return { total: decimal(total), shortfall: decimal(shortfall > 0n ? shortfall : 0n) };
}
export function maxSend(quotedXlm: string): string {
  return decimal((stroops(quotedXlm) * 105n + 99n) / 100n);
}

export function readWallets(content: string): Wallet[] {
  const marker = "\n## Wallets\n";
  if (!content.includes(marker)) {
    if (/Secret key:|## Wallets/.test(content))
      throw new ProvisionError("Malformed wallet section; refusing to replace keys");
    return [];
  }
  const section = content.slice(content.indexOf(marker));
  const matches = [
    ...section.matchAll(
      /### Wallet (\d+)\n\nPublic key: (G[A-Z2-7]{55})\nSecret key: (S[A-Z2-7]{55})\n/g,
    ),
  ];
  if (
    matches.length !== (section.match(/### Wallet|Secret key:/g)?.length ?? 0) / 2 ||
    matches.length === 0
  ) {
    throw new ProvisionError("Malformed wallet section; refusing to replace keys");
  }
  const wallets = matches.map((m) => ({
    number: Number(m[1]),
    publicKey: m[2]!,
    secretKey: m[3]!,
  }));
  const seen = new Set<string>();
  for (const [i, w] of wallets.entries()) {
    try {
      if (
        w.number !== i + 1 ||
        Keypair.fromSecret(w.secretKey).publicKey() !== w.publicKey ||
        seen.has(w.publicKey)
      )
        throw new ProvisionError();
    } catch {
      throw new ProvisionError("Invalid saved wallet; refusing to replace keys");
    }
    seen.add(w.publicKey);
  }
  return wallets;
}
export function renderTeamFile(existing: string, wallets: Wallet[]): string {
  const marker = "\n## Wallets\n";
  const saved = readWallets(existing);
  if (
    saved.some(
      (w, i) => wallets[i]?.secretKey !== w.secretKey || wallets[i]?.publicKey !== w.publicKey,
    ) ||
    wallets.length < saved.length
  ) {
    throw new ProvisionError("Refusing to replace saved wallet keys");
  }
  const header = existing.includes(marker)
    ? existing.trimEnd() + (existing.includes(DISCLAIMER) ? "" : `\n\n${DISCLAIMER}`)
    : `${existing.trimEnd()}${marker}\n${DISCLAIMER}`;
  const added = wallets.slice(saved.length);
  if (added.length === 0) return `${header}\n`;
  return `${header}\n\n${added.map((w) => `### Wallet ${w.number}\n\nPublic key: ${w.publicKey}\nSecret key: ${w.secretKey}\n`).join("\n")}`;
}

export type FundingNetwork = {
  balance(publicKey: string): Promise<Balance>;
  friendbot(publicKey: string): Promise<void>;
  trust(wallet: Wallet): Promise<void>;
  pay(publicKey: string, amount: string): Promise<void>;
};
/** Re-read chain state before each payment; a restart after confirmed payment cannot double fund. */
export async function completeWallet(
  wallet: Wallet,
  target: string,
  network: FundingNetwork,
): Promise<Balance> {
  let balance = await network.balance(wallet.publicKey);
  if (remainingWork(balance, target).friendbot) await network.friendbot(wallet.publicKey);
  balance = await network.balance(wallet.publicKey);
  if (remainingWork(balance, target).trustline) await network.trust(wallet);
  balance = await network.balance(wallet.publicKey);
  const payment = remainingWork(balance, target).payment;
  if (stroops(payment) > 0n) await network.pay(wallet.publicKey, payment);
  return network.balance(wallet.publicKey);
}

export type PathQuote = {
  source_asset_type: string;
  source_amount: string;
  destination_amount: string;
};
/** Query the full shortfall once. Partial paths never authorize funding. */
export async function quoteShortfall<T extends PathQuote>(
  shortfall: string,
  load: (amount: string) => Promise<T[]>,
): Promise<T | undefined> {
  if (stroops(shortfall) === 0n) return undefined;
  const paths = await load(shortfall);
  const whole = paths.filter(
    (p) =>
      p.source_asset_type === "native" &&
      stroops(p.destination_amount) === stroops(shortfall) &&
      stroops(p.source_amount) > 0n,
  );
  const quote = whole.sort((a, b) =>
    stroops(a.source_amount) < stroops(b.source_amount) ? -1 : 1,
  )[0];
  if (!quote)
    throw new ProvisionError(
      "No strict-receive path covers the entire USDC shortfall; nobody funded",
    );
  return quote;
}
