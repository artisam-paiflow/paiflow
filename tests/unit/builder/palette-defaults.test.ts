/**
 * The builder PATCHes the whole graph on every autosave, so one palette default
 * that fails the shape parse makes every save of its flow return 422 and loses
 * the unrelated edits made beside it (#450). Hidden templates are held to the
 * same rule: `hidden` is a one-line flip, and older flows still carry them.
 */
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/components/builder/palette";
import { FlowNodeSchema } from "@/lib/flows/schema";

describe("palette defaults", () => {
  it("covers every node type the schema knows", () => {
    const made = new Set(TEMPLATES.map((tpl) => tpl.make().type));
    const known = FlowNodeSchema.options.map((option) => option.shape.type.value);
    expect([...made].sort()).toEqual([...known].sort());
  });

  it.each(TEMPLATES.map((tpl) => [tpl.label, tpl] as const))(
    "%s parses as dropped",
    (_label, tpl) => {
      const parsed = FlowNodeSchema.safeParse(tpl.make());
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    },
  );
});
