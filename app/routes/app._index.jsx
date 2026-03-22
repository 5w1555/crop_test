import { redirect } from "react-router";

export const loader = async () => {
  throw redirect("/app/crop");
};

export default function AppIndexRedirect() {
  return null;
}
