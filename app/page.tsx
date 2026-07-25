import { redirect } from "next/navigation";
import { DEFAULT_SLUG } from "@/lib/scenes";

// 루트는 첫 페이지로 넘긴다 — 각 화면은 자기 주소를 가진다.
export default function Home() {
  redirect(`/${DEFAULT_SLUG}`);
}
