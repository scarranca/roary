import type { Metadata } from "next";
import { Desk } from "../../_components/desk";

export const metadata: Metadata = { title: "Desk" };

export default async function DeskSessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <Desk sessionId={sessionId} />;
}
