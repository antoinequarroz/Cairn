import { Chat } from "@/components/chat";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed by discussion: switching discussion starts from a clean page.
  return <Chat key={id} id={id} />;
}
