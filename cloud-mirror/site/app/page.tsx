import { requireChatGPTUser } from "./chatgpt-auth";
import Review from "./review";
export const dynamic="force-dynamic";
export default async function Home() {
  await requireChatGPTUser("/");
  return <Review />;
}
