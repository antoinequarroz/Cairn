import { Editor } from "@/components/editor";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed by note: switching note starts from a clean editor.
  return <Editor key={id} id={id} />;
}
