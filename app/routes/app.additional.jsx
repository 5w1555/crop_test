import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import CropPage from "../components/crop/CropPage.jsx";
import { action, loader } from "./app.additional.server.js";

export { action, loader };

export default function AdditionalRoute() {
  return <CropPage />;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
