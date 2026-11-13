import { moved } from "@/components/clearline/redirect";
/** Moved in IA v2: permanent redirect (see REDIRECTS in components/clearline/nav.ts). */
export const GET = moved("/clearline/control/reconciliation");
export const HEAD = GET;
