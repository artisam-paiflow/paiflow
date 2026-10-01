# Hackathon team accounts and wallets

Run these commands **locally**, before the 6–7 Oct dry run. The two 1 Oct decisions in
[issue #726](https://github.com/webnxt-2030/pinkraft/issues/726) specify `team01`–`team12`
(10 teams plus 2 spares), with three organiser-created wallets per team and 1,000 testnet
USDC per wallet. Keys never go to the Paiflow server.

1. Create a **new testnet organiser wallet used only for this event**, and fund it with
   Friendbot. Use a local wallet tool; keep its secret out of command arguments and shell
   history. Set `STELLAR_NETWORK=testnet` and `HACKATHON_ORGANISER_SECRET` in your shell
   (for example, `read -rsp 'Organiser secret: ' HACKATHON_ORGANISER_SECRET; export HACKATHON_ORGANISER_SECRET`).
   Like `relayer:channels`, the script loads shell > `.env.local` > `.env`. Do not set the
   organiser secret on Railway or reuse Paiflow's relayer key.
2. Generate Paiflow logins and SQL:

   ```bash
   pnpm --silent testers:seed-sql --prefix team --from 1 --to 12 --pad 2 --credentials-dir hackathon-teams > /tmp/hackathon-seed.sql
   ```

   Paste the SQL statement into the **hackathon service's Railway data console**. Compare
   returned `hash_md5` values with the handouts before sharing passwords. Existing accounts
   are skipped and keep their old passwords. The command refuses to overwrite existing
   handouts; retain those files on subsequent runs. Without `--credentials-dir`, credentials
   still print to stderr; without `--pad`, numbering stays unpadded.

3. Provision wallets into the same directory:

   ```bash
   pnpm --silent hackathon:wallets --prefix team --from 1 --to 12 --pad 2 --wallets-per-team 3 --usdc 1000 --out-dir hackathon-teams --friendbot-topups 4
   ```

   Defaults are the values shown above, except topups default to zero. The script quotes
   the **whole missing USDC amount** from XLM before funding anyone, applies a 5% max-send
   cap, and stops if no path covers it or requested topups cannot cover XLM plus reserves
   and fees. On 1 Oct, 36,000 USDC was quoted at about 37,852 XLM; liquidity changes.
   Up to the requested number of throwaway Friendbot accounts are merged into the organiser
   only while XLM is insufficient. Then one strict-receive transaction buys the full shortfall;
   failure stops team funding. Wallets get Friendbot XLM, their own signed trustline, and
   the missing USDC. Stdout contains only the public summary table; planning/errors use stderr.

4. Share `hackathon-teams/<team>.md` **only with that team** at onboarding. It contains the
   login, three public/secret key pairs, and the testnet disclaimer. Files are mode `0600`
   in a `0700` directory. The default directory is git-ignored; keep any custom directory
   outside the repository or explicitly ignore it. Keep a private backup of the handouts.
   Teams may also create their own testnet wallets.

Re-run the wallet command after an interruption or testnet reset: it keeps saved keypairs,
recreates missing on-chain accounts/trustlines and pays only deficits. It never tops up a
wallet already holding at least the target. Sequential funding can stop on a later network
failure; keep the files and rerun to complete it. Do not run concurrent provisioning commands.
A hard-killed process may leave `.wallets-lock`; remove that directory only after confirming
no provisioning process is still running. An interrupted atomic file write can leave a
`*.tmp` file; it is private and can be removed after that check.

To reset a Paiflow password on the day, use the existing admin user password-reset flow;
update that team's private handout and share it only with the team. Do not rerun create-only
seed SQL expecting it to reset an account. After provisioning, `unset HACKATHON_ORGANISER_SECRET`.
