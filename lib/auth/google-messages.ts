/** Fixed copy: never reflect provider errors, query strings or profile data. */
export function googleErrorMessage(reason?: string): string {
  switch (reason) {
    case "rate-limited":
      return "Too many Google sign-in attempts. Try again in ten minutes.";
    case "signup-code-required":
      return "New accounts need a valid access code. Go to Create account and enter a code from your organizer.";
    case "registration-closed":
      return "New Google registrations are closed. Existing linked accounts can still sign in.";
    case "email-conflict":
      return "An account already uses this email. Sign in to that account and link Google from Account settings.";
    case "link-required":
      return "Link Google from Account settings after signing in to your existing account.";
    case "link-expired":
      return "Sign out and sign in again, then link Google within five minutes.";
    case "provider-conflict":
    case "OAuthAccountNotLinked":
      return "This Google identity is already linked or conflicts with an existing account. Choose another identity or sign in to the linked account.";
    case "account-disabled":
      return "This account cannot sign in. Contact your administrator.";
    case "unavailable":
      return "Google sign-in is unavailable on this instance.";
    default:
      return "Google sign-in was cancelled or could not be completed. Please try again.";
  }
}
