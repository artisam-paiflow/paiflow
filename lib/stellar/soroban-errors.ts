/**
 * Translates raw Soroban simulation/invocation errors into user-friendly text.
 *
 * This module is intentionally pure (no server-only / next imports) so it can
 * be used both by the server-side prepare functions (lib/stellar/deploy.ts,
 * lib/stellar/invoke.ts) and by the client-side friendlyError backstop.
 *
 * The contract error tables mirror the #[contracterror] enums in contracts/.
 * When a contract's error enum changes, update the matching table here.
 */

export type ContractErrorKey =
  | "streamer"
  | "splitter"
  | "splitter_dev"
  | "swapper"
  | "soroswap_router"
  | "soroswap_factory"
  | "yield"
  | "payer"
  | "payer_dev"
  | "payroll"
  | "cash_out"
  | "cash_out_dev"
  | "conditional"
  | "router"
  | "timelock"
  | "multisig"
  | "deposit_trigger"
  | "webhook"
  | "subscription"
  | "subscription_dev"
  | "oracle";

type ContractErrorEntry = { name: string; friendly: string };

const ALREADY_INITIALIZED: ContractErrorEntry = {
  name: "AlreadyInitialized",
  friendly: "This contract has already been initialized.",
};

/**
 * Error code → friendly message, per contract. Codes come from each
 * contract's #[contracterror] enum (see contracts/<name>/src/lib.rs).
 */
export const CONTRACT_ERRORS: Record<ContractErrorKey, Record<number, ContractErrorEntry>> = {
  streamer: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "Unauthorized",
      friendly: "The asset being sent doesn't match the asset this stream was configured for.",
    },
    3: {
      name: "NothingToClaim",
      friendly: "There is nothing to claim yet — no funds have vested.",
    },
    4: {
      name: "BadWindow",
      friendly:
        "The schedule is invalid: the end time must be after the start time, and the amount and interval must be positive.",
    },
    5: {
      name: "BpsSumInvalid",
      friendly: "Recipient percentages must add up to exactly 100%.",
    },
    6: {
      name: "NoRecipients",
      friendly: "The stream needs at least one recipient.",
    },
    7: { name: "Paused", friendly: "This stream is paused." },
    8: {
      name: "PauseNotAllowed",
      friendly: "This stream was not configured to allow pausing.",
    },
    9: {
      name: "RetrieveNotAllowed",
      friendly: "This stream was not configured to allow retrieving unvested funds.",
    },
    10: {
      name: "NotPaused",
      friendly: "The stream must be paused before unvested funds can be retrieved.",
    },
    11: {
      name: "NothingToRetrieve",
      friendly: "There are no unvested funds to retrieve.",
    },
  },
  splitter: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "BpsSumInvalid",
      friendly: "Recipient percentages must add up to exactly 100%.",
    },
    3: {
      name: "NoRecipients",
      friendly: "The split needs at least one recipient.",
    },
    4: { name: "Paused", friendly: "This split contract is paused." },
    5: {
      name: "Unauthorized",
      friendly: "The asset being sent doesn't match the asset this split was configured for.",
    },
    6: {
      name: "InvalidAmount",
      friendly: "The amount is invalid — it must be positive and above the configured minimum.",
    },
    7: {
      name: "MixedModeNotAllowed",
      friendly: "Recipients can't mix percentage and fixed-amount modes.",
    },
  },
  splitter_dev: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "BpsSumInvalid",
      friendly: "Recipient percentages must add up to exactly 100%.",
    },
    3: {
      name: "NoRecipients",
      friendly: "The split needs at least one recipient.",
    },
    4: { name: "Paused", friendly: "This split contract is paused." },
    5: {
      name: "Unauthorized",
      friendly: "This action requires the admin or relayer, or the asset doesn't match.",
    },
    6: {
      name: "InvalidAmount",
      friendly: "The amount is invalid — it must be positive and above the configured minimum.",
    },
    7: {
      name: "MixedModeNotAllowed",
      friendly: "Recipients can't mix percentage and fixed-amount modes.",
    },
    8: {
      name: "NotConfigured",
      friendly: "This contract hasn't been configured yet — fill in the recipients first.",
    },
  },
  swapper: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "Unauthorized",
      friendly: "The asset being sent doesn't match the swap's configured input asset.",
    },
    3: {
      name: "InvalidAmount",
      friendly: "The swap amount must be positive.",
    },
    4: {
      name: "InsufficientOutput",
      friendly:
        "The swap returned less than the minimum allowed by the slippage setting, or nothing at all.",
    },
    5: {
      name: "BadSlippage",
      friendly: "Max slippage must be between 0% and 100%.",
    },
    6: {
      name: "BadDeadline",
      friendly: "The swap deadline must be at least 1 second.",
    },
    7: {
      name: "TooManyNextSteps",
      friendly: "A swap can forward to only one next step.",
    },
    8: {
      name: "NoNextStep",
      friendly:
        "A swap needs a next step to send its output to. Connect the swap to a payout step and redeploy.",
    },
  },
  // Soroswap router (CombinedRouterError in soroswap/core). Not a Paiflow
  // template; reached through `addressMap` on the trigger path.
  soroswap_router: {
    503: {
      name: "RouterDeadlineExpired",
      friendly: "The swap's deadline passed before it executed. Try again.",
    },
    507: {
      name: "RouterInsufficientOutputAmount",
      friendly:
        "Soroswap would return less than the minimum allowed by the swap's slippage setting. Raise the max slippage or swap a smaller amount.",
    },
    // Unreachable on the current swapper path: do_swap calls factory.get_pair
    // before the router, so a missing pool raises FactoryError::PairDoesNotExist
    // (see soroswap_factory below). Kept because the code is real in
    // CombinedRouterError and any path that calls the router without that
    // pre-step will raise it.
    509: {
      name: "RouterPairDoesNotExist",
      friendly: "Soroswap has no liquidity pool for this asset pair on this network.",
    },
    511: {
      name: "LibraryInsufficientLiquidity",
      friendly: "The Soroswap pool for this pair has no liquidity.",
    },
    513: {
      name: "LibraryInsufficientOutputAmount",
      friendly:
        "Soroswap would return less than the minimum allowed by the swap's slippage setting. Raise the max slippage or swap a smaller amount.",
    },
    514: {
      name: "LibraryInvalidPath",
      friendly: "The swap path is invalid.",
    },
  },
  // Soroswap factory (FactoryError in soroswap/core
  // contracts/factory-interface/src/error.rs; band is 201-206, read 2026-09-07).
  // do_swap resolves the pair through the factory before it touches the router,
  // so this is the frame a missing pool actually fails in. Only 205 is listed
  // because get_pair is the sole factory call on the swap path — the rest of the
  // band belongs to create_pair / initialize / all_pairs, which Paiflow never
  // calls.
  soroswap_factory: {
    205: {
      name: "PairDoesNotExist",
      friendly: "Soroswap has no liquidity pool for this asset pair on this network.",
    },
  },
  yield: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "Unauthorized",
      friendly: "The asset being sent doesn't match the asset this contract was configured for.",
    },
    3: {
      name: "InvalidAmount",
      friendly: "The amount must be positive.",
    },
  },
  payer: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "Unauthorized",
      friendly: "The asset being sent doesn't match the asset this payment was configured for.",
    },
    3: {
      name: "InvalidAmount",
      friendly: "The payment amount must be positive (or a percentage must be configured).",
    },
  },
  payer_dev: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "Unauthorized",
      friendly: "This action requires the admin or relayer, or the asset doesn't match.",
    },
    3: {
      name: "InvalidAmount",
      friendly: "The payment amount must be positive (or a percentage must be configured).",
    },
    4: {
      name: "NotConfigured",
      friendly: "This contract hasn't been configured yet — fill in the payment details first.",
    },
  },
  payroll: {
    1: ALREADY_INITIALIZED,
    2: { name: "Unauthorized", friendly: "This action isn't authorized." },
    3: {
      name: "InvalidAmount",
      friendly:
        "The payroll configuration is invalid: the end time must be after the start time and recipient amounts must be positive.",
    },
    4: {
      name: "AlreadyCancelled",
      friendly: "This payroll has already been cancelled.",
    },
    5: {
      name: "NotYetDue",
      friendly: "The next payroll charge isn't due yet.",
    },
    6: { name: "PayrollEnded", friendly: "This payroll has ended." },
    7: { name: "NotCancelled", friendly: "This payroll isn't cancelled." },
    8: {
      name: "NoRecipients",
      friendly: "The payroll needs at least one recipient.",
    },
  },
  cash_out: {
    1: ALREADY_INITIALIZED,
    2: { name: "Paused", friendly: "This cash-out contract is paused." },
    3: { name: "Unauthorized", friendly: "This action isn't authorized." },
    4: {
      name: "InvalidAmount",
      friendly: "The amount must be positive and the asset must match the configured one.",
    },
    5: {
      name: "InvalidBank",
      friendly:
        "The bank details are incomplete — account name, account number, and bank are all required.",
    },
  },
  cash_out_dev: {
    1: ALREADY_INITIALIZED,
    2: { name: "Paused", friendly: "This cash-out contract is paused." },
    3: {
      name: "Unauthorized",
      friendly: "This action requires the admin or relayer, or the asset doesn't match.",
    },
    4: {
      name: "InvalidAmount",
      friendly: "The amount must be positive.",
    },
    5: {
      name: "InvalidBank",
      friendly:
        "The bank details are incomplete — account name, account number, and bank are all required.",
    },
    6: {
      name: "NotConfigured",
      friendly: "This contract hasn't been configured yet — fill in the bank details first.",
    },
  },
  conditional: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "AlreadyReleased",
      friendly: "The funds have already been released.",
    },
    3: {
      name: "ConditionNotMet",
      friendly: "The release condition hasn't been met yet.",
    },
    4: {
      name: "Unauthorized",
      friendly: "The asset being sent doesn't match the asset this contract was configured for.",
    },
    5: {
      name: "BpsSumInvalid",
      friendly: "Recipient percentages must add up to exactly 100%.",
    },
    6: {
      name: "NoRecipients",
      friendly: "The contract needs at least one recipient.",
    },
    7: {
      name: "OracleCallFailed",
      friendly: "The price check failed — the oracle could not be read.",
    },
  },
  router: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "Unauthorized",
      friendly: "The asset being sent doesn't match the asset this contract was configured for.",
    },
    3: {
      name: "InvalidAmount",
      friendly: "The amount must be positive.",
    },
  },
  timelock: {
    1: ALREADY_INITIALIZED,
    2: { name: "Unauthorized", friendly: "This action isn't authorized." },
    3: {
      name: "ConditionNotMet",
      friendly: "The timelock window doesn't allow release at this time.",
    },
    4: {
      name: "NothingToRelease",
      friendly: "There's no balance to release.",
    },
    5: {
      name: "Overflow",
      friendly: "The amount overflowed — try a smaller amount.",
    },
  },
  multisig: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "Unauthorized",
      friendly:
        "The multisig configuration is invalid, or the asset doesn't match the configured one.",
    },
    3: {
      name: "InvalidAmount",
      friendly: "The amount must be positive.",
    },
    4: {
      name: "NotASigner",
      friendly: "Only a configured signer can approve this release.",
    },
    5: {
      name: "AlreadyApproved",
      friendly: "This signer has already approved.",
    },
    6: {
      name: "ThresholdNotMet",
      friendly: "Not enough approvals yet to release.",
    },
    7: {
      name: "NothingToRelease",
      friendly: "There's no balance to release.",
    },
    8: {
      name: "Overflow",
      friendly: "The amount overflowed — try a smaller amount.",
    },
  },
  deposit_trigger: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "InvalidAmount",
      friendly: "The deposit amount must be positive.",
    },
  },
  webhook: {
    1: ALREADY_INITIALIZED,
    2: { name: "Unauthorized", friendly: "This action isn't authorized." },
    3: {
      name: "InvalidAmount",
      friendly: "The amount must be positive.",
    },
    4: {
      name: "InsufficientBalance",
      friendly: "The contract doesn't hold enough balance to cover this payout.",
    },
  },
  subscription: {
    1: ALREADY_INITIALIZED,
    2: { name: "Unauthorized", friendly: "This action isn't authorized." },
    3: {
      name: "InvalidAmount",
      friendly:
        "The subscription configuration is invalid: the end time must be after the start time and the amount must be positive.",
    },
    4: {
      name: "AlreadyCancelled",
      friendly: "This subscription has already been cancelled.",
    },
    5: {
      name: "NotYetDue",
      friendly: "The next subscription charge isn't due yet.",
    },
    6: { name: "SubscriptionEnded", friendly: "This subscription has ended." },
    7: { name: "NotCancelled", friendly: "This subscription isn't cancelled." },
  },
  subscription_dev: {
    1: ALREADY_INITIALIZED,
    2: {
      name: "Unauthorized",
      friendly: "This action requires the admin or relayer.",
    },
    3: {
      name: "InvalidAmount",
      friendly:
        "The subscription configuration is invalid: the end time must be after the start time and the amount must be positive.",
    },
    4: {
      name: "AlreadyCancelled",
      friendly: "This subscription has already been cancelled.",
    },
    5: {
      name: "NotYetDue",
      friendly: "The next subscription charge isn't due yet.",
    },
    6: { name: "SubscriptionEnded", friendly: "This subscription has ended." },
    7: { name: "NotCancelled", friendly: "This subscription isn't cancelled." },
    8: {
      name: "NotConfigured",
      friendly: "This subscription hasn't been configured yet — fill in the details first.",
    },
  },
  oracle: {
    1: ALREADY_INITIALIZED,
    2: { name: "Unauthorized", friendly: "This action isn't authorized." },
    3: {
      name: "InvalidAmount",
      friendly: "The amount must be positive.",
    },
    4: {
      name: "ThresholdNotMet",
      friendly: "The oracle price hasn't reached the configured threshold.",
    },
  },
};

/** Prisma TemplateKind enum value → contract error table key. */
export function contractKeyForTemplate(templateKind: string): ContractErrorKey | undefined {
  switch (templateKind) {
    case "SPLITTER":
      return "splitter";
    case "STREAMER":
      return "streamer";
    case "CONDITIONAL":
      return "conditional";
    case "DEPOSIT_TRIGGER":
      return "deposit_trigger";
    case "ROUTER":
      return "router";
    case "TIMELOCK":
      return "timelock";
    case "WEBHOOK":
      return "webhook";
    case "SUBSCRIPTION":
      return "subscription";
    case "ORACLE":
      return "oracle";
    case "MULTISIG":
      return "multisig";
    case "SWAPPER":
      return "swapper";
    case "YIELD":
      return "yield";
    case "PAYER":
      return "payer";
    case "PAYROLL":
      return "payroll";
    case "PAYER_DEV":
      return "payer_dev";
    case "SPLITTER_DEV":
      return "splitter_dev";
    case "SUBSCRIPTION_DEV":
      return "subscription_dev";
    case "CASH_OUT_DEV":
      return "cash_out_dev";
    case "CASH_OUT":
      return "cash_out";
    default:
      return undefined; // FACTORY has no error enum
  }
}

/** PipelineNodeParams["kind"] (snake_case) → contract error table key. */
export function contractKeyForParamsKind(kind: string): ContractErrorKey | undefined {
  switch (kind) {
    case "webhook_trigger":
      return "webhook";
    case "subscription_trigger":
      return "subscription";
    case "subscription_dev_trigger":
      return "subscription_dev";
    case "payroll_trigger":
      return "payroll";
    case "oracle_trigger":
      return "oracle";
    default:
      return CONTRACT_ERRORS[kind as ContractErrorKey] ? (kind as ContractErrorKey) : undefined;
  }
}

export type SorobanErrorHint = {
  /** The known contract being invoked/deployed (when unambiguous). */
  contract?: ContractErrorKey;
  /** Deployed contract address → contract key, for multi-contract pipelines. */
  addressMap?: Record<string, ContractErrorKey>;
};

export type SorobanErrorTranslation = {
  friendly: string;
  /** true when a specific contract/host error was identified. */
  matched: boolean;
  /** Contract error variant name (e.g. "BadWindow"), when identified. */
  errorName?: string;
};

/**
 * Diagnostic events are logged newest-first, so the first Error(Contract, N)
 * belongs to the innermost (most relevant) failure. The address on the same
 * event identifies which contract in a pipeline rejected.
 */
/**
 * Every diagnostic entry whose topics carry a contract error, in log order.
 * The simulate log is newest-first: when a contract error escalates through
 * a pipeline (deposit trigger → swapper → Soroswap router), the outermost
 * frame comes first and the frame that originated the error comes last.
 */
function findContractErrors(raw: string): Array<{ address: string; code: number }> {
  const out: Array<{ address: string; code: number }> = [];
  const re = /contract:(C[A-Z0-9]{55}),\s*topics:\[error,\s*Error\(Contract,\s*#?(\d+)\)\]/g;
  for (const m of raw.matchAll(re)) {
    out.push({ address: m[1]!, code: Number(m[2]) });
  }
  return out;
}

function findContractError(raw: string): { address?: string; code: number } | undefined {
  const withAddress = /contract:(C[A-Z0-9]{55})[\s\S]{0,500}?Error\(Contract,\s*#?(\d+)\)/.exec(
    raw,
  );
  if (withAddress) {
    return { address: withAddress[1], code: Number(withAddress[2]) };
  }
  const codeOnly = /Error\(Contract,\s*#?(\d+)\)/.exec(raw);
  if (codeOnly) {
    return { code: Number(codeOnly[1]) };
  }
  return undefined;
}

/** Host-level failure signatures, most specific first. */
const HOST_PATTERNS: Array<[RegExp, string]> = [
  [
    /insufficient balance/i,
    "Insufficient balance to cover this transaction. Check the account balance and try again.",
  ],
  [
    /live_until is greater than max/i,
    "The approval expiration is beyond the network maximum. Please try again.",
  ],
  [
    /create_contract_with_constructor/i,
    "The contract rejected its configuration during deployment. Check the flow's settings and try again.",
  ],
  [/ExceededLimit/, "The transaction exceeded network resource limits. Try a smaller amount."],
  [
    /MissingValue/,
    "A required on-chain value was missing — the account or trustline may not exist, or its state has expired.",
  ],
  [
    /require_auth|InvalidSignature|authorization/i,
    "Authorization failed — a required signature or permission is missing.",
  ],
  [/InvalidAction/, "The contract rejected this action."],
  [/UnexpectedType/, "The contract received a value of an unexpected type."],
  [/expired/i, "Some on-chain state has expired. Please try again."],
];

const GENERIC_FRIENDLY =
  "The Stellar network rejected this transaction during pre-flight simulation. Expand the details for the technical error.";

/**
 * Translate a raw Soroban error string (simulation error, HostError dump,
 * diagnostic event log) into user-friendly text.
 */
export function translateSorobanError(
  raw: string,
  hint?: SorobanErrorHint,
): SorobanErrorTranslation {
  // Walk the error-bearing frames from the originator outwards and take the
  // first one we have a table entry for, so a Soroswap router revert reads as
  // the router's message rather than "the deposit trigger rejected #507".
  for (const frame of findContractErrors(raw).reverse()) {
    // The `hint.contract` fallback is per-frame, so with a `{ contract }`-only
    // hint (every caller of simulationFailure except the trigger path) an
    // unmapped inner frame's code is looked up in the hinted contract's table.
    // Pass an `addressMap` whenever more than one contract can be reached.
    const key = hint?.addressMap?.[frame.address] ?? hint?.contract;
    const entry = key ? CONTRACT_ERRORS[key][frame.code] : undefined;
    if (entry) {
      return { friendly: entry.friendly, matched: true, errorName: entry.name };
    }
  }
  const contractError = findContractError(raw);
  if (contractError) {
    const key =
      (contractError.address && hint?.addressMap?.[contractError.address]) ?? hint?.contract;
    const entry = key ? CONTRACT_ERRORS[key][contractError.code] : undefined;
    if (entry) {
      return { friendly: entry.friendly, matched: true, errorName: entry.name };
    }
    if (contractError.code) {
      return {
        friendly: `The contract rejected the transaction (error #${contractError.code}). Expand the details for more information.`,
        matched: false,
      };
    }
  }
  for (const [pattern, friendly] of HOST_PATTERNS) {
    if (pattern.test(raw)) {
      return { friendly, matched: true };
    }
  }
  return { friendly: GENERIC_FRIENDLY, matched: false };
}
