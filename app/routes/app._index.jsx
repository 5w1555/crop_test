import { redirect } from "react-router";

export const loader = async () => {
  throw redirect("/app/crop");
};

export default function AppIndex() {
  return null; // This route never renders — it only redirects
}