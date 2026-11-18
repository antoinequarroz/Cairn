import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readReturnCookie, RETURN_COOKIE } from "@/lib/suite";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Back from the sign-in to the meeting page another app had opened (the page clears the cookie).
  const back = readReturnCookie((await cookies()).get(RETURN_COOKIE)?.value);
  redirect(back ?? "/notes");
}
