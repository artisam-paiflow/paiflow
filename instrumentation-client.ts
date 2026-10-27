import { z } from "zod";

// Next loads this before application modules hydrate. Disable Zod's optional
// code-generation probe before object schemas are constructed under strict CSP.
z.config({ jitless: true });
