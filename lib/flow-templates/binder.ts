import type { CreationValue } from "@/lib/flows/field-policies";
import { CreationBindingsSchema } from "@/lib/flows/field-policies";
import { AppError } from "@/lib/errors";
import { FlowGraphSchema, getPendingLabels, type FlowGraph } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";
import {
  TemplateDefinitionSchema,
  type CreationDeclaration,
  type TemplateDefinition,
} from "./schema";

function invalid(message: string): never {
  throw new AppError("VALIDATION", message);
}
type ValueType = CreationValue["type"];
type Leaf = { type: ValueType; write: (value: CreationValue["value"]) => void };

/** Resolve a finite typed leaf on a cloned graph, never an arbitrary path. */
function leaf(graph: FlowGraph, input: CreationDeclaration): Leaf {
  const { nodeId, field, index } = input.target;
  const node = graph.nodes.find((node) => node.id === nodeId);
  if (!node) return invalid("Creation input references an unknown node");
  const indexed = ["splitRecipient", "splitBps", "splitAmountStroops", "signer"].includes(field);
  if (indexed !== (index !== undefined)) return invalid("Only roster leaves require an index");
  const config: Record<string, unknown> = node.config;
  const policy = graph.fieldPolicies?.nodes.find((policy) => policy.nodeId === nodeId);
  let type: ValueType | undefined;
  let key: string = field;
  let target = config;
  if (node.type === "split" && indexed && field !== "signer") {
    const row = node.config.recipients[index!];
    if (!row) return invalid("Unknown immutable Split row");
    const rowPolicy = policy?.kind === "split" ? policy.rows[index!] : undefined;
    if (field === "splitRecipient") {
      if (rowPolicy?.recipient === "execution")
        return invalid("Creation inputs cannot fill runtime-only recipients");
      type = "wallet";
      key = "address";
    } else if (field === "splitBps" && row.mode === "percentage") {
      if (rowPolicy?.allocation === "execution")
        return invalid("Creation inputs cannot fill runtime-only allocations");
      type = "bps";
      key = "bps";
    } else if (field === "splitAmountStroops" && row.mode === "fixed") {
      if (rowPolicy?.allocation === "execution")
        return invalid("Creation inputs cannot fill runtime-only allocations");
      type = "stroops";
      key = "amountStroops";
    }
    target = row;
  } else if (field === "signer" && node.type === "condition" && node.config.kind === "multisig") {
    if (node.config.signers[index!] === undefined) return invalid("Unknown immutable signer slot");
    const signers = node.config.signers;
    return {
      type: "wallet",
      write: (value) => {
        signers[index!] = value as string;
      },
    };
  } else {
    switch (node.type) {
      case "pay":
        if (field === "recipient") {
          if (policy?.kind === "pay" && policy.recipient === "execution")
            return invalid("Creation inputs cannot fill runtime-only recipients");
          type = "wallet";
        }
        if (field === "amountStroops" && !node.config.fullAmount && node.config.mode === "fixed")
          type = "stroops";
        if (
          field === "percentageBps" &&
          !node.config.fullAmount &&
          node.config.mode === "percentage"
        ) {
          return {
            type: "bps",
            write: (value) => {
              node.config.percentage = (value as number) / 100;
            },
          };
        }
        break;
      case "split":
        if (
          field === "amountPerIntervalStroops" &&
          graph.nodes.some((node) => node.type === "on_schedule") &&
          node.config.recipients.every((row) => row.mode === "percentage")
        )
          type = "stroops";
        break;
      case "on_receive":
        if (field === "minAmountStroops") type = "stroops";
        break;
      case "webhook":
        if (field === "relayer") type = "wallet";
        break;
      case "subscription":
        if (field === "subscriber") type = "wallet";
        if (field === "amountPerPeriodStroops") {
          const childId = graph.edges.find((edge) => edge.source === node.id)?.target;
          const child = graph.nodes.find((node) => node.id === childId);
          if (
            child?.type === "split" &&
            child.config.recipients.length > 0 &&
            child.config.recipients.every((row) => row.mode === "fixed")
          )
            return invalid("Subscription pull amount is derived from its fixed Split roster");
          type = "stroops";
        }
        if (field === "occurrences" && node.config.endsAt)
          return invalid("Occurrences are irrelevant when an end date is configured");
        if (field === "endsAt" && !node.config.endsAt && node.config.occurrences !== undefined)
          return invalid("Creation input cannot change the configured termination method");
        if (["intervalAmount", "occurrences"].includes(field)) type = "integer";
        if (field === "intervalUnit") type = "text";
        if (field === "endsAt") type = "timestamp";
        break;
      case "on_schedule":
        if (field === "occurrences" && node.config.endsAt)
          return invalid("Occurrences are irrelevant when an end date is configured");
        if (field === "endsAt" && !node.config.endsAt && node.config.occurrences !== undefined)
          return invalid("Creation input cannot change the configured termination method");
        if (["intervalAmount", "occurrences"].includes(field)) type = "integer";
        if (field === "intervalUnit") type = "text";
        if (["startsAt", "endsAt"].includes(field)) type = "timestamp";
        if (["pauseAllowed", "retrieveAllowed"].includes(field)) type = "boolean";
        break;
      case "condition":
        switch (node.config.kind) {
          case "amount_gt":
          case "amount_lt":
            if (field === "amountStroops") type = "stroops";
            break;
          case "oracle_gte":
            if (field === "oracle") type = "wallet";
            if (field === "oracleKey") {
              type = "text";
              key = "key";
            }
            if (field === "threshold") type = "text";
            break;
          case "time_before":
          case "time_after":
            if (field === "at") type = "timestamp";
            break;
          case "multisig":
            if (field === "threshold") type = "integer";
            break;
          default: {
            const exhaustive: never = node.config;
            return exhaustive;
          }
        }
        break;
      case "oracle":
        if (field === "threshold") type = "text";
        break;
      case "yield":
        if (field === "vault") type = "wallet";
        break;
      case "swap":
        if (field === "slippageBps") type = "bps";
        if (field === "deadlineSecs") type = "integer";
        break;
      case "web2_webhook":
      case "hold":
      case "return_to_owner":
      case "email_notify":
        break;
      default: {
        const exhaustive: never = node;
        return exhaustive;
      }
    }
  }
  if (!type) return invalid("Creation input targets an unsupported or irrelevant leaf");
  return {
    type,
    write: (value) => {
      target[key] = value;
    },
  };
}
function ordered(value: CreationValue): bigint | number {
  if (value.type === "stroops") return BigInt(value.value);
  if (value.type === "timestamp") return Date.parse(value.value);
  if (value.type === "integer" || value.type === "bps") return value.value;
  return invalid("Value has no ordered constraints");
}
function checkValue(input: CreationDeclaration, value: CreationValue) {
  if (value.type === "text" && /^S[A-Z2-7]{55}$/i.test(value.value.trim()))
    invalid("Secret seeds cannot be creation values");
  if (input.type !== value.type) invalid(`Wrong type for creation input ${input.inputId}`);
  if (
    input.target.field === "threshold" &&
    value.type === "text" &&
    (!/^(0|[1-9]\d*)$/.test(value.value) ||
      value.value.length > 39 ||
      BigInt(value.value) > 2n ** 127n - 1n)
  )
    invalid("Oracle threshold must be a nonnegative i128 decimal string");
  const constraints = input.constraints;
  if (constraints?.min && ordered(value) < ordered(constraints.min))
    invalid(`Creation input ${input.inputId} is below its minimum`);
  if (constraints?.max && ordered(value) > ordered(constraints.max))
    invalid(`Creation input ${input.inputId} exceeds its maximum`);
  if (
    value.type === "text" &&
    (value.value.length < (constraints?.minLength ?? 0) ||
      value.value.length > (constraints?.maxLength ?? 280))
  )
    invalid(`Creation input ${input.inputId} has invalid length`);
}
/** Save can retain an incomplete draft; publication and binding require ordinary deploy validation. */
export function validateTemplateDefinition(raw: unknown, deployable = false): TemplateDefinition {
  const definition = TemplateDefinitionSchema.parse(raw);
  for (const input of definition.inputs) {
    const target = leaf(definition.graph, input);
    if (target.type !== input.type) invalid(`Wrong declared type for ${input.inputId}`);
    if (
      input.constraints?.min &&
      input.constraints.max &&
      ordered(input.constraints.min) > ordered(input.constraints.max)
    )
      invalid("Invalid creation input bounds");
    if (
      input.target.field === "endsAt" &&
      definition.inputs.some(
        (other) =>
          other.target.nodeId === input.target.nodeId && other.target.field === "occurrences",
      )
    )
      invalid("Declare one fixed termination method, not both end date and occurrences");
    if (input.defaultValue) checkValue(input, input.defaultValue);
  }
  // Defaults are authored explicitly; validate their combined graph using the
  // configured exemplar for required inputs rather than inventing values.
  const defaultsGraph = structuredClone(definition.graph);
  for (const input of definition.inputs) {
    if (input.defaultValue) leaf(defaultsGraph, input).write(input.defaultValue.value);
  }
  const parsedDefaults = FlowGraphSchema.parse(defaultsGraph);
  if (deployable) {
    assertDeployable(definition.graph);
    assertCompiledDeclarations(definition.graph, definition.inputs);
    assertDeployable(parsedDefaults);
  }
  return definition;
}
export function assertDeployable(graph: FlowGraph) {
  const validation = validateFlow(graph, { ignoreOwnerEmail: true });
  if (!validation.ok)
    invalid(`Invalid template flow: ${validation.errors.map((issue) => issue.message).join("; ")}`);
  if (getPendingLabels(graph).length) invalid("Template flow contains unresolved addresses");
  // No client/runtime authority is granted by creation binding. The normal compiler
  // still enforces supported policies, allocations, condition shapes and all kinds.
  flowToPipeline(graph, undefined, { forValidation: true });
}
function assertCompiledDeclarations(graph: FlowGraph, inputs: CreationDeclaration[]) {
  const pipeline = flowToPipeline(graph, undefined, { forValidation: true });
  for (const input of inputs) {
    if (input.target.field === "minAmountStroops") {
      const root = pipeline.find((node) => node.nodeId === input.target.nodeId)?.params;
      // Only execute_v1 on a reviewed policy-aware root checks this minimum
      // before moving funds. Legacy deposit/execute_step paths do not, even
      // where a Splitter constructor stores the same value for distribute().
      if (
        graph.fieldPolicies?.version !== 1 ||
        root?.kind !== "deposit_trigger" ||
        root.executionNodeId !== input.target.nodeId
      )
        invalid("Receive minimum is not enforced by this compiled pipeline");
    }
    if (
      input.target.field === "percentageBps" &&
      !pipeline.some((node) => node.nodeId === input.target.nodeId && node.params.kind === "payer")
    )
      invalid(
        "Pay percentage is irrelevant when the payout is implemented by a streamer or absorbed conditional",
      );
  }
}
export function bindTemplateVersion(raw: unknown, templateVersionId: string, rawBindings: unknown) {
  // Publication validated the exemplar once. Apply declared replacements before
  // time-sensitive checks so reusable deadlines do not expire with the exemplar.
  const definition = validateTemplateDefinition(raw);
  const bindings = CreationBindingsSchema.parse(rawBindings);
  if (bindings.templateVersionId !== templateVersionId)
    invalid("Bindings name a different immutable version");
  const graph = FlowGraphSchema.parse(structuredClone(definition.graph));
  const declared = new Set(definition.inputs.map((input) => input.inputId));
  for (const binding of bindings.values)
    if (!declared.has(binding.inputId)) invalid("Unknown creation binding");
  const values = definition.inputs.map((input) => {
    const value =
      bindings.values.find((binding) => binding.inputId === input.inputId)?.value ??
      input.defaultValue;
    if (!value) return invalid(`Missing creation input ${input.inputId}`);
    checkValue(input, value);
    leaf(graph, input).write(value.value);
    return { inputId: input.inputId, value };
  });
  const resolved = FlowGraphSchema.parse(graph);
  assertDeployable(resolved);
  assertCompiledDeclarations(resolved, definition.inputs);
  return { graph: resolved, bindings: { version: 1 as const, templateVersionId, values } };
}
