import { AppShell } from "@/components/app-shell";
import { parseSuite } from "@/lib/suite";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const apps = parseSuite(process.env.SUITE_APPS, process.env.APP_URL);
  const account = (process.env.COMPTE_URL ?? "").trim().replace(/\/+$/, "");
  return <AppShell suite={{ apps, account: /^https?:\/\//.test(account) && apps.length ? account : null }}>{children}</AppShell>;
}
