import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DeployButton from "@/components/builder/deploy-button";

afterEach(cleanup);

it("disables navigation while saving and restores Deploy after the save settles", () => {
  const onClick = vi.fn();
  const { rerender } = render(<DeployButton flowId="flow" pending onClick={onClick} />);
  const saving = screen.getByRole("link", { name: /SAVING/ });
  expect(saving.getAttribute("aria-disabled")).toBe("true");
  expect(saving.getAttribute("aria-busy")).toBe("true");
  expect(saving.getAttribute("href")).toBeNull();
  saving.click();
  expect(onClick).not.toHaveBeenCalled();

  rerender(<DeployButton flowId="flow" onClick={onClick} />);
  const deploy = screen.getByRole("link", { name: /DEPLOY/ });
  expect(deploy.getAttribute("href")).toBe("/flows/flow/deploy");
  deploy.click();
  expect(onClick).toHaveBeenCalledOnce();
});
