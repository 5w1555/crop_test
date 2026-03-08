import { redirect } from "react-router";

export const loader = async () => {
  return redirect("/app/additional");
};

export default function DownloadRoute() {
  return null;
}
