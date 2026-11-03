import { contract, type xdr } from "@stellar/stellar-sdk";

/** Shared by the local WASM checker and its default-CI regression. */
export function inspectInstanceConstructor(
  spec: contract.Spec,
  args: xdr.ScVal[],
  incoming: string | null,
) {
  const inputs = spec.getFunc("__constructor").inputs();
  const errors =
    inputs.length === args.length
      ? []
      : [`expected ${inputs.length} arguments; production encoder supplied ${args.length}`];
  inputs.forEach((input, i) => {
    try {
      spec.scValToNative(args[i]!, input.type());
    } catch (error) {
      errors.push(
        `${input.name().toString()}: ${error instanceof Error ? error.message.split("\n")[0]!.slice(0, 180) : "constructor type mismatch"}`,
      );
    }
  });
  return {
    constructorInputs: inputs.map((input) => ({
      name: input.name().toString(),
      type: input.type().switch().name,
    })),
    encodedArgumentCount: args.length,
    constructorError: errors.length ? errors.join("; ") : null,
    requiredIncomingMethod: incoming,
    incomingMethodAvailable:
      incoming === null || spec.funcs().some((fn) => fn.name().toString() === incoming),
  };
}
export function instanceConformanceExitCode(
  observations: Array<{
    nodes: Array<{ constructorError: string | null; incomingMethodAvailable: boolean }>;
  }>,
): 0 | 1 {
  return observations.some((o) =>
    o.nodes.some((n) => n.constructorError || !n.incomingMethodAvailable),
  )
    ? 1
    : 0;
}
