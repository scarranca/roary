import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canOpenChat } from "@/lib/chat-access";
import { Desk } from "../../_components/desk";

export const metadata: Metadata = { title: "Desk" };

export default async function DeskSessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  // Chats belong to whoever started them; someone else's link is a 404.
  if (!(await canOpenChat(sessionId))) notFound();
  return <Desk sessionId={sessionId} />;
}
