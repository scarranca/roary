import type { Metadata } from "next";
import { Desk } from "./_components/desk";

export const metadata: Metadata = { title: "Desk" };

export default function DeskPage() {
  return <Desk />;
}
