import { redirect } from "next/navigation";

/**
 * Flows are now created explicitly through the "New flow" dialog on the
 * dashboard, not on route entry — visiting this route used to persist a blank
 * flow every time, so accidental/duplicate navigation piled up empty flows
 * (issue #278). Direct navigation here no longer creates anything; send the
 * user to the dashboard where the dialog lives.
 */
export default function NewFlow() {
  redirect("/dashboard");
}
